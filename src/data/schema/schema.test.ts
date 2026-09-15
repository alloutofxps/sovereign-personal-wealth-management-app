/* ===========================================================================
 * THE SCHEMA, RUN AGAINST A REAL ENGINE
 * ---------------------------------------------------------------------------
 * Every other test in this project is arithmetic, and arithmetic can be
 * checked by reading it. SQL cannot: a migration is a string that either the
 * engine accepts or it does not, and the place we find out has always been
 * somebody's phone, on their only copy of their financial history.
 *
 * Node ships SQLite now, so it does not have to be. These build a database
 * from the same DDL the app ships, apply the same migration statements the app
 * would apply, and check what actually came out.
 *
 * The one that matters most is the ALTER TABLE. SQLite refuses to add a NOT
 * NULL column without a default, and its rules about what may carry a CHECK
 * are not obvious from reading the documentation. That is exactly the failure
 * that cannot be caught by inspection and cannot be recovered from in the
 * field, so it is checked here rather than assumed.
 * ======================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOOTSTRAP_DDL, DDL, SCHEMA_VERSION } from './ddl';
import { LATEST_VERSION, MIGRATIONS } from './migrations';
import { TARGET_KIND_COLUMN, v17Statements } from './migrations/v17';
import { v18Statements } from './migrations/v18';
import { v19Statements } from './migrations/v19';
import { REGISTER_MARK_NOTE, v20Statements } from './migrations/v20';

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const statement of BOOTSTRAP_DDL) db.exec(statement);
  for (const statement of DDL) db.exec(statement);
  return db;
}

interface ColumnInfo {
  name: string;
  notnull: number;
  dflt_value: string | null;
}

const columns = (db: DatabaseSync, table: string): ColumnInfo[] =>
  db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];

const columnNames = (db: DatabaseSync, table: string) => columns(db, table).map((c) => c.name);

describe('a database built from the shipped DDL', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = fresh();
  });

  it('opens at the version the migration list ends on', () => {
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(Number(row?.value)).toBe(LATEST_VERSION);
    expect(SCHEMA_VERSION).toBe(LATEST_VERSION);
  });

  it('has the v17 column on accounts', () => {
    const kind = columns(db, 'accounts').find((c) => c.name === 'target_kind');
    expect(kind).toBeDefined();
    expect(kind?.notnull).toBe(1);
    expect(kind?.dflt_value).toContain('by_date');
  });

  it('gives a pot created without one the by-date default', () => {
    db.exec(`INSERT INTO accounts (id, book, type, name, normal)
             VALUES ('pot-1', 'BUDGET', 'ENVELOPE', 'Holiday', 'CREDIT')`);
    const row = db.prepare(`SELECT target_kind FROM accounts WHERE id = 'pot-1'`).get() as {
      target_kind: string;
    };
    expect(row.target_kind).toBe('by_date');
  });

  it('refuses a kind it does not recognise', () => {
    expect(() =>
      db.exec(`INSERT INTO accounts (id, book, type, name, normal, target_kind)
               VALUES ('pot-2', 'BUDGET', 'ENVELOPE', 'Holiday', 'CREDIT', 'someday')`),
    ).toThrow();
  });

  it('carries the index the pots list reads through', () => {
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts'`)
      .all() as unknown as { name: string }[];
    expect(rows.map((r) => r.name)).toContain('idx_accounts_target_kind');
  });
});

describe('stepping a database forward to v17', () => {
  /**
   * A v16 database, made by taking the current schema and dropping the one
   * column v17 adds. Rebuilding the whole v16 DDL from history would be a
   * second copy of the schema to keep true, and a stale copy would test
   * nothing; this is the same table the app has, minus the change.
   */
  function atV16(): DatabaseSync {
    const db = fresh();
    // The index has to go first: SQLite refuses to drop a column that one
    // still refers to, which is exactly the guard that makes it safe.
    db.exec(`DROP INDEX IF EXISTS idx_accounts_target_kind`);
    db.exec(`ALTER TABLE accounts DROP COLUMN target_kind`);
    db.exec(`UPDATE meta SET value = '16' WHERE key = 'schema_version'`);
    return db;
  }

  it('starts without the column, so the test is testing something', () => {
    expect(columnNames(atV16(), 'accounts')).not.toContain('target_kind');
  });

  it('accepts the column declaration as an ALTER TABLE', () => {
    // The failure this exists for: SQLite will not add a NOT NULL column
    // without a default, and a declaration that is legal inside CREATE TABLE
    // is not automatically legal here.
    const db = atV16();
    expect(() =>
      db.exec(`ALTER TABLE accounts ADD COLUMN target_kind ${TARGET_KIND_COLUMN}`),
    ).not.toThrow();
    expect(columnNames(db, 'accounts')).toContain('target_kind');
  });

  it('leaves every existing pot with a kind, not a null', () => {
    const db = atV16();
    db.exec(`INSERT INTO accounts (id, book, type, name, normal, envelope_role, target_amount)
             VALUES ('pot-open', 'BUDGET', 'ENVELOPE', 'Rainy day', 'CREDIT', 'goal', 100000)`);
    db.exec(`ALTER TABLE accounts ADD COLUMN target_kind ${TARGET_KIND_COLUMN}`);

    const nulls = db
      .prepare(`SELECT count(*) AS n FROM accounts WHERE target_kind IS NULL`)
      .get() as { n: number };
    expect(nulls.n).toBe(0);
  });

  it('turns a dateless pot into an open-ended one, and leaves the rest alone', () => {
    const db = atV16();
    db.exec(`INSERT INTO accounts (id, book, type, name, normal, envelope_role, target_date)
             VALUES ('pot-open', 'BUDGET', 'ENVELOPE', 'Rainy day', 'CREDIT', 'goal', NULL)`);
    db.exec(`INSERT INTO accounts (id, book, type, name, normal, envelope_role, target_date)
             VALUES ('pot-dated', 'BUDGET', 'ENVELOPE', 'Car', 'CREDIT', 'sinking_fund', '2027-05-01')`);
    // An ordinary spending envelope, which has no target of any kind. It must
    // not be swept up by a backfill written for pots.
    db.exec(`INSERT INTO accounts (id, book, type, name, normal, envelope_role)
             VALUES ('env-food', 'BUDGET', 'ENVELOPE', 'Food', 'CREDIT', 'category')`);

    db.exec(`ALTER TABLE accounts ADD COLUMN target_kind ${TARGET_KIND_COLUMN}`);
    for (const statement of v17Statements()) db.exec(statement);

    const kindOf = (id: string) =>
      (db.prepare(`SELECT target_kind FROM accounts WHERE id = ?`).get(id) as {
        target_kind: string;
      }).target_kind;

    expect(kindOf('pot-open')).toBe('open');
    expect(kindOf('pot-dated')).toBe('by_date');
    expect(kindOf('env-food')).toBe('by_date');
  });

  it('is harmless to run twice, which is what a retry does', () => {
    const db = atV16();
    db.exec(`INSERT INTO accounts (id, book, type, name, normal, envelope_role)
             VALUES ('pot-open', 'BUDGET', 'ENVELOPE', 'Rainy day', 'CREDIT', 'goal')`);
    db.exec(`ALTER TABLE accounts ADD COLUMN target_kind ${TARGET_KIND_COLUMN}`);

    for (const statement of v17Statements()) db.exec(statement);
    const once = db.prepare(`SELECT target_kind FROM accounts WHERE id = 'pot-open'`).get();
    for (const statement of v17Statements()) db.exec(statement);
    const twice = db.prepare(`SELECT target_kind FROM accounts WHERE id = 'pot-open'`).get();

    expect(twice).toEqual(once);
  });
});

