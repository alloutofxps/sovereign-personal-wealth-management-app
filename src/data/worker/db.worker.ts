/// <reference lib="webworker" />
/* ===========================================================================
 * THE DATABASE WORKER
 * ---------------------------------------------------------------------------
 * SQLite compiled to WebAssembly, owning the whole database on a thread of its
 * own. Nothing else in the app ever touches SQLite directly.
 *
 * Storage uses the OPFS SyncAccessHandle pool VFS. That choice matters:
 *
 *   · It is genuinely durable — the database is a real file in the origin's
 *     private file system, not a blob in memory.
 *   · It does not require SharedArrayBuffer, so it works whether or not the
 *     page is cross-origin isolated. (We set COOP/COEP anyway, so the classic
 *     OPFS VFS stays available as an option later.)
 *   · It must run in a worker, which is where we want it regardless: the whole
 *     point is to keep query and ledger work off the thread that paints.
 *
 * Where OPFS is unavailable — older iOS, some private-browsing modes — the
 * same SQLite build runs in memory instead. Identical SQL, identical schema,
 * one honest difference: the data does not survive the tab closing. The app is
 * told which mode it is in so it can say so plainly rather than pretending.
 * ======================================================================== */

import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { BOOTSTRAP_DDL, DDL, SCHEMA_VERSION } from '../schema/ddl';
import {
  COMPILE_OPTIONS_SQL,
  detectFts5,
  searchSchemaStatements,
  type SchemaCapabilities,
} from '../schema/migrations/v7';
import { MIGRATIONS } from '../schema/migrations';
import { TABLES } from '../schema/tables';
import {
  isWrite,
  tablesWrittenBy,
  type SqlMethod,
  type StorageStatus,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

const DB_FILENAME = 'sovereign.sqlite3';
const OPFS_POOL_NAME = 'sovereign-opfs';

let sqlite3: Sqlite3Static | null = null;
let db: Database | null = null;
let status: StorageStatus | null = null;
/** Kept so `reset` can wipe the file rather than just the rows. */
let poolUtil: { wipeFiles: () => Promise<void> } | null = null;

/**
 * The single in-flight open.
 *
 * Opening is asynchronous, so two messages arriving close together — which is
 * exactly what React's development double-effect does — would both find `db`
 * unset and both try to claim the OPFS file. The second claim fails, and the
 * old code then quietly replaced a perfectly good durable database with an
 * in-memory one. Memoising the promise means open happens once, ever.
 */
let opening: Promise<StorageStatus> | null = null;

const post = (message: WorkerResponse) => self.postMessage(message);

function open(): Promise<StorageStatus> {
  opening ??= doOpen();
  return opening;
}

async function doOpen(): Promise<StorageStatus> {
  sqlite3 ??= await sqlite3InitModule();

  let vfs: StorageStatus['vfs'] = 'memory';
  let explanation: string;

  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: OPFS_POOL_NAME });
    poolUtil = pool as unknown as { wipeFiles: () => Promise<void> };
    db = new pool.OpfsSAHPoolDb(`/${DB_FILENAME}`);
    vfs = 'opfs-sahpool';
    explanation = 'Your data is saved on this device and will be here when you come back.';
  } catch (error) {
    // A supported, degraded mode — but the reason matters, because the two
    // causes need completely different things from the user.
    db = new sqlite3.oo1.DB(':memory:', 'c');
    explanation = explainFallback(error);
  }

  // Order matters here. An existing database must be brought up to date
  // *before* the rest of the DDL runs, because the DDL creates indexes over
  // columns that a migration is responsible for adding. Getting this the
  // wrong way round works perfectly on a fresh install and breaks every
  // upgrade, which is the worst possible way for it to fail.
  for (const statement of BOOTSTRAP_DDL) db.exec(statement);
  const fresh = !tableExists(db, 'accounts');

  // Refuse to touch a database written by a newer version of Sovereign.
  // Opening it would be one thing; writing to it with older code that does
  // not understand its shape is how records get quietly mangled.
  const found = currentVersion(db);
  if (!fresh && found > SCHEMA_VERSION) {
    throw new Error(
      `Your data was saved by a newer version of Sovereign than the one running here. ` +
        `Nothing has been changed. Reload the page to pick up the newer version.`,
    );
  }

  // Somebody's financial history is the only copy there is. Take one before
  // changing the shape of it, so a migration that goes wrong is recoverable
  // rather than final.
  // Ask the engine what it can do before anything depends on the answer.
  const capabilities = probeCapabilities(db);

  if (!fresh && currentVersion(db) < SCHEMA_VERSION) await backupBeforeMigrating(db);
  if (!fresh) migrate(db, capabilities);
  for (const statement of DDL) db.exec(statement);

  // The search schema is capability-dependent, so it cannot live in the static
  // DDL. Running it here covers a fresh database; the v7 step covers one being
  // upgraded. Every statement is safe to run twice, so both is fine.
  for (const statement of searchSchemaStatements(capabilities)) db.exec(statement);

  setVersion(db, SCHEMA_VERSION);

  status = {
    vfs,
    durable: vfs !== 'memory',
    // Asked for separately by the main thread; the worker cannot request it.
    persisted: false,
    explanation,
    schemaVersion: SCHEMA_VERSION,
  };
  return status;
}

