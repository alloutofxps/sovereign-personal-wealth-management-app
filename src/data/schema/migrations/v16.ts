/* ===========================================================================
 * VERSION 16 — CHECKING THE BOOKS AGAINST THE BANK
 * ---------------------------------------------------------------------------
 * Every figure in this app is derived from what somebody typed or imported.
 * That is a good design and it has one hole in it: nothing has ever confirmed
 * that the total agrees with what the bank thinks. A ledger nobody has checked
 * is a ledger nobody should fully trust, and the person using it knows that
 * even if they could not say why.
 *
 * Reconciliation closes the hole. You take the statement, tick off what has
 * gone through, and either it comes to exactly the same figure or it does not.
 * When it does, that stretch of history is locked — not because anybody
 * distrusts the person, but because a record they have personally checked
 * against the bank is worth more than one they can still change by accident.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO 'reconciled' CLEARANCE VALUE
 *
 * The brief asked for both a third `clearance` state and a `reconciled_at`
 * timestamp. Those are the same fact written down twice, and the timestamp is
 * strictly the better half of the pair — the interface has to say *when* a
 * record was locked ("locked during your statement check on 4 September"), so
 * the date has to exist either way. Adding the enum value as well would mean
 * two columns that can disagree, and nothing to say which one is right.
 *
 * So: `reconciled_at IS NOT NULL` is what "locked" means, and it is the only
 * place that is stored. The three-state value the rest of the app reads is
 * derived on the way out of the database, in one function, which is why it
 * cannot drift.
 *
 * There is a second reason, and it is the practical one. `clearance` carries a
 * CHECK constraint, and SQLite cannot widen a CHECK without rebuilding the
 * whole table. `postings` is the largest table here and it carries five
 * indexes and three full-text triggers that only exist when the engine
 * supports FTS. Dropping and recreating all of that, on somebody's only copy
 * of their financial history, to store a fact already stored in the column
 * next to it, is not a trade worth making.
 *
 * ---------------------------------------------------------------------------
 * ON BACKFILLING
 *
 * The brief asked for existing postings to be set to 'cleared'. They already
 * are: `clearance` has been NOT NULL since the first schema and every write
 * path supplies it, so there is nothing to backfill. The statement below is
 * written anyway, scoped to rows that somehow hold neither valid value, so
 * that running it changes nothing on a healthy database and repairs one that
 * is not. Running it twice is the same as running it once.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** What a statement check can conclude. */
export const RECONCILIATION_STATUSES = ['completed', 'reconciled_with_adjustment'] as const;

/**
 * One completed statement check.
 *
 * Kept even when it balanced exactly, because "this account was checked
 * against the bank on these dates and agreed every time" is the sentence the
 * whole feature exists to be able to say.
 */
const RECONCILIATIONS = `CREATE TABLE IF NOT EXISTS reconciliations (
   id                TEXT PRIMARY KEY,
   account_id        TEXT NOT NULL REFERENCES accounts(id),
   statement_date    TEXT NOT NULL CHECK (statement_date LIKE '____-__-__'),
   -- What the bank said.
   statement_balance INTEGER NOT NULL,
   -- What we had, counting only what had gone through.
   cleared_balance   INTEGER NOT NULL,
   -- The bank's figure less ours. Zero on a clean check, and it usually is.
   discrepancy       INTEGER NOT NULL DEFAULT 0,
   status            TEXT NOT NULL DEFAULT 'completed'
                       CHECK (status IN ('completed','reconciled_with_adjustment')),
   created_at        TEXT NOT NULL
 );`;

export function v16Statements(): string[] {
  return [
    RECONCILIATIONS,
    `CREATE INDEX IF NOT EXISTS idx_reconciliations_account_date
       ON reconciliations(account_id, statement_date DESC);`,

    // Exactly the shape the reconciliation screen reads in: one account, the
    // locked ones separated from the rest.
    `CREATE INDEX IF NOT EXISTS idx_postings_clearance
       ON postings(account_id, clearance, reconciled_at);`,

    // A no-op on any healthy database; see the note above.
    `UPDATE postings SET clearance = 'cleared'
      WHERE clearance IS NULL OR clearance NOT IN ('pending','cleared');`,
  ];
}

export const V16: MigrationStep = {
  to: 16,
  reason:
    'Which payments you have checked against your bank statement, and when you checked them.',
  addColumns: [
    // Null means "not checked yet", which is every posting that exists today.
    { table: 'postings', column: 'reconciled_at', declaration: 'TEXT' },
  ],
  statements: v16Statements(),
};
