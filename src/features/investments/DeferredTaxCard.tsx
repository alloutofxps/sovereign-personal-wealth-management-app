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

import { useMemo } from 'react';
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
import { Card, Money } from '@/design/ui';
import { ManualLink } from '@/features/manual/ManualLink';

export function DeferredTaxCard({
  investments,
  costBasis,
  savings,
  debts,
}: {
  investments: Minor;
  costBasis: Minor;
  savings: Minor;
  debts: Minor;
}) {
  const money = useMoney();
  const regimeKind = useAppConfig((s) => s.taxRegime);
  const cgtRateBp = useAppConfig((s) => s.cgtRateBp);
  const cgtExemptionMinor = useAppConfig((s) => s.cgtExemptionMinor);

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

  if (result === null) return null;

  const after = netWorthAfterTax(minor(savings + investments - debts), result);

  return (
    <Card label={result.timing === 'every_year' ? 'What holding this costs a year' : 'Tax waiting inside this'}>
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

        <div className="flex">
          <ManualLink chapter="selling">How a sale is worked out</ManualLink>
        </div>
      </div>
    </Card>
  );
}
