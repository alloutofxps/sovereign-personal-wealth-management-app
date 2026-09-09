/* ===========================================================================
 * WHAT THE FUNDS CHARGE
 * ---------------------------------------------------------------------------
 * The only cost most people carry that they are never shown. It comes out of
 * the fund's value before the price is published, so no statement lists it and
 * no bank alert mentions it.
 *
 * Written calm on purpose. Somebody who has just learned that their funds will
 * take five figures off their retirement does not need an exclamation mark or
 * a red number — they need the figure, the comparison, and no instruction
 * about what to do with either. This app does not know their plans, their
 * nerve or their tax position, and telling them which fund to hold would be
 * advice it is in no position to give.
 * ======================================================================== */

import {
  LOW_COST_BASELINE_BP,
  PROJECTION_CAVEAT,
  describeFeeDrag,
  formatExpenseRatio,
  type FeeDrag,
} from '@/core/investments';
import { useMoney } from '@/app/money/useMoney';
import { Card, Explain, Money } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function FeeDragCard({ drag }: { drag: FeeDrag }) {
  const explain = useExplain({
    feeBp: drag.weightedBp,
    portfolioValue: drag.portfolioValue,
    feeThisYear: drag.annualCost,
  });
  const money = useMoney();

  if (drag.portfolioValue <= 0 || drag.weightedBp === 0) {
    return (
      <Card
        label="What the funds charge"
        action={<Explain topic="fee-drag" label="what the funds charge" onOpen={explain.open} />}
      >
        <p className="py-2 text-caption text-ink-2">
          {describeFeeDrag(drag, (amount) => money.format(amount))}
        </p>
        {explain.sheet}
      </Card>
    );
  }

  return (
    <Card
      label="What the funds charge"
      action={<Explain topic="fee-drag" label="what the funds charge" onOpen={explain.open} />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink">
          {describeFeeDrag(drag, (amount) => money.format(amount))}
        </p>

        {/* The three horizons, side by side. Ten years is long enough to be
            real and thirty is long enough to be the point. */}
        <div className="grid grid-cols-3 gap-2">
          {drag.projections.map((projection) => (
            <div
              key={projection.years}
              className="flex flex-col gap-1 rounded-md border border-line bg-raised px-3 py-2.5"
            >
              <span className="text-caption text-ink-3">
                {projection.years} years
              </span>
              <Money value={projection.versusBaseline} size="caption" tone="caution" />
              <span className="text-micro text-ink-3">more than a cheap tracker</span>
            </div>
          ))}
        </div>

        {drag.costliest && drag.costliest.expenseRatioBp > LOW_COST_BASELINE_BP && (
          <p className="text-caption text-ink-2">
            The dearest thing you hold is {drag.costliest.symbol} at{' '}
            {formatExpenseRatio(drag.costliest.expenseRatioBp)} a year. Whether that is worth
            paying is a judgement about the fund, not about the number.
          </p>
        )}

        <p className="text-caption text-ink-3">{PROJECTION_CAVEAT}</p>
      </div>
    {explain.sheet}
    </Card>
  );
}
