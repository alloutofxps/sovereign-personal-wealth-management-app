/* ===========================================================================
 * THE LIQUIDITY ANCHOR
 * ---------------------------------------------------------------------------
 * The one figure the product is built around.
 *
 * Two different questions can be asked of it and they get two different
 * sheets. Tapping the figure opens the breakdown — every bill by name, every
 * subtraction itemised, which is what somebody wants when they disagree with
 * the number. The information button opens the explanation — what the figure
 * means and how it is reached, which is what somebody wants the first time
 * they see it.
 *
 * That is why the header sits outside the tappable area rather than inside it.
 * A button inside a button is invalid, and collapsing the two questions into
 * one sheet would answer neither well.
 * ======================================================================== */

import type { ExplainTopic } from '@/content/explain';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { Card, Explain, Money } from '@/design/ui';

export function SafeToSpendCard({
  data,
  onExplain,
  onExplainTopic,
}: {
  data: DashboardData;
  /** Opens the itemised breakdown of this household's own figures. */
  onExplain: () => void;
  /** Opens the explanation of what the figure is. */
  onExplainTopic: (topic: ExplainTopic) => void;
}) {
  const { liquidity } = data;
  const short = liquidity.safeToSpend < 0;

  return (
    <Card accent={short ? 'caution' : 'liquid'} padding="none">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <span className="text-caption text-ink-3">Safe to spend</span>
        <Explain topic="safe-to-spend" label="what is safe to spend" onOpen={onExplainTopic} />
      </div>

      <button
        type="button"
        onClick={onExplain}
        className="w-full px-4 pb-4 pt-1 text-left transition-colors hover:bg-raised/40"
        aria-label="See what has been taken off"
      >
        <Money value={liquidity.safeToSpend} size="anchor" tone={short ? 'deficit' : 'liquid'} />

        {short && (
          <p className="pt-2 text-caption text-ink-2">
            Your bills and cushion come to more than you hold today.
          </p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-1 border-t border-line pt-3">
          <Figure
            label="A day"
            value={
              liquidity.dailyPace > 0 ? (
                <Money value={liquidity.dailyPace} size="lead" tone="liquid" decimals="hide" />
              ) : (
                <span className="text-lead text-ink-3">Nothing spare</span>
              )
            }
            detail={
              liquidity.dailyPace > 0
                ? // The days the pace was actually struck over, which is not
                  // the rest of the cycle when payday comes first.
                  `for the next ${liquidity.paceDays} days`
                : 'until more comes in'
            }
          />
          <Figure
            label="Money in"
            value={
              liquidity.daysUntilIncome === null ? (
                <span className="text-lead text-ink-3">Not set</span>
              ) : (
                <span className="tnum text-lead font-medium text-ink">
                  {liquidity.daysUntilIncome === 0
                    ? 'Today'
                    : `${liquidity.daysUntilIncome} ${liquidity.daysUntilIncome === 1 ? 'day' : 'days'}`}
                </span>
              )
            }
            detail={
              liquidity.daysUntilIncome === null ? 'add when you are paid' : 'until you are paid'
            }
          />
          <Figure
            label="Cushion"
            value={<Money value={data.buffer} size="lead" tone="muted" decimals="hide" />}
            detail="kept back for surprises"
          />
        </div>
      </button>
    </Card>
  );
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-caption text-ink-3">{label}</span>
      <span className="truncate">{value}</span>
      <span className="text-micro leading-snug text-ink-3">{detail}</span>
    </div>
  );
}

/** Kept here so the empty state and the real card stay visually identical. */
export function SafeToSpendSkeleton() {
  return (
    <Card accent="liquid">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-raised" />
      <div className="mt-3 h-11 w-52 animate-pulse rounded-sm bg-raised" />
      <div className="mt-3 h-3 w-64 animate-pulse rounded-sm bg-raised" />
    </Card>
  );
}
