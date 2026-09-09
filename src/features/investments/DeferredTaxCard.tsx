/* ===========================================================================
 * THE PART OF THIS THAT IS NOT YOURS
 * ---------------------------------------------------------------------------
 * Shown only when somebody has said which tax regime they are under. There is
 * no default and no guess: inferring a regime from a currency would be wrong
 * for every household that has moved, and wrong quietly.
 *
 * The figure is an estimate of one thing and says so. It applies a rate the
 * person entered to a gain the ledger already knows about, and knows nothing
 * about reliefs, losses carried forward, allowances shared with a spouse, or
 * how any particular fund is treated where they live.
 * ======================================================================== */

import { useCallback, useMemo } from 'react';
import { minor, type Minor } from '@/core/money';
import {
  DUTCH_BOX3_2025,
  IRISH_CGT_2025,
  deferredTax,
  describeDeferredTax,
  netWorthAfterTax,
} from '@/core/tax/deferred';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { LEDGER_TABLES, balancesByType, spendableCash } from '@/data/repositories/ledgerRepo';
import { Card, Explain, Money } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';
import { ManualLink } from '@/features/manual/ManualLink';

export function DeferredTaxCard({
  investments,
  costBasis,
}: {
  investments: Minor;
  costBasis: Minor;
}) {
  const money = useMoney();
  const regimeKind = useAppConfig((s) => s.taxRegime);
  const cgtRateBp = useAppConfig((s) => s.cgtRateBp);
  const cgtExemptionMinor = useAppConfig((s) => s.cgtExemptionMinor);

  /**
   * The rest of the household, not just this screen.
   *
   * A deemed-return regime is charged on everything you hold — bank balances
   * included — so working it out from the brokerage alone said "nothing to
   * pay" to a household with twenty-eight thousand in the bank. A gains regime
   * ignores both of these, so the same query serves both and the engine
   * decides what to read.
   *
   * ---------------------------------------------------------------------
   * WHY THE MORTGAGE IS LEFT OUT
   *
   * A home and the mortgage on it are not part of a deemed-return estate —
   * they are taxed under a different heading entirely. Counting a quarter of a
   * million of mortgage against forty thousand of assets made the estate
   * deeply negative and produced a confident nought, which is the most
   * dangerous wrong answer available here: it looks like good news.
   *
   * Cards and ordinary loans do belong, and stay. The card says what it left
   * out rather than quietly leaving it out.
   */
  const estate = useLiveQuery(
    useCallback(async () => {
      const [cash, liabilities] = await Promise.all([
        spendableCash(),
        balancesByType('LIABILITY'),
      ]);
      const counted = liabilities.filter((row) => row.accountClass !== 'mortgage');
      return {
        savings: cash,
        debts: minor(counted.reduce((total, row) => total + Math.max(0, row.baseAmount), 0)),
        excludedMortgage: counted.length !== liabilities.length,
      };
    }, []),
    LEDGER_TABLES,
  );

  const savings = estate.data?.savings ?? minor(0);
  const debts = estate.data?.debts ?? minor(0);

  const result = useMemo(() => {
    if (regimeKind === 'none') return null;
    const regime =
      regimeKind === 'dutch_box3'
        ? DUTCH_BOX3_2025
        : {
            ...IRISH_CGT_2025,
            name: 'tax on the gain',
            rateBp: cgtRateBp as typeof IRISH_CGT_2025.rateBp,
            annualExemption: minor(cgtExemptionMinor),
          };
    return deferredTax({ savings, investments, investmentCostBasis: costBasis, debts }, regime);
  }, [regimeKind, cgtRateBp, cgtExemptionMinor, savings, investments, costBasis, debts]);

  /*
   * The tax explanation answers a different question under each regime, so it
   * is handed the regime as well as the figures. See the note on this topic in
   * the registry: a `short` that spoke only of a gain would be false under a
   * yearly charge, which is the regime this household is actually under.
   */
  const explain = useExplain({
    taxRegime: regimeKind,
    portfolioValue: investments,
    portfolioCost: costBasis,
    ...(result ? { taxAmount: result.amount, reliefApplied: result.reliefApplied } : {}),
  });

  // Nothing until the rest of the household has been read. A deemed-return
  // figure worked out from half the estate is worse than no figure at all.
  if (result === null || estate.data === undefined) return null;

  const after = netWorthAfterTax(minor(savings + investments - debts), result);

  return (
    <Card
      label={
        result.timing === 'every_year' ? 'What holding this costs a year' : 'Tax inside what you hold'
      }
      action={<Explain topic="deferred-tax" label="tax inside what you hold" onOpen={explain.open} />}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-caption text-ink-2">
            {result.timing === 'every_year' ? 'Charged each year' : 'If you sold it all today'}
          </span>
          <Money value={result.amount} size="figure" tone={result.amount > 0 ? 'neutral' : 'muted'} />
        </div>

        <p className="text-caption leading-relaxed text-ink-2">
          {describeDeferredTax(result, (amount) => money.format(amount))}
        </p>

        {after !== null && (
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <span className="text-caption text-ink-2">What that leaves</span>
            <Money value={after} size="lead" tone="liquid" />
          </div>
        )}

        {result.timing === 'every_year' && (
          <p className="text-caption text-ink-3">
            Worked out on your cash, what you hold here, and what you owe on cards and loans.
            {estate.data.excludedMortgage
              ? ' Your home and its mortgage are left out. They are taxed under a different heading.'
              : ''}
          </p>
        )}

        <div className="flex">
          <ManualLink chapter="selling">How a sale is worked out</ManualLink>
        </div>
      </div>
    {explain.sheet}
    </Card>
  );
}
