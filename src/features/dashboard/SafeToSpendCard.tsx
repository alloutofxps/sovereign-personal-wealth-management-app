/* Tier 1 — the liquidity anchor. The one figure the product is built around. */

import type { DashboardData } from '@/app/dashboard/useDashboard';
import { Card, Money } from '@/design/ui';

export function SafeToSpendCard({
  data,
  onExplain,
}: {
  data: DashboardData;
  onExplain: () => void;
}) {
  const { liquidity } = data;
  const short = liquidity.safeToSpend < 0;

  return (
    <Card accent={short ? 'caution' : 'liquid'} padding="none">
      <button
        type="button"
        onClick={onExplain}
        className="w-full px-4 pb-4 pt-4 text-left transition-colors hover:bg-raised/40"
        aria-label="See how this figure is worked out"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-micro font-medium uppercase tracking-[0.13em] text-ink-3">
            Safe to spend
          </span>
          <span className="flex items-center gap-1 text-caption text-ink-3">
            How is this worked out?
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m9 6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        <div className="pt-2">
          <Money
            value={liquidity.safeToSpend}
            size="anchor"
            tone={short ? 'deficit' : 'liquid'}
          />
        </div>

        <p className="max-w-[42ch] pt-2 text-caption text-ink-2">
          {short
            ? 'Your bills and cushion add up to more than you have right now. Tap to see what is ' +
              'taking up the space, and what you could move.'
            : 'This is what is left after your bills, your card, and your safety cushion are ' +
              'taken care of.'}
        </p>

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
                ? `for the next ${liquidity.daysRemaining} days`
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
      <span className="truncate text-micro font-medium uppercase tracking-[0.1em] text-ink-3">
        {label}
      </span>
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
