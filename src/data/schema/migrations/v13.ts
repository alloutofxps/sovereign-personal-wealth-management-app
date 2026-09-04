/* ===========================================================================
 * VERSION 13 — TAX TAKEN AT SOURCE IS NOT YOUR SPENDING
 * ---------------------------------------------------------------------------
 * Slice 7.2 booked withholding tax on a dividend to an EXPENSE account. That
 * is defensible bookkeeping and it is wrong for this app, because EXPENSE here
 * does not mean "a cost" — it means "money you chose to spend", and that
 * meaning is load-bearing. Every spending query, the daily burn rate, the
 * pacing curve, the Safe-to-Spend allowance and the "where it went" breakdown
 * are all built on it.
 *
 * The effect was small and pointed the wrong way: €15 of tax on a €100
 * dividend appeared as €15 of spending in a month where nothing was bought.
 * On a portfolio paying quarterly it would drift a pacing curve upward against
 * a person's actual behaviour, and on a large one it could push a month into a
 * deficit warning for money the person never had the option to keep.
 *
 * So the account changes type rather than being filtered out of a growing list
 * of queries. Structure beats a runtime rule here: as an EQUITY node it cannot
 * reach a spending figure at all, because every one of those queries selects on
 * `type = 'EXPENSE'`. A flag would have to be honoured by each of them
 * separately, and by every query written after this one.
 *
 * Debiting an equity account is the same shape `realizedLoss` and
 * `unrealizedLoss` already use: something reduced what you are worth without
 * being a purchase. That is exactly what tax deducted before the money reached
 * you is.
 *
 * The account keeps its id so every posting ever made to it comes along. Past
 * dividends stop counting as spending retroactively, which is the point — the
 * curves were wrong then too.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** The account that has held withholding tax since Slice 7.2. */
export const DIVIDEND_TAX_ACCOUNT_ID = 'cat-tax';

export function v13Statements(): string[] {
  return [
    // Type and normal together: EQUITY is credit-normal, and this account is
    // debited, so it reduces equity the way a realised loss does.
    `UPDATE accounts
        SET type = 'EQUITY',
            normal = 'CREDIT',
            name = 'Tax taken from your investments'
      WHERE id = '${DIVIDEND_TAX_ACCOUNT_ID}';`,

    // The account is no longer a spending category, so it must stop being
    // offered as one. It was never a parent of anything, so nothing is
    // orphaned by this.
    `UPDATE accounts
        SET envelope_role = NULL
      WHERE id = '${DIVIDEND_TAX_ACCOUNT_ID}';`,
  ];
}

export const V13: MigrationStep = {
  to: 13,
  reason:
    'Tax withheld on a dividend is not money you chose to spend, so it stops counting ' +
    'towards spending, pacing and what is safe to spend.',
  statements: v13Statements(),
};
