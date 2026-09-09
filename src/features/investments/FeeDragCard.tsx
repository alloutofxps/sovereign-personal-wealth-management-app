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
 *
 * ---------------------------------------------------------------------------
 * THE THREE HORIZONS ARE A BAR, NOT THREE BOXES
 *
 * They used to be three identical bordered boxes side by side, which said
 * "here are three unrelated facts". They are one fact measured at three
 * distances, and the thing that makes the point is that the third is not three
 * times the first — it is a curve. So they share a track and the bars are
 * drawn to scale against the longest of them.
 * ======================================================================== */

import { minor } from '@/core/money';
import {
  LOW_COST_BASELINE_BP,
  PROJECTION_CAVEAT,
  describeFeeDrag,
  formatExpenseRatio,
  type FeeDrag,
} from '@/core/investments';
import { useMoney } from '@/app/money/useMoney';
import { Card, Explain, MiniBar } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function FeeDragCard({ drag }: { drag: FeeDrag }) {
  const explain = useExplain({
    feeBp: drag.weightedBp,
    portfolioValue: drag.portfolioValue,
    feeThisYear: drag.annualCost,
  });
  const money = useMoney();

  const action = (
    <Explain topic="fee-drag" label="what the funds charge" onOpen={explain.open} />
  );

  if (drag.portfolioValue <= 0 || drag.weightedBp === 0) {
    return (
      <Card label="What the funds charge" action={action}>
        <p className="py-2 text-caption text-ink-2">
          {describeFeeDrag(drag, (amount) => money.format(amount))}
        </p>
        {explain.sheet}
      </Card>
    );
  }

  /*
   * The scale, and which way round the comparison runs.
   *
   * `versusBaseline` is negative for anybody whose funds are cheaper than the
   * 0.15% comparison, which is most people holding trackers. Scaling on the
   * signed value gave three bars of zero length and a heading that said the
   * opposite of the truth, so the magnitude sets the scale and the direction
   * is said in words once, at the top.
   */
  const dearer = drag.weightedBp > LOW_COST_BASELINE_BP;
  const longest = drag.projections.reduce(
    (most, projection) => Math.max(most, Math.abs(projection.versusBaseline)),
    0,
  );

  return (
    <Card label="What the funds charge" action={action}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink">
          {describeFeeDrag(drag, (amount) => money.format(amount))}
        </p>

        {/* Ten years is long enough to be real and thirty is long enough to be
            the point. Clay, not crimson: this is a cost, not an alarm.

            The caption is a label rather than a sentence: the caveat about
            the fee and the size holding is `PROJECTION_CAVEAT` below, which
            is where that claim already lives. */}
        <div className="cat-obligation flex flex-col gap-2.5">
          <p className="text-caption text-ink-3">
            {dearer ? 'More than a cheap tracker takes' : 'Less than a cheap tracker takes'}
          </p>
          {drag.projections.map((projection) => (
            <div key={projection.years} className="flex flex-col">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption text-ink-2">
                  in {projection.years} years
                </span>
                <span className="tnum text-caption font-medium text-ink">
                  {money.format(minor(Math.abs(projection.versusBaseline)), {
                    decimals: 'hide',
                  })}
                </span>
              </div>
              <MiniBar
                fraction={longest === 0 ? 0 : Math.abs(projection.versusBaseline) / longest}
              />
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
