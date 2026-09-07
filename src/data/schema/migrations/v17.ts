/* ===========================================================================
 * VERSION 17 — WHAT KIND OF SAVING THIS IS
 * ---------------------------------------------------------------------------
 * A pot has always been able to say how much and by when. What it has never
 * been able to say is which *kind* of saving it is, and there are three that
 * behave completely differently:
 *
 *   · by a date   — €600 for the car insurance by 1 March. The month's share
 *                   is the remainder divided by the months left.
 *   · every month — €50 a month towards the car, indefinitely. The month's
 *                   share is simply €50, and it is never "finished".
 *   · no deadline — save what you can. Nothing is ever required of a month.
 *
 * Until now the first and third were told apart by whether `target_date`
 * happened to be null, and the middle one could not be expressed at all. That
 * is the gap this closes: a person who wants to put fifty a month aside has
 * had to invent a fake deadline, and every rollover then moved it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE SAME FACT AS `target_recurring`
 *
 * They are close enough to be worth saying apart. `target_recurring` means the
 * pot starts again once it has been *paid out* — an annual bill. `target_kind`
 * means how the monthly share is worked out. An annual insurance pot is
 * `by_date` and recurring; a monthly spending pot is `monthly` and not. Both
 * columns are read, neither is derived from the other, and no combination of
 * the two contradicts itself.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO `onboarding_completed_at` COLUMN
 *
 * The brief asked for one on `meta`. `meta` is the key/value table — two
 * columns, `key` and `value` — and has been since v1; the budget cadence and
 * the overspend policy already live in it as rows. A column called
 * `onboarding_completed_at` on a key/value table would be a third column that
 * is null on every row but one, which is not a schema change so much as a
 * misreading of the table.
 *
 * So it is a row: `key = 'onboarding.completed_at'`, `value` = the timestamp.
 * No migration is needed for a row, which is the point — it costs nobody a
 * table rewrite, and it is restored with an export like every other setting.
 * `onboardingRepo` is the only thing that reads or writes it.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** How a pot works out what this month owes it. */
export const POT_TARGET_KINDS = ['by_date', 'monthly', 'open'] as const;
export type PotTargetKindValue = (typeof POT_TARGET_KINDS)[number];

/**
 * The default is `by_date` because that is what every pot created before this
 * version was: the sheet has always opened with "By a certain date" selected.
 * The backfill below then corrects the ones that said "No rush".
 */
export const TARGET_KIND_COLUMN = `TEXT NOT NULL DEFAULT 'by_date'
  CHECK (target_kind IN ('by_date','monthly','open'))`;

export function v17Statements(): string[] {
  return [
    // A pot with no date was open-ended; that is exactly what 'open' means.
    // Scoped to saving pots so an ordinary spending envelope — which has no
    // target of any kind — is left on the harmless default rather than being
    // given a kind it will never use.
    `UPDATE accounts
        SET target_kind = 'open'
      WHERE target_date IS NULL
        AND type = 'ENVELOPE'
        AND envelope_role IN ('goal','sinking_fund');`,

    // Shaped for the query the pots list actually runs, which narrows by role
    // first. On a household's forty-odd accounts SQLite will often scan
    // anyway; this earns its keep on the one part of the chart that grows with
    // how many things a person is saving for.
    `CREATE INDEX IF NOT EXISTS idx_accounts_target_kind
       ON accounts(envelope_role, target_kind);`,
  ];
}

export const V17: MigrationStep = {
  to: 17,
  reason: 'Whether a pot is saving towards a date, topping up every month, or has no deadline.',
  addColumns: [{ table: 'accounts', column: 'target_kind', declaration: TARGET_KIND_COLUMN }],
  statements: v17Statements(),
};
