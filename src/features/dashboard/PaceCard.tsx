/* Tier 2 — how fast the money is going, and the curve behind it. */

import clsx from 'clsx';
import { CADENCE_NOUNS, paceLabel, type PaceStatus } from '@/core/liquidity';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { describeDate, shortDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { CumulativeSpend } from '@/charts/CumulativeSpend';
import type { ExplainTopic } from '@/content/explain';
import { Card, Explain } from '@/design/ui';

const TONE: Record<PaceStatus, { text: string; bar: string; chip: string }> = {
  on_track: { text: 'text-liquid', bar: 'bg-liquid', chip: 'bg-liquid-wash text-liquid' },
  ahead: { text: 'text-liquid', bar: 'bg-liquid', chip: 'bg-liquid-wash text-liquid' },
  // Amber, never red. Spending quickly is information, not a failure.
  fast: { text: 'text-caution', bar: 'bg-caution', chip: 'bg-caution-wash text-caution' },
  no_plan: { text: 'text-ink-2', bar: 'bg-ink-4', chip: 'bg-raised text-ink-2' },
};

export function PaceCard({
  data,
  onExplainTopic,
}: {
  data: DashboardData;
  onExplainTopic: (topic: ExplainTopic) => void;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const { pacing } = data;
  const tone = TONE[pacing.status];
  // Whatever the person actually budgets in. Somebody paid fortnightly is not
  // living in months, and the bars should not tell them they are.
  const periodNoun = CADENCE_NOUNS[data.cadence];

  return (
    <Card
      label="Spending pace"
      action={
        <span className="flex items-center gap-1">
          <span className={clsx('rounded-pill px-2 py-0.5 text-micro font-medium', tone.chip)}>
            {paceLabel(pacing.status)}
          </span>
          <Explain topic="pace" label="your spending pace" onOpen={onExplainTopic} />
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <Bar
            label={`${periodNoun.charAt(0).toUpperCase()}${periodNoun.slice(1)} gone`}
            percent={pacing.elapsedPercent}
            barClass="bg-ink-4"
            valueClass="text-ink-2"
          />
          <Bar
            label="Money gone"
            percent={pacing.spentPercent}
            barClass={tone.bar}
            valueClass={tone.text}
            periodNoun={periodNoun}
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
            {/*
              * A legend, not a paragraph.
              *
              * This was three sentences explaining what the two lines were and
              * that the chart could be dragged. The first two are what the
              * information button now says — and says better, with this
              * household's own percentages in it — and the third was explaining
              * the interface, which no explanation in this app is allowed to
              * do. What is left is the one thing a legend is for: which line
              * is which.
              */}
            <div className="flex gap-4 pt-2 text-micro text-ink-3">
              <span className="flex items-center gap-1.5">
                <i aria-hidden="true" className={clsx('h-[2.5px] w-3.5 rounded-pill', tone.bar)} />
                Spent
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  aria-hidden="true"
                  className="w-3.5 border-t-2 border-dashed border-ink-4"
                />
                Even spread
              </span>
            </div>
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
  periodNoun = 'month',
}: {
  label: string;
  percent: number;
  barClass: string;
  valueClass: string;
  periodNoun?: string;
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
          That is a little past the even-spread line for this point in the {periodNoun}.
        </span>
      )}
    </div>
  );
}
