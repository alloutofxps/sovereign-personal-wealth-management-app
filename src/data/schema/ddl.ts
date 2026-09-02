/* ===========================================================================
 * SCHEMA CREATION
 * ---------------------------------------------------------------------------
 * Hand-written DDL rather than drizzle-kit output, because the constraints
 * matter as much as the columns and this is where they live.
 *
 * The database enforces what it can: a posting for nothing at all is rejected
 * outright, and every enumerated column is constrained. Whole-entry balance
 * (I1) cannot be a row-level CHECK — it is a property of a set of rows — so it
 * is enforced twice above this layer instead: once when an entry is built, and
 * again inside the transaction that writes it.
 * ======================================================================== */

export const SCHEMA_VERSION = 2;

export const DDL: readonly string[] = [
  `PRAGMA foreign_keys = ON;`,

  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS accounts (
     id                  TEXT PRIMARY KEY,
     book                TEXT NOT NULL CHECK (book IN ('FINANCIAL','BUDGET')),
     type                TEXT NOT NULL CHECK (type IN (
                           'ASSET','LIABILITY','EQUITY','INCOME','EXPENSE',
                           'BUDGETABLE_CASH','ENVELOPE','READY_TO_ASSIGN')),
     name                TEXT NOT NULL,
     normal              TEXT NOT NULL CHECK (normal IN ('DEBIT','CREDIT')),
     parent_id           TEXT REFERENCES accounts(id),
     status              TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','archived','closed')),
     on_budget           INTEGER NOT NULL DEFAULT 0 CHECK (on_budget IN (0,1)),
     liquid              INTEGER NOT NULL DEFAULT 0 CHECK (liquid IN (0,1)),
     payment_envelope_id TEXT REFERENCES accounts(id),
     envelope_role       TEXT,
     sort_order          INTEGER NOT NULL DEFAULT 0
   );`,

  `CREATE TABLE IF NOT EXISTS entries (
     id                    TEXT PRIMARY KEY,
     kind                  TEXT NOT NULL,
     date                  TEXT NOT NULL CHECK (date LIKE '____-__-__'),
     description           TEXT NOT NULL,
     source_transaction_id TEXT,
     reverses_entry_id     TEXT REFERENCES entries(id),
     sealed                INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0,1)),
     created_at            TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS postings (
     id         TEXT PRIMARY KEY,
     entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
     book       TEXT NOT NULL CHECK (book IN ('FINANCIAL','BUDGET')),
     account_id TEXT NOT NULL REFERENCES accounts(id),
     -- A line for nothing at all is meaningless, and is invariant I2.
     amount     INTEGER NOT NULL CHECK (amount <> 0),
     clearance  TEXT NOT NULL CHECK (clearance IN ('pending','cleared')),
     memo       TEXT,
     sequence   INTEGER NOT NULL
   );`,

  // Regular payments in and out. These are what make "safe to spend" mean
  // anything: money already promised to a bill is not money you can spend.
  `CREATE TABLE IF NOT EXISTS scheduled_items (
     id          TEXT PRIMARY KEY,
     kind        TEXT NOT NULL CHECK (kind IN ('bill','income')),
     name        TEXT NOT NULL,
     amount      INTEGER NOT NULL CHECK (amount > 0),
     next_due    TEXT NOT NULL CHECK (next_due LIKE '____-__-__'),
     cadence     TEXT NOT NULL CHECK (cadence IN ('weekly','fortnightly','monthly','yearly')),
     account_id  TEXT REFERENCES accounts(id),
     category_id TEXT REFERENCES accounts(id),
     active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
   );`,

  `CREATE INDEX IF NOT EXISTS scheduled_due_idx ON scheduled_items(next_due);`,
  `CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(date);`,
  `CREATE INDEX IF NOT EXISTS postings_account_idx ON postings(account_id);`,
  `CREATE INDEX IF NOT EXISTS postings_entry_idx ON postings(entry_id);`,

  `INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
];
