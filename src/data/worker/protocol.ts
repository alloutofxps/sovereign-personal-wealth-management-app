/* The message contract between the main thread and the database worker.
 * Shared by both sides so a change to one cannot silently break the other. */

export type SqlMethod = 'all' | 'get' | 'run' | 'values';

export interface Statement {
  sql: string;
  params: unknown[];
}

/** `Omit` does not distribute over a union, so this does it explicitly. */
export type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never;

export type WorkerRequest =
  | { id: number; op: 'open' }
  | ({ id: number; op: 'exec'; method: SqlMethod } & Statement)
  /** Several statements committed as one transaction — all or nothing. */
  | { id: number; op: 'batch'; statements: Statement[] }
  | { id: number; op: 'status' }
  /** Wipes and recreates the database. Used by "start again" in settings. */
  | { id: number; op: 'reset' }
  /** The whole database as bytes, for an export or a pre-migration copy. */
  | { id: number; op: 'export' }
  /** Replace everything with the bytes of a previous export. */
  | { id: number; op: 'import'; bytes: Uint8Array }
  /** Copies taken automatically before each migration. */
  | { id: number; op: 'listBackups' };

/** Where the data actually lives, and whether it will survive a reload. */
export interface StorageStatus {
  /** The SQLite VFS in use. */
  vfs: 'opfs-sahpool' | 'memory';
  /** False means this session's data disappears when the tab closes. */
  durable: boolean;
  /** Whether the browser promised not to evict our storage. */
  persisted: boolean;
  /** Plain-English explanation, safe to show to the user. */
  explanation: string;
  schemaVersion: number;
}

export interface BackupFile {
  name: string;
  bytes: number;
  /** The schema version this copy was taken before moving on from. */
  fromVersion: number;
}

export type WorkerResponse =
  | { id: number; ok: true; bytes: Uint8Array }
  | { id: number; ok: true; backups: BackupFile[] }
  | { id: number; ok: true; rows: unknown[][] }
  | { id: number; ok: true; status: StorageStatus }
  | { id: number; ok: true }
  | { id: number; ok: false; error: string }
  /** Broadcast, not a reply: something changed, re-run affected queries. */
  | { id: -1; event: 'invalidate'; tables: string[] };

/**
 * Which tables a statement writes to.
 *
 * The SQL in this app is entirely our own and built by Drizzle, so a narrow
 * match on the three write forms is reliable. Anything unrecognised
 * invalidates nothing, which is why writes go through the repository rather
 * than being issued ad hoc.
 */
export function tablesWrittenBy(sql: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\binsert\s+(?:or\s+\w+\s+)?into\s+["'`]?(\w+)/gi,
    /\bupdate\s+["'`]?(\w+)/gi,
    /\bdelete\s+from\s+["'`]?(\w+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

export function isWrite(sql: string): boolean {
  return !/^\s*select\b/i.test(sql);
}
