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

import { LATEST_VERSION } from './migrations';

export const SCHEMA_VERSION = LATEST_VERSION;

/**
 * Run before anything else, including before migrations.
 *
 * Migrations need somewhere to read and write the version number, and the
 * rest of the DDL cannot run until an older database has been brought up to
 * date — a new index over a column a migration is about to add would fail.
 */
export const BOOTSTRAP_DDL: readonly string[] = [
  `PRAGMA foreign_keys = ON;`,
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

export const DDL: readonly string[] = [
  ...BOOTSTRAP_DDL,

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
     sort_order          INTEGER NOT NULL DEFAULT 0,
     -- Pots that are saving up for something carry their own target.
     target_amount       INTEGER,
     target_date         TEXT,
     target_recurring    INTEGER NOT NULL DEFAULT 0,
     -- Borrowing terms, so what you owe can be planned rather than guessed.
     apr_bp              INTEGER,
     min_payment         INTEGER,
     credit_limit        INTEGER,
     due_day             INTEGER CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 28)),
     -- Archived rather than deleted: past months have to keep adding up, and
     -- a deleted account would orphan every posting that ever pointed at it.
     archived_at         TEXT,
     color_token         TEXT,
     icon                TEXT
   );`,

  `CREATE TABLE IF NOT EXISTS entries (
     id                    TEXT PRIMARY KEY,
     kind                  TEXT NOT NULL,
     date                  TEXT NOT NULL CHECK (date LIKE '____-__-__'),
     description           TEXT NOT NULL,
     source_transaction_id TEXT,
     reverses_entry_id     TEXT REFERENCES entries(id),
     sealed                INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0,1)),
     created_at            TEXT NOT NULL,
     -- Set on the two entries that open and settle money you fronted.
     claim_id              TEXT
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

  // Patterns that file a statement row without being asked twice.
  `CREATE TABLE IF NOT EXISTS rules (
     id              TEXT PRIMARY KEY,
     pattern         TEXT NOT NULL,
     is_regex        INTEGER NOT NULL DEFAULT 0 CHECK (is_regex IN (0,1)),
     match_field     TEXT NOT NULL DEFAULT 'description'
                       CHECK (match_field IN ('description','raw_descriptor')),
     category_id     TEXT NOT NULL REFERENCES accounts(id),
     envelope_id     TEXT NOT NULL REFERENCES accounts(id),
     priority        INTEGER NOT NULL DEFAULT 0,
     active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
     match_count     INTEGER NOT NULL DEFAULT 0,
     last_matched_at TEXT,
     created_at      TEXT NOT NULL
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

  // Money you paid out that somebody else owes you back.
  `CREATE TABLE IF NOT EXISTS claims (
     id           TEXT PRIMARY KEY,
     counterparty TEXT NOT NULL,
     kind         TEXT NOT NULL CHECK (kind IN
                    ('work_expense','shared_with_friends','insurance','other')),
     expected     INTEGER NOT NULL CHECK (expected > 0),
     settled      INTEGER NOT NULL DEFAULT 0,
     status       TEXT NOT NULL CHECK (status IN
                    ('open','partly_settled','settled','written_off')),
     opened_on    TEXT NOT NULL CHECK (opened_on LIKE '____-__-__'),
     note         TEXT
   );`,

  // Statement rows waiting for a quick look. Ephemeral by design: once a row
  // is confirmed it becomes a journal entry, and the queue empties.
  `CREATE TABLE IF NOT EXISTS staged_transactions (
     id          TEXT PRIMARY KEY,
     account_id  TEXT NOT NULL REFERENCES accounts(id),
     date        TEXT NOT NULL CHECK (date LIKE '____-__-__'),
     amount      INTEGER NOT NULL CHECK (amount <> 0),
     description TEXT NOT NULL,
     raw         TEXT NOT NULL,
     dedupe_key  TEXT NOT NULL UNIQUE,
     status      TEXT NOT NULL CHECK (status IN ('unreviewed','reviewed','ignored')),
     entry_id    TEXT REFERENCES entries(id),
     imported_at TEXT NOT NULL,
     batch_id    TEXT NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS staged_status_idx ON staged_transactions(status);`,
  `CREATE INDEX IF NOT EXISTS idx_rules_active_priority ON rules(active, priority ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_book_type ON accounts(book, type, archived_at);`,
  `CREATE INDEX IF NOT EXISTS scheduled_due_idx ON scheduled_items(next_due);`,
  `CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status);`,
  `CREATE INDEX IF NOT EXISTS entries_claim_idx ON entries(claim_id);`,
  `CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(date);`,
  `CREATE INDEX IF NOT EXISTS postings_account_idx ON postings(account_id);`,
  `CREATE INDEX IF NOT EXISTS postings_entry_idx ON postings(entry_id);`,

  `INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
];
