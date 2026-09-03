/* ===========================================================================
 * MIGRATIONS
 * ---------------------------------------------------------------------------
 * A fresh database gets the current schema straight from the DDL. A database
 * that already holds someone's records gets stepped forward one version at a
 * time, and nothing is ever dropped.
 *
 * Each step is written so running it twice is harmless — new columns are
 * checked against `pragma table_info` first — because a half-applied migration
 * followed by a retry must not be a dead end for somebody's only copy of their
 * financial history.
 * ======================================================================== */

export interface MigrationStep {
  /** The version this step takes the database *to*. */
  to: number;
  /** Why it exists, for anyone reading the history later. */
  reason: string;
  /** `pragma table_info` guards are handled by the runner. */
  addColumns?: { table: string; column: string; declaration: string }[];
  /** Statements run in order, after any columns are added. */
  statements?: string[];
}

export const MIGRATIONS: readonly MigrationStep[] = [
  {
    to: 2,
    reason: 'Regular payments in and out, so safe-to-spend can look forward.',
    statements: [
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
    ],
  },
  {
    to: 3,
    reason: 'Saving-up pots with a target and a date, and money you fronted.',
    addColumns: [
      { table: 'accounts', column: 'target_amount', declaration: 'INTEGER' },
      { table: 'accounts', column: 'target_date', declaration: 'TEXT' },
      { table: 'accounts', column: 'target_recurring', declaration: 'INTEGER NOT NULL DEFAULT 0' },
      { table: 'entries', column: 'claim_id', declaration: 'TEXT' },
    ],
    statements: [
      `CREATE TABLE IF NOT EXISTS claims (
         id             TEXT PRIMARY KEY,
         counterparty   TEXT NOT NULL,
         kind           TEXT NOT NULL CHECK (kind IN
                          ('work_expense','shared_with_friends','insurance','other')),
         expected       INTEGER NOT NULL CHECK (expected > 0),
         settled        INTEGER NOT NULL DEFAULT 0,
         status         TEXT NOT NULL CHECK (status IN
                          ('open','partly_settled','settled','written_off')),
         opened_on      TEXT NOT NULL CHECK (opened_on LIKE '____-__-__'),
         note           TEXT
       );`,
      `CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status);`,
      `CREATE INDEX IF NOT EXISTS entries_claim_idx ON entries(claim_id);`,
    ],
  },
  {
    to: 4,
    reason: 'Interest rates and minimum payments, so a payoff plan can be worked out.',
    addColumns: [
      { table: 'accounts', column: 'apr_bp', declaration: 'INTEGER' },
      { table: 'accounts', column: 'min_payment', declaration: 'INTEGER' },
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce((max, step) => Math.max(max, step.to), 1);
