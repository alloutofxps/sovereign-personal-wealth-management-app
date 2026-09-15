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
import { minor } from '@/core/money';
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
  Explain,
  Field,
  Money,
  PillRow,
  StatCell,
  StatStrip,
} from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

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

  /*
   * The four figures `where-it-went`'s worked example reads.
   *
   * `income`, `spent` and `saved` rather than `totalIn` and `totalOut`: the
   * latter two are conservation figures the graph needs so no ribbon runs
   * backwards, and handing them to an explanation would have it tell somebody
   * that money they already had arrived this month. See the comments on
   * `SankeyGraph`.
   */
  const explain = useExplain(
    data
      ? {
          periodIncome: data.flow.income,
          periodSpent: data.flow.spent,
          periodSaved: data.flow.saved,
          periodRetained: data.flow.retained,
        }
      : {},
  );

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
                <div className="flex items-center gap-1">
                  {/* Not "went out". The hero is `spent + saved`, and money
                      assigned to a pot has not gone anywhere — `assign` is
                      budget-book only and moves no cash. It is spoken for,
                      which is the honest word for both halves at once. */}
                  <span className="text-caption opacity-75">
                    Spent or set aside · {data.period.label.toLowerCase()}
                  </span>
                  <Explain
                    topic="where-it-went"
                    label="where your money went"
                    onOpen={explain.open}
                    className="opacity-70"
                  />
                </div>
                <div className="pt-1">
                  <Money value={data.flow.totalOut} size="anchor" tone="inherit" />
                </div>
              </div>

              <StatStrip className="pt-5">
                {/* `income`, never `totalIn`: the latter adds the shortfall
                    source, so on a deficit month this cell used to claim
                    money the person already had as money that arrived. */}
                <StatCell label="Came in">
                  <Money value={data.flow.income} size="lead" tone="neutral" decimals="hide" />
                </StatCell>

                {data.flow.saved > 0 && (
                  <StatCell label="Of that, set aside">
                    <Money value={data.flow.saved} size="lead" tone="neutral" decimals="hide" />
                  </StatCell>
                )}

                {/*
                 * Three branches, because `retained` is signed and the label
                 * has to change with it. It printed "Nothing" for anything at
                 * or below zero, so every month that did more with its money
                 * than arrived in it read as break-even.
                 */}
                {data.flow.retained > 0 ? (
                  <StatCell label="Not spoken for">
                    <Money value={data.flow.retained} size="lead" tone="neutral" decimals="hide" />
                  </StatCell>
                ) : data.flow.retained < 0 ? (
                  <StatCell label="More than came in">
                    <Money
                      value={minor(-data.flow.retained)}
                      size="lead"
                      tone="neutral"
                      decimals="hide"
                    />
                  </StatCell>
                ) : (
                  <StatCell label="Not spoken for">
                    <span className="opacity-60">Nothing</span>
                  </StatCell>
                )}
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

                {/* `income`, not `totalIn` less a reconstructed shortfall. The
                    old version computed the same figure by hand from two
                    others: correct, and it needed a reader to know that
                    `totalIn` already contains the shortfall to check it. */}
                {data.flow.drewOnReserves && (
                  <p className="text-caption text-caution">
                    You spent or set aside {money.format(data.flow.totalOut)} against{' '}
                    {money.format(data.flow.income)} coming in, so{' '}
                    {money.format(minor(-data.flow.retained))} of it was money you already had.
                    There is nothing wrong with that once. It is only worth watching if it becomes
                    the pattern.
                  </p>
                )}

                {data.flow.retained > 0 && (
                  /* Not "still sitting in your accounts". This figure has had
                     what you set aside taken off it, and that money has not
                     moved — so the remainder is what has no job, which is a
                     smaller claim than what is in the account. */
                  <p className="text-caption text-ink-2">
                    {money.format(data.flow.retained)} of what came in has no job yet.
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

      {explain.sheet}
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

