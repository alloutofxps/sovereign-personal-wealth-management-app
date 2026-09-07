/* ===========================================================================
 * WHERE IT ALL WENT
 * ---------------------------------------------------------------------------
 * Three answers to three different questions: the shape of a period, what the
 * biggest things were, and whether any of it is unusual.
 *
 * The third one is the only novel thing here, and it is mostly restraint. A
 * young ledger gets told plainly that there is no baseline yet, rather than a
 * chart of confident numbers derived from three weeks of records.
 * ======================================================================== */

import { useState } from 'react';
import { toIsoDate } from '@/core/liquidity';
import { describePace, describeShare } from '@/core/analytics';
import {
  HORIZON_LABELS,
  useAnalytics,
  useMedianMarks,
  type Horizon,
} from '@/app/analytics/useAnalytics';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { CategoryBars, MedianTickKey } from '@/charts/CategoryBars';
import { SankeyFlow, SankeyLegend } from '@/charts/SankeyFlow';
import { BottomSheet, Button, Card, Money, Tabs } from '@/design/ui';

const HORIZONS: Horizon[] = ['this-month', 'last-month', 'trailing-90', 'year-to-date'];

export function AnalyticsView() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const [horizon, setHorizon] = useState<Horizon>('this-month');
  const [itemised, setItemised] = useState<
    { name: string; members: { id: string; name: string; amount: number }[] } | null
  >(null);

  const analytics = useAnalytics(horizon);
  const data = analytics.data;
  const medians = useMedianMarks(data);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Where it went</h1>
        <p className="text-caption text-ink-2">
          What came in, what went out, and how that compares with your usual.
        </p>
      </header>

      <Tabs
        label="Which period to look at"
        value={horizon}
        onChange={setHorizon}
        tabs={HORIZONS.map((value) => ({ value, label: HORIZON_LABELS[value] }))}
      />

      {data === undefined ? (
        <Card>
          <p className="py-8 text-center text-caption text-ink-3">Working it out…</p>
        </Card>
      ) : data.emptyLedger ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">Nothing to look at yet</p>
            <p className="max-w-[38ch] text-caption text-ink-2">
              Once you have recorded a few payments, this is where you will see what your money
              actually did.
            </p>
            <Button variant="secondary" onClick={() => navigate('home')}>
              Back to your money
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* --- the flow ------------------------------------------------- */}
          <Card label={`Where your money went · ${data.period.label.toLowerCase()}`}>
            {data.flow.empty ? (
              <p className="py-6 text-center text-caption text-ink-2">
                Nothing was recorded in this period. Try a wider window above.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-caption text-ink-2">Money in</span>
                  <Money value={data.flow.totalIn} size="lead" tone="liquid" />
                </div>

                <SankeyFlow
                  graph={data.flow}
                  format={(amount) => money.format(amount)}
                  onSelectNode={(node) => {
                    if (node.members?.length) {
                      setItemised({ name: node.name, members: node.members });
                    }
                  }}
                />

                <SankeyLegend graph={data.flow} />

                {data.flow.drewOnReserves && (
                  <p className="text-caption text-caution">
                    You spent {money.format(data.flow.totalOut)} against{' '}
                    {money.format(
                      (data.flow.totalIn - (data.flow.retained < 0 ? -data.flow.retained : 0)) as never,
                    )}{' '}
                    coming in, so the difference came out of what you had already put by. That is
                    what savings are for. It is only worth watching if it becomes the pattern.
                  </p>
                )}

                {data.flow.retained > 0 && (
                  <p className="text-caption text-ink-2">
                    {money.format(data.flow.retained)} of what came in is still sitting in your
                    accounts.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* --- the ranking ---------------------------------------------- */}
          <Card label="Spending by group and category">
            {data.distribution.empty ? (
              <p className="py-6 text-center text-caption text-ink-2">
                No spending recorded in this period.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-caption text-ink-2">
                  {data.distribution.groups[0]
                    ? `${data.distribution.groups[0].groupName} was the biggest, at ` +
                      `${describeShare(data.distribution.groups[0].shareBp)}.`
                    : 'Tap a group to see what is underneath it.'}
                </p>

                <CategoryBars
                  distribution={data.distribution}
                  format={(amount) => money.format(amount)}
                  {...(medians ? { medians } : {})}
                />

                {medians && <MedianTickKey />}
              </div>
            )}
          </Card>

          {/* --- the rhythm ----------------------------------------------- */}
          <RhythmCard data={data} />
        </>
      )}

      <BottomSheet
        open={itemised !== null}
        onClose={() => setItemised(null)}
        title={itemised?.name ?? 'Everything else'}
        description="The smaller things, gathered up so the chart stays readable."
      >
        <ul className="flex flex-col gap-2 pb-2">
          {itemised?.members
            .slice()
            .sort((a, b) => b.amount - a.amount)
            .map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-body text-ink">{member.name}</span>
                <Money value={member.amount as never} size="body" />
              </li>
            ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

function RhythmCard({ data }: { data: NonNullable<ReturnType<typeof useAnalytics>['data']> }) {
  const money = useMoney();
  const baselines = data.baselines;

  if (baselines.status === 'insufficient_history') {
    return (
      <Card label="How this compares to your normal" accent="caution">
        <div className="flex flex-col gap-2">
          <p className="text-body text-ink">Still learning your rhythm</p>
          <p className="text-caption text-ink-2">{baselines.explanation}</p>
          <p className="text-caption text-ink-3">
            {baselines.daysRecorded === 0
              ? 'Nothing recorded yet.'
              : `About ${Math.round(baselines.daysRecorded / 7)} ${
                  Math.round(baselines.daysRecorded / 7) === 1 ? 'week' : 'weeks'
                } of records so far.`}
          </p>
        </div>
      </Card>
    );
  }

  const notable = baselines.categories.filter((c) => c.runningHot || c.runningCool);

  return (
    <Card label="How this compares to your normal">
      {notable.length === 0 ? (
        <p className="text-caption text-ink-2">
          Everything is running about where it usually does. Nothing here needs you.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notable.map((baseline) => (
            <li key={baseline.categoryId} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body text-ink">{baseline.categoryName}</span>
                <Money
                  value={baseline.currentSpend}
                  size="body"
                  tone={baseline.runningHot ? 'caution' : 'muted'}
                />
              </div>
              <p
                className={
                  baseline.runningHot ? 'text-caption text-caution' : 'text-caption text-ink-2'
                }
              >
                {describePace(baseline)}
              </p>
              <p className="text-caption text-ink-3">
                Usually about {money.format(baseline.median)} over a month.
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Today, so the view and the query agree on what "this month" means. */
export const analyticsToday = () => toIsoDate(new Date());
