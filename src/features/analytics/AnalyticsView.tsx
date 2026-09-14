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
import { describePace } from '@/core/analytics';
import {
  HORIZON_LABELS,
  useAnalytics,
  useMedianMarks,
  type Horizon,
} from '@/app/analytics/useAnalytics';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { CategoryBars, MedianTickKey } from '@/charts/CategoryBars';
import { SpendDonut } from '@/charts/SpendDonut';
import { SankeyFlow, SankeyLegend } from '@/charts/SankeyFlow';
import {
  BottomSheet,
  Button,
  Card,
  Field,
  Money,
  PillRow,
  StatCell,
  StatStrip,
} from '@/design/ui';

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
  /*
   * The one comparison in the middle of the ring.
   *
   * The biggest group and its share -- a fact about the total that the total
   * cannot state on its own. Not a second total: two figures in the centre of
   * a donut means neither is read.
   */
  const biggest = data?.distribution.groups[0]
    ? `${data.distribution.groups[0].groupName} ${Math.round(data.distribution.groups[0].shareBp / 100)}%`
    : null;

  const medians = useMedianMarks(data);

  return (
    <div className="flex flex-col gap-5">
      {/*
        * A headline, not a heading with a caption under it.
        *
        * The sentence that used to sit here — "what came in, what went out,
        * and how that compares with your usual" — described the three cards
        * below it, which are perfectly capable of describing themselves. What
        * is left is the screen's name, set in the display face.
        */}
      <h1 className="headline text-ink">Where it went</h1>

      {/*
        * Pills rather than the tab strip.
        *
        * A window of time is one choice, not a set of panels: nothing here is
        * a tabpanel and announcing four tabs to a screen reader would be
        * describing a structure that is not on the screen. `PillRow` is the
        * lighter thing the reference uses for exactly this.
        */}
      <PillRow
        label="Which period to look at"
        value={horizon}
        onChange={setHorizon}
        options={HORIZONS.map((value) => ({ value, label: HORIZON_LABELS[value] }))}
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
          {/* --- what went out -------------------------------------------
           *
           * The only field in the app with no family, and the reason is the
           * Sankey directly beneath it: every ribbon there is already one of
           * the six hues, so a seventh above them would be a colour statement
           * about nothing. See `family="none"` in `Surfaces.tsx`. */}
          {!data.flow.empty && (
            <Field family="none">
              <div className="min-w-0">
                <span className="text-caption opacity-75">
                  Went out · {data.period.label.toLowerCase()}
                </span>
                <div className="pt-1">
                  <Money value={data.flow.totalOut} size="anchor" tone="inherit" />
                </div>
              </div>

              <StatStrip className="pt-5">
                <StatCell label="Money in">
                  <Money value={data.flow.totalIn} size="lead" tone="neutral" decimals="hide" />
                </StatCell>
                <StatCell label="Still in your accounts">
                  {data.flow.retained > 0 ? (
                    <Money value={data.flow.retained} size="lead" tone="neutral" decimals="hide" />
                  ) : (
                    <span className="opacity-60">Nothing</span>
                  )}
                </StatCell>
              </StatStrip>
            </Field>
          )}

          {/* --- the flow ------------------------------------------------- */}
          <Card label={`Where your money went · ${data.period.label.toLowerCase()}`}>
            {data.flow.empty ? (
              <p className="py-6 text-center text-caption text-ink-2">
                Nothing was recorded in this period. Try a wider window above.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
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

          {/* --- the shape of it ------------------------------------------ */}
          {!data.distribution.empty && (
            <section className="flex flex-col gap-2">
              <SpendDonut
                distribution={data.distribution}
                format={(amount) => money.format(amount, { compact: true })}
                {...(biggest ? { comparison: biggest } : {})}
              />
            </section>
          )}

          {/* --- the ranking ---------------------------------------------- */}
          <Card label="Spending by group and category">
            {data.distribution.empty ? (
              <p className="py-6 text-center text-caption text-ink-2">
                No spending recorded in this period.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
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

