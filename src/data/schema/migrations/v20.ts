/* ===========================================================================
 * VERSION 20 — A VALUATION SAYS WHO IS SPEAKING
 * ---------------------------------------------------------------------------
 * `valuations` has always held two different kinds of statement:
 *
 *   a person saying   "I reckon this account is worth EUR 3,458"
 *   the app saying    "the holdings in it added up to EUR 1,777.50 today"
 *
 * Nothing distinguished them, and two defects came straight out of that.
 *
 * **The residual was read off the wrong row.** `lastRegisterMark` took the
 * newest valuation of either kind, so an opening figure somebody typed was
 * read back as though the register had already been squared against it. The
 * uninvested-cash residual then computed to zero, the register's incomplete
 * total was adopted as the truth, and the difference was written off as a
 * loss — dated today, and therefore permanent history. Adding one holding to
 * an account worth EUR 3,458 dropped it to EUR 1,777.50 and reported "down
 * EUR 1,681 this month" on a screen.
 *
 * **And the two kinds overwrote each other.** The unique index on
 * (account_id, date) meant a register mark written on the day an account was
 * created replaced the person's own opening figure. The detail sheet then
 * showed the register's total under the caption "What it was worth when you
 * added it" — a destroyed record rather than a mislabelled one.
 *
 * So `kind` is not bookkeeping tidiness; it is the column whose absence let
 * one record be mistaken for the other. The unique index carries it, so both
 * kinds may exist on one day and each still collapses to one row per day.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BACKFILL MATCHES ON `notes`
 *
 * Matching prose is not a thing to do in ongoing logic, and this is not
 * ongoing logic — it runs once, over rows that already exist, and the string
 * is the only evidence those rows carry about which kind they are. Every
 * register mark ever written came from one line in `investmentsRepo`, so the
 * match is exact rather than a guess. Rows that predate the register entirely
 * take the default, `user`, which is the truthful reading of a figure written
 * before the app could compute one.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** The exact string every register mark has carried since v11. */
export const REGISTER_MARK_NOTE = 'What the holdings in this account added up to.';

export function v20Statements(): string[] {
  return [
    `UPDATE valuations SET kind = 'register' WHERE notes = '${REGISTER_MARK_NOTE}';`,
    // The old index cannot coexist with the new one: it is the thing that made
    // a register mark and a hand-typed figure collide on a shared date.
    `DROP INDEX IF EXISTS idx_valuations_account_day;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_valuations_account_day_kind
       ON valuations(account_id, date, kind);`,
  ];
}

export const V20: MigrationStep = {
  to: 20,
  reason: 'Tell a figure somebody typed apart from one the register worked out.',
  addColumns: [
    {
      table: 'valuations',
      column: 'kind',
      // `user` is the safe default: it is what a row means if nothing else is
      // known about it, and it is the kind that must never be overwritten.
      declaration: `TEXT NOT NULL DEFAULT 'user'`,
    },
  ],
  statements: v20Statements(),
};