function explainFallback(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // The OPFS pool can only be held by one tab at a time.
  if (/access handle|createSyncAccessHandle/i.test(message)) {
    return (
      'Sovereign is already open in another tab, and only one can use your saved ' +
      'data at a time. Close the other tab and reload this one to carry on where ' +
      'you left off. Anything you add here meanwhile will not be saved.'
    );
  }

  return (
    'This browser will not let Sovereign save anything to your device, so your ' +
    'data will only last until you close this tab. Private browsing is the usual ' +
    'reason. Opening Sovereign in a normal window will fix it.'
  );
}

/**
 * What this SQLite build supports.
 *
 * Read once per open and passed down, rather than probed at each use — the
 * answer cannot change while the database is open, and a pragma per query
 * would be a silly thing to pay for.
 */
function probeCapabilities(database: Database): SchemaCapabilities {
  try {
    const rows = database.exec({
      sql: COMPILE_OPTIONS_SQL,
      rowMode: 'array',
      returnValue: 'resultRows',
    }) as unknown[][];
    return { fts5: detectFts5(rows) };
  } catch {
    // A build that will not even answer the question gets the slow path.
    return { fts5: false };
  }
}

/* --- schema versioning --------------------------------------------------- */

function tableExists(database: Database, table: string): boolean {
  const rows = database.exec({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    bind: [table],
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown[][];
  return rows.length > 0;
}

function columnExists(database: Database, table: string, column: string): boolean {
  const rows = database.exec({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    bind: [table, column],
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown[][];
  return rows.length > 0;
}

function currentVersion(database: Database): number {
  if (!tableExists(database, 'meta')) return 0;
  const rows = database.exec({
    sql: `SELECT value FROM meta WHERE key = 'schema_version'`,
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown[][];
  const raw = rows[0]?.[0];
  return raw === undefined ? 0 : Number(raw);
}

function setVersion(database: Database, version: number): void {
  database.exec({
    sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    bind: [String(version)],
  });
}

/**
 * Step an existing database forward, one version at a time, in one
 * transaction. Somebody's financial history is the only copy there is, so a
 * failure part-way leaves it exactly where it started rather than half-done.
 */
function migrate(database: Database, capabilities: SchemaCapabilities): void {
  const from = currentVersion(database);
  const pending = MIGRATIONS.filter((step) => step.to > from).sort((a, b) => a.to - b.to);
  if (pending.length === 0) return;

  database.exec('BEGIN');
  try {
    for (const step of pending) {
      for (const column of step.addColumns ?? []) {
        if (columnExists(database, column.table, column.column)) continue;
        database.exec(
          `ALTER TABLE ${column.table} ADD COLUMN ${column.column} ${column.declaration}`,
        );
      }
      for (const statement of step.statements ?? []) database.exec(statement);
      for (const statement of step.plan?.(capabilities) ?? []) database.exec(statement);
      setVersion(database, step.to);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw new Error(
      `Sovereign could not update the shape of your saved data, so nothing has been ` +
        `changed. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/* --- copies and exports --------------------------------------------------- */

const BACKUP_PREFIX = 'sovereign-backup-v';

function exportBytes(database: Database): Uint8Array {
  return sqlite3!.capi.sqlite3_js_db_export(database);
}

/**
 * Write a copy of the database into the origin's private file system, named
 * for the version it is being taken from. Best effort: a browser that will not
 * give us a directory handle must not block the app from opening.
 */
async function backupBeforeMigrating(database: Database): Promise<void> {
  try {
    const from = currentVersion(database);
    const bytes = exportBytes(database);
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`${BACKUP_PREFIX}${from}.sqlite3`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes as BufferSource);
    await writable.close();
  } catch {
    // No copy taken. The migration itself is still transactional, so this is
    // a lost safety net rather than a lost database.
  }
}

async function readBackups(): Promise<{ name: string; bytes: number; fromVersion: number }[]> {
  const found: { name: string; bytes: number; fromVersion: number }[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name, handle] of (
      root as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      if (!name.startsWith(BACKUP_PREFIX) || handle.kind !== 'file') continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      found.push({
        name,
        bytes: file.size,
        fromVersion: Number(name.slice(BACKUP_PREFIX.length).split('.')[0] ?? 0),
      });
    }
  } catch {
    // Nothing to report.
  }
  return found.sort((a, b) => b.fromVersion - a.fromVersion);
}

/** Replace the live database with the bytes of an export. */
async function replaceDatabase(bytes: Uint8Array): Promise<void> {
  const database = requireDb();
  const capi = sqlite3!.capi;

  // Deserialise into the open connection rather than closing and swapping the
  // file: the OPFS pool holds the handle, and taking it apart underneath a
  // live connection is how a database ends up half-written.
  const pointer = sqlite3!.wasm.allocFromTypedArray(bytes);
  const rc = capi.sqlite3_deserialize(
    database.pointer!,
    'main',
    pointer,
    bytes.length,
    bytes.length,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  database.checkRc(rc);

  // What just arrived is a whole database of unknown age. A backup taken two
  // years ago is exactly the file somebody restores in an emergency, and it
  // has none of the columns added since — so it has to be stepped forward the
  // same way an old local database is, or the app comes back up reading
  // columns that are not there.
  const restored = currentVersion(database);
  if (restored > SCHEMA_VERSION) {
    throw new Error(
      `That backup was saved by a newer version of Sovereign than the one running here, ` +
        `so it has not been restored. Reload the page to pick up the newer version and ` +
        `try again.`,
    );
  }

  const capabilities = probeCapabilities(database);
  migrate(database, capabilities);
  for (const statement of DDL) database.exec(statement);
  for (const statement of searchSchemaStatements(capabilities)) database.exec(statement);
  setVersion(database, SCHEMA_VERSION);
}

function requireDb(): Database {
  if (!db) throw new Error('The database has not been opened yet.');
  return db;
}

/** Run one statement and return rows as arrays, which is what Drizzle wants. */
function exec(sql: string, params: unknown[], method: SqlMethod): unknown[][] {
  const rows = requireDb().exec({
    sql,
    bind: params as never,
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown[][];

  if (method === 'get') return rows.length > 0 ? [rows[0] as unknown[]] : [];
  return rows;
}

function announce(tables: string[]): void {
  if (tables.length > 0) post({ id: -1, event: 'invalidate', tables });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.op) {
      case 'open':
      case 'status': {
        post({ id: request.id, ok: true, status: await open() });
        break;
      }

      case 'exec': {
        await open();
        const rows = exec(request.sql, request.params, request.method);
        post({ id: request.id, ok: true, rows });
        if (isWrite(request.sql)) announce(tablesWrittenBy(request.sql));
        break;
      }

      case 'batch': {
        await open();
        const database = requireDb();
        const touched = new Set<string>();

        // All or nothing. A half-written journal entry is worse than none.
        database.exec('BEGIN');
        try {
          for (const statement of request.statements) {
            database.exec({ sql: statement.sql, bind: statement.params as never });
            for (const table of tablesWrittenBy(statement.sql)) touched.add(table);
          }
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }

        post({ id: request.id, ok: true, rows: [] });
        announce([...touched]);
        break;
      }

      case 'export': {
        await open();
        post({ id: request.id, ok: true, bytes: exportBytes(requireDb()) });
        break;
      }

      case 'listBackups': {
        post({ id: request.id, ok: true, backups: await readBackups() });
        break;
      }

      case 'import': {
        await open();
        await replaceDatabase(request.bytes);
        // Everything on screen is now looking at the wrong data — not some of
        // it. Naming tables by hand here is how a restored backup came to
        // leave half the app showing the previous database.
        announce([...TABLES]);
        post({ id: request.id, ok: true });
        break;
      }

      case 'reset': {
        db?.close();
        db = null;
        status = null;
        opening = null;
        await poolUtil?.wipeFiles();
        await open();
        post({ id: request.id, ok: true });
        announce([...TABLES]);
        break;
      }
    }
  } catch (error) {
    post({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
