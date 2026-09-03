/* ===========================================================================
 * VERSION 9 — MORE WAYS FOR A BILL TO REPEAT, AND WATCHING WHAT THEY COST
 * ---------------------------------------------------------------------------
 * The four cadences shipped in v2 could not describe how a great many people
 * are actually paid. Semi-monthly payroll — the 15th and the last day — is the
 * obvious gap, and it is not expressible as "every N days": the two halves of
 * the month are different lengths, and February is different again.
 *
 * SQLite cannot alter a CHECK constraint, so the table is rebuilt. Two things
 * about that are worth being careful about, because getting either wrong loses
 * somebody's bills:
 *
 *   · Two cadences are being *renamed*, not added. 'fortnightly' becomes
 *     'biweekly' and 'yearly' becomes 'annual'. Copying the old values across
 *     unchanged would fail the new CHECK and roll the whole migration back, so
 *     the copy maps them explicitly.
 *
 *   · The brief specified an index on `next_due_date`. That column does not
 *     exist — it has been `next_due` since v2 — so the index is created on the
 *     real column. An index naming a column that is not there fails at
 *     migration time, which is the worst possible moment.
 *
 * The whole thing runs inside the migration runner's transaction, so a failure
 * anywhere leaves the old table exactly as it was.
 *
 * On idempotency, plainly: the runner gates each step by version and runs it
 * once, and the sequence below is safe to retry after a failure because it
 * starts by dropping any half-built table. If it were somehow run a second
 * time against an already-migrated database every bill would survive — the
 * copy only names columns both shapes have — but the surveillance baseline
 * would reset to the scheduled amount and any dismissed dormancy notices
 * would come back. No records are lost either way.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/**
 * How the old cadence values map onto the new set.
 *
 * Anything unrecognised falls back to monthly rather than failing the CHECK:
 * a bill on the wrong rhythm is a visible, fixable annoyance, and a migration
 * that rolls back leaves the person unable to open the app at all.
 */
export const CADENCE_MIGRATION: Record<string, string> = {
  weekly: 'weekly',
  fortnightly: 'biweekly',
  monthly: 'monthly',
  yearly: 'annual',
};

const NEW_TABLE = `CREATE TABLE scheduled_items_v9 (
   id                        TEXT PRIMARY KEY,
   kind                      TEXT NOT NULL CHECK (kind IN ('bill','income')),
   name                      TEXT NOT NULL,
   amount                    INTEGER NOT NULL CHECK (amount > 0),
   next_due                  TEXT NOT NULL CHECK (next_due LIKE '____-__-__'),
   cadence                   TEXT NOT NULL CHECK (cadence IN
                               ('daily','weekly','biweekly','semimonthly',
                                'monthly','quarterly','annual')),
   account_id                TEXT REFERENCES accounts(id),
   category_id               TEXT REFERENCES accounts(id),
   active                    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
   -- What this is supposed to cost, so a charge above it can be noticed.
   expected_amount           INTEGER NOT NULL DEFAULT 0,
   -- What it last actually cost, and when.
   last_amount               INTEGER,
   last_billed_date          TEXT,
   -- Set when somebody has said they are happy with a quiet subscription.
   dormant_alert_dismissed_at TEXT
 );`;

/**
 * Copy the old rows across, translating as they go.
 *
 * `expected_amount` starts as the scheduled amount, which is the only sensible
 * baseline: it is what the person said the bill was, and price-creep detection
 * measures everything against it.
 */
const COPY = `INSERT INTO scheduled_items_v9
   (id, kind, name, amount, next_due, cadence, account_id, category_id, active,
    expected_amount, last_amount, last_billed_date, dormant_alert_dismissed_at)
 SELECT id, kind, name, amount, next_due,
        CASE cadence
          WHEN 'fortnightly' THEN 'biweekly'
          WHEN 'yearly'      THEN 'annual'
          WHEN 'weekly'      THEN 'weekly'
          WHEN 'monthly'     THEN 'monthly'
          ELSE 'monthly'
        END,
        account_id, category_id, active,
        amount, NULL, NULL, NULL
   FROM scheduled_items;`;

export function scheduledItemsV9Statements(): string[] {
  return [
    // Always start from nothing, so the sequence does the same thing whether
    // it is the first attempt or a retry after an interrupted one. Leaving a
    // half-built table behind and then adding to it with IF NOT EXISTS is how
    // a retry ends up with duplicated or half-copied rows.
    `DROP TABLE IF EXISTS scheduled_items_v9;`,
    NEW_TABLE,
    COPY,
    `DROP TABLE IF EXISTS scheduled_items;`,
    `ALTER TABLE scheduled_items_v9 RENAME TO scheduled_items;`,
    // Recreated because the index went with the old table.
    `CREATE INDEX IF NOT EXISTS scheduled_due_idx ON scheduled_items(next_due);`,
    // The brief asked for this on `next_due_date`; the column is `next_due`.
    `CREATE INDEX IF NOT EXISTS idx_scheduled_active_due ON scheduled_items(active, next_due ASC);`,
  ];
}

export const V9: MigrationStep = {
  to: 9,
  reason: 'Semi-monthly payroll and the rest of the real cadences, and watching what bills cost.',
  statements: scheduledItemsV9Statements(),
};
