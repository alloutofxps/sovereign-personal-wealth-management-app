/* Tier 3 — the balance sheet, said in plain words. */

import clsx from 'clsx';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { Card, Money } from '@/design/ui';

export function BalanceCard({ data }: { data: DashboardData }) {
  const have = Math.max(0, data.liquidCash);
  const owe = Math.max(0, data.totalDebt);
  const span = have + owe || 1;
  const havePercent = (have / span) * 100;

  return (
    <Card label="What you are worth">
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <Money
            value={data.netWorth}
            size="figure"
            tone={data.netWorth < 0 ? 'deficit' : 'neutral'}
          />
          {data.totalDebt > 0 && (
            <span
              className={clsx(
                'rounded-pill px-2.5 py-1 text-micro font-medium',
                data.billsCovered ? 'bg-liquid-wash text-liquid' : 'bg-caution-wash text-caution',
              )}
            >
              {data.billsCovered ? 'Card bills covered' : 'Card bill not fully covered'}
            </span>
          )}
        </div>

        {/* One bar, two tones: what you have against what you owe. */}
        <div className="flex h-2 overflow-hidden rounded-pill bg-sunken" aria-hidden="true">
          <div className="h-full bg-liquid" style={{ width: `${havePercent}%` }} />
          <div className="h-full bg-deficit" style={{ width: `${100 - havePercent}%` }} />
        </div>

        <div className="flex items-start justify-between gap-4">
          <Legend swatch="bg-liquid" label="What you have" value={data.liquidCash} />
          <Legend swatch="bg-deficit" label="What you owe" value={data.totalDebt} align="right" />
        </div>

        {data.totalDebt > 0 && (
          <p className="border-t border-line pt-3 text-caption text-ink-2">
            {data.billsCovered
              ? 'Every penny on your cards already has money waiting for it, so your next bill ' +
                'will not come as a surprise.'
              : 'There is a little less put by than your cards currently owe. Nothing is due ' +
                'yet — it just means part of the bill is not covered.'}
          </p>
        )}
      </div>
    </Card>
  );
}

function Legend({
  swatch,
  label,
  value,
  align = 'left',
}: {
  swatch: string;
  label: string;
  value: DashboardData['liquidCash'];
  align?: 'left' | 'right';
}) {
  return (
    <div className={clsx('flex flex-col gap-1', align === 'right' && 'items-end')}>
      <span className="flex items-center gap-1.5 text-micro uppercase tracking-[0.1em] text-ink-3">
        <span className={clsx('size-1.5 rounded-full', swatch)} aria-hidden="true" />
        {label}
      </span>
      <Money value={value} size="lead" />
    </div>
  );
}