describe('tags, and the promises the schema itself makes', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = fresh();
    db.exec(`INSERT INTO entries (id, kind, date, description, created_at)
             VALUES ('e1', 'SPEND', '2026-08-04', 'Paid the villa.', '2026-08-04T10:00:00Z')`);
    db.exec(`INSERT INTO entries (id, kind, date, description, created_at)
             VALUES ('e2', 'SPEND', '2026-08-05', 'Paid for wine.', '2026-08-05T10:00:00Z')`);
    db.exec(`INSERT INTO tags (id, name, slug, created_at)
             VALUES ('t1', 'Italy 2026', 'italy-2026', '2026-08-01T10:00:00Z')`);
  });

  it('lets one payment carry several tags and one tag cover several payments', () => {
    db.exec(`INSERT INTO tags (id, name, slug, created_at)
             VALUES ('t2', 'Reimbursable', 'reimbursable', '2026-08-01T10:00:00Z')`);
    db.exec(`INSERT INTO entry_tags (entry_id, tag_id) VALUES ('e1','t1'),('e1','t2'),('e2','t1')`);

    const onE1 = db.prepare(`SELECT count(*) AS n FROM entry_tags WHERE entry_id = 'e1'`).get() as {
      n: number;
    };
    const onT1 = db.prepare(`SELECT count(*) AS n FROM entry_tags WHERE tag_id = 't1'`).get() as {
      n: number;
    };
    expect(onE1.n).toBe(2);
    expect(onT1.n).toBe(2);
  });

  it('takes tagging the same payment twice as no change rather than an error', () => {
    db.exec(`INSERT INTO entry_tags (entry_id, tag_id) VALUES ('e1','t1')`);
    db.exec(`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES ('e1','t1')`);
    const row = db.prepare(`SELECT count(*) AS n FROM entry_tags`).get() as { n: number };
    expect(row.n).toBe(1);
  });

  it('refuses a second tag whose slug already exists', () => {
    // The whole reason the slug carries the uniqueness: "italy 2026" typed on
    // a Tuesday must not quietly split a year of holiday spending in two.
    expect(() =>
      db.exec(`INSERT INTO tags (id, name, slug, created_at)
               VALUES ('t9', 'italy 2026', 'italy-2026', '2026-08-02T10:00:00Z')`),
    ).toThrow();
  });

  it('allows two different spellings to coexist as genuinely different tags', () => {
    expect(() =>
      db.exec(`INSERT INTO tags (id, name, slug, created_at)
               VALUES ('t3', 'Italy 2027', 'italy-2027', '2026-08-02T10:00:00Z')`),
    ).not.toThrow();
  });

  it('takes its labels with it when a tag is deleted, and leaves the payments', () => {
    db.exec(`INSERT INTO entry_tags (entry_id, tag_id) VALUES ('e1','t1'),('e2','t1')`);
    db.exec(`DELETE FROM tags WHERE id = 't1'`);

    const labels = db.prepare(`SELECT count(*) AS n FROM entry_tags`).get() as { n: number };
    const entries = db.prepare(`SELECT count(*) AS n FROM entries`).get() as { n: number };
    expect(labels.n).toBe(0);
    expect(entries.n).toBe(2);
  });

  it('will not label a payment that does not exist', () => {
    expect(() =>
      db.exec(`INSERT INTO entry_tags (entry_id, tag_id) VALUES ('nope','t1')`),
    ).toThrow();
  });

  it('joins tags to nothing that carries an amount', () => {
    // The load-bearing rule. A tag that could reach a posting would be a
    // second budgeting system running beside the first.
    const sql = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='entry_tags'`)
      .get() as { sql: string };
    expect(sql.sql).toContain('entries(id)');
    expect(sql.sql).toContain('tags(id)');
    expect(sql.sql).not.toMatch(/postings|amount|envelope|account/i);
  });
});

describe('stepping a database forward to v18', () => {
  it('creates both tables where neither existed', () => {
    const db = fresh();
    db.exec(`DROP TABLE IF EXISTS entry_tags`);
    db.exec(`DROP TABLE IF EXISTS tags`);

    for (const statement of v18Statements()) db.exec(statement);

    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as unknown as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toContain('tags');
    expect(names).toContain('entry_tags');
  });

  it('is harmless to run twice, which is what a retry does', () => {
    const db = fresh();
    db.exec(`INSERT INTO tags (id, name, slug, created_at)
             VALUES ('t1', 'Kitchen', 'kitchen', '2026-08-01T10:00:00Z')`);
    for (const statement of v18Statements()) db.exec(statement);
    for (const statement of v18Statements()) db.exec(statement);

    const row = db.prepare(`SELECT count(*) AS n FROM tags`).get() as { n: number };
    expect(row.n).toBe(1);
  });
});

describe('what-ifs, and where they are not', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = fresh();
    db.exec(`INSERT INTO branches (id, name, diverges_on, created_at)
             VALUES ('br1', 'If I took the Rotterdam job', '2026-10-01', '2026-09-07T10:00:00Z')`);
    db.exec(`INSERT INTO branch_entries (id, branch_id, kind, date, description, postings, created_at)
             VALUES ('be1','br1','SPEND','2026-11-01','Rent in the new place.','[]','2026-09-07T10:00:00Z')`);
  });

  /**
   * The guarantee the whole design exists for.
   *
   * Not "no query does this" — "no query could". A branch entry is not in
   * `entries` and its postings are not in `postings`, so every real query is
   * structurally incapable of returning one, however carelessly it is written.
   */
  it('puts nothing hypothetical where a real query would find it', () => {
    const entries = db.prepare(`SELECT count(*) AS n FROM entries`).get() as { n: number };
    const postings = db.prepare(`SELECT count(*) AS n FROM postings`).get() as { n: number };
    expect(entries.n).toBe(0);
    expect(postings.n).toBe(0);
  });

  it('keeps them where a branch query will', () => {
    const rows = db.prepare(`SELECT count(*) AS n FROM branch_entries`).get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('has no column joining a branch to the real ledger', () => {
    // A `branch_id` on `entries` is the obvious design and the wrong one: it
    // would put `WHERE branch_id IS NULL` on every query in the application,
    // forever, and the first one anybody forgets is money that never existed
    // showing up in what somebody is worth.
    const entryColumns = columnNames(db, 'entries');
    const postingColumns = columnNames(db, 'postings');
    expect(entryColumns).not.toContain('branch_id');
    expect(postingColumns).not.toContain('branch_id');
  });

  it('will not sketch a what-if against a branch that does not exist', () => {
    expect(() =>
      db.exec(`INSERT INTO branch_entries (id, branch_id, kind, date, description, postings, created_at)
               VALUES ('be9','nope','SPEND','2026-11-01','x','[]','2026-09-07T10:00:00Z')`),
    ).toThrow();
  });

  it('takes the sketches with it when a what-if is dropped', () => {
    db.exec(`DELETE FROM branches WHERE id = 'br1'`);
    const rows = db.prepare(`SELECT count(*) AS n FROM branch_entries`).get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('insists a what-if has a date it starts from', () => {
    // A branch is an alternative future, never an alternative past.
    expect(() =>
      db.exec(`INSERT INTO branches (id, name, created_at)
               VALUES ('br2', 'No date', '2026-09-07T10:00:00Z')`),
    ).toThrow();
  });
});

describe('stepping a database forward to v19', () => {
  it('creates both tables where neither existed, and twice is harmless', () => {
    const db = fresh();
    db.exec(`DROP TABLE IF EXISTS branch_entries`);
    db.exec(`DROP TABLE IF EXISTS branches`);

    for (const statement of v19Statements()) db.exec(statement);
    for (const statement of v19Statements()) db.exec(statement);

    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as unknown as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).toContain('branches');
    expect(names).toContain('branch_entries');
  });
});

describe('every migration step', () => {
  it('declares a version and says why it exists', () => {
    for (const step of MIGRATIONS) {
      expect(step.to).toBeGreaterThan(1);
      expect(step.reason.length).toBeGreaterThan(10);
    }
  });

  it('is listed once, in ascending order', () => {
    const versions = MIGRATIONS.map((step) => step.to);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });
});

/* ===========================================================================
 * V20 — TELLING A TYPED FIGURE FROM A COMPUTED ONE
 * ---------------------------------------------------------------------------
 * The column exists because its absence cost money. `valuations` held both
 * "I reckon this is worth EUR 3,458" and "the holdings added up to EUR
 * 1,777.50", and two things followed: the residual was read off whichever row
 * was newest, and the unique index on (account_id, date) let a register mark
 * overwrite somebody's own opening figure outright.
 *
 * The index is the half a source scan cannot check, so it is exercised here
 * against real SQLite: two kinds on one day must both survive, and two of the
 * same kind on one day must still collapse to one.
 * ======================================================================== */

describe('a valuation says who is speaking', () => {
  function accountRow(db: DatabaseSync): void {
    db.exec(`INSERT INTO accounts (id, book, type, name, normal)
             VALUES ('acc-1', 'FINANCIAL', 'ASSET', 'Trading 212', 'DEBIT')`);
  }

  const mark = (id: string, value: number, kind: string, date = '2026-09-15') =>
    `INSERT INTO valuations (id, account_id, date, value, kind, created_at)
      VALUES ('${id}', 'acc-1', '${date}', ${value}, '${kind}', '2026-09-15T10:00:00Z')`;

  it('ships the column on a fresh database', () => {
    const db = fresh();
    expect(columnNames(db, 'valuations')).toContain('kind');
  });

  it('defaults to the kind that must never be overwritten', () => {
    const db = fresh();
    accountRow(db);
    db.exec(`INSERT INTO valuations (id, account_id, date, value, created_at)
             VALUES ('v1', 'acc-1', '2026-09-15', 345800, '2026-09-15T10:00:00Z')`);
    const row = db.prepare(`SELECT kind FROM valuations WHERE id = 'v1'`).get() as { kind: string };
    expect(row.kind).toBe('user');
  });

  /*
   * The defect this index change exists for.
   *
   * Before v20 the second of these replaced the first, because they share a
   * date and the key was (account_id, date). A person's opening figure was
   * destroyed by the app's own bookkeeping on the day they created the
   * account, and the detail sheet then showed the register's total under the
   * caption "What it was worth when you added it".
   */
  it('keeps a typed figure and a register mark from the same day apart', () => {
    const db = fresh();
    accountRow(db);
    db.exec(mark('v-user', 345_800, 'user'));
    db.exec(mark('v-reg', 177_750, 'register'));

    const rows = db
      .prepare(`SELECT id, value, kind FROM valuations WHERE account_id = 'acc-1' ORDER BY kind`)
      .all() as unknown as { id: string; value: number; kind: string }[];

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === 'user')?.value, 'the figure they gave').toBe(345_800);
    expect(rows.find((r) => r.kind === 'register')?.value, 'what the holdings came to').toBe(
      177_750,
    );
  });

  it('still allows only one of each kind per day', () => {
    const db = fresh();
    accountRow(db);
    db.exec(mark('v-reg', 177_750, 'register'));
    // A second opinion on the same day is a correction, not a second fact.
    expect(() => db.exec(mark('v-reg-again', 301_750, 'register'))).toThrow();
  });

  it('refuses a kind it does not know', () => {
    const db = fresh();
    accountRow(db);
    expect(() => db.exec(mark('v-bad', 1, 'guess'))).toThrow();
  });

  it('backfills existing register marks by the note they have always carried', () => {
    const db = fresh();
    accountRow(db);
    // A database as it stood before v20: no kind, told apart only by prose.
    db.exec(`INSERT INTO valuations (id, account_id, date, value, notes, kind, created_at)
             VALUES ('old-reg', 'acc-1', '2026-09-10', 177750, '${REGISTER_MARK_NOTE}', 'user', '2026-09-10T10:00:00Z')`);
    db.exec(`INSERT INTO valuations (id, account_id, date, value, notes, kind, created_at)
             VALUES ('old-user', 'acc-1', '2026-09-09', 345800, 'What it was worth when you added it.', 'user', '2026-09-09T10:00:00Z')`);

    for (const statement of v20Statements()) db.exec(statement);

    const kindOf = (id: string) =>
      (db.prepare(`SELECT kind FROM valuations WHERE id = '${id}'`).get() as { kind: string }).kind;
    expect(kindOf('old-reg'), 'the register wrote this one').toBe('register');
    expect(kindOf('old-user'), 'the person wrote this one').toBe('user');
  });

  it('is harmless to run twice, which is what a retry does', () => {
    const db = fresh();
    accountRow(db);
    db.exec(mark('v-reg', 177_750, 'register'));
    for (const statement of v20Statements()) db.exec(statement);
    for (const statement of v20Statements()) db.exec(statement);

    const row = db.prepare(`SELECT count(*) AS n FROM valuations`).get() as { n: number };
    expect(row.n).toBe(1);
  });
});
