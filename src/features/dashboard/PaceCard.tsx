/* Tier 2 — how fast the money is going, and the curve behind it. */

import clsx from 'clsx';
import { paceLabel, type PaceStatus } from '@/core/liquidity';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { describeDate, shortDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { CumulativeSpend } from '@/charts/CumulativeSpend';
import { Card } from '@/design/ui';

const TONE: Record<PaceStatus, { text: string; bar: string; chip: string }> = {
  on_track: { text: 'text-liquid', bar: 'bg-liquid', chip: 'bg-liquid-wash text-liquid' },
  ahead: { text: 'text-liquid', bar: 'bg-liquid', chip: 'bg-liquid-wash text-liquid' },
  // Amber, never red. Spending quickly is information, not a failure.
  fast: { text: 'text-caution', bar: 'bg-caution', chip: 'bg-caution-wash text-caution' },
  no_plan: { text: 'text-ink-2', bar: 'bg-ink-4', chip: 'bg-raised text-ink-2' },
};

export function PaceCard({ data }: { data: DashboardData }) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const { pacing } = data;
  const tone = TONE[pacing.status];

  return (
    <Card label="How fast you are spending" action={
      <span className={clsx('rounded-pill px-2 py-0.5 text-micro font-medium', tone.chip)}>
        {paceLabel(pacing.status)}
      </span>
    }>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <Bar
            label="Month gone"
            percent={pacing.elapsedPercent}
            barClass="bg-ink-4"
            valueClass="text-ink-2"
          />
          <Bar
            label="Money gone"
            percent={pacing.spentPercent}
            barClass={tone.bar}
            valueClass={tone.text}
          />
        </div>

        <p className="max-w-[46ch] text-caption text-ink-2">{pacing.message}</p>

        {pacing.allowance > 0 && (
          <div className="border-t border-line pt-3">
            <CumulativeSpend
              points={pacing.curve}
              today={data.today}
              format={(amount) => money.format(amount, { decimals: 'adaptive' })}
              formatDate={(iso) => describeDate(iso, locale)}
              formatAxisDate={(iso) => shortDate(iso, locale)}
            />
            <p className="pt-1 text-micro text-ink-3">
              The solid line is what you have spent. The dotted one is where you would be
              spending the same amount every day. Drag across to look at any day.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Bar({
  label,
  percent,
  barClass,
  valueClass,
}: {
  label: string;
  percent: number;
  barClass: string;
  valueClass: string;
}) {
  const width = Math.min(100, Math.max(0, percent));
  const over = percent > 100;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-ink-2">{label}</span>
        <span className={clsx('tnum text-caption font-medium', valueClass)}>
          {Math.round(percent)}%
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-pill bg-sunken"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={clsx('h-full rounded-pill transition-[width] duration-500', barClass)}
          style={{ width: `${width}%` }}
        />
      </div>
      {over && (
        <span className="text-micro text-caution">
          That is a little past the even-spread line for this point in the month.
        </span>
      )}
    </div>
  );
}
