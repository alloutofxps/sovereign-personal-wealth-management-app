/* ===========================================================================
 * WHAT IS COMING
 * ---------------------------------------------------------------------------
 * The chart is the screen. It is not inside a card, because a card says "here
 * is a component among components" and this is the thing the screen exists
 * for — the same reason the net-worth line and the donut sit on the page
 * rather than in a box.
 *
 * There is no field and no hero figure here on purpose. A forecast has two
 * numbers that matter and neither is more important than the other: where the
 * balance lands, and how low it goes on the way. Promoting one of them to a
 * 48pt anchor would be picking a winner the arithmetic does not pick.
 *
 * ---------------------------------------------------------------------------
 * THIS SCREEN IS ALLOWED TO LOOK FORWARD
 *
 * The net-worth chart refuses to project and that refusal is correct there: a
 * net-worth line drawn into the future is a promise about markets. This is a
 * different claim — bills that are already scheduled, pay that is already
 * known — and stating it is the entire point of the screen.
 * ======================================================================== */

import { useState } from 'react';
import { minor } from '@/core/money';
import { HORIZONS, describeProjection, type Horizon } from '@/core/forecast';
import { useForecast } from '@/app/forecast/useForecast';
import { describeDate, shortDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { ForecastBand } from '@/charts/ForecastBand';
import { Button, Card, Money, PillRow } from '@/design/ui';
import { RunwayCard } from './RunwayCard';

const HORIZON_PILLS = HORIZONS.map((days) => ({
  value: String(days),
  label: `${days} days`,
}));

export function ForecastView() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const forecast = useForecast();
  const [horizon, setHorizon] = useState<Horizon>(30);

  const data = forecast.data;
  const points = data ? data.projection.points.slice(0, horizon + 1) : [];
  const windowed = data
    ? {
        ...data.projection,
        points,
        lowest: points.reduce((low, p) => (p.balance < low.balance ? p : low), points[0]!),
        firstBelowBuffer: points.find((p) => p.belowBuffer) ?? null,
        firstBelowZero: points.find((p) => p.belowZero) ?? null,
        endBalance: points.at(-1)?.balance ?? minor(0),
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="headline text-ink">What is coming</h1>
        <p className="text-caption text-ink-2">
          Where your balance is heading, based on the bills and pay you have told Sovereign about.
        </p>
      </header>

      {data?.needsSchedule && (
        <Card accent="caution">
          <p className="text-body text-ink">Nothing to look ahead at yet</p>
          <p className="pt-1 max-w-[44ch] text-caption text-ink-2">
            This works from the regular payments you have added. Tell Sovereign about your rent,
            your phone, and when you are paid, and the line below will mean something.
          </p>
          <div className="pt-3">
            <Button variant="secondary" size="sm" onClick={() => navigate('home')}>
              Add a regular payment
            </Button>
          </div>
        </Card>
      )}

      <section className="flex flex-col gap-4">
        <PillRow
          options={HORIZON_PILLS}
          value={String(horizon)}
          onChange={(value) => setHorizon(Number(value) as Horizon)}
          label="How far ahead to look"
        />

        {!windowed ? (
          <div className="h-36 animate-pulse rounded-card bg-raised" />
        ) : (
          <>
            {/* The two figures the chart is about, above the chart rather than
                captioned under it. Both are read before the shape is. */}
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-caption text-ink-3">In {horizon} days</span>
                <Money
                  value={windowed.endBalance}
                  size="figure"
                  tone={windowed.endBalance < 0 ? 'deficit' : 'neutral'}
                />
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-caption text-ink-3">Tightest point</span>
                <Money
                  value={windowed.lowest.balance}
                  size="lead"
                  tone={windowed.lowest.belowBuffer ? 'caution' : 'neutral'}
                />
              </div>
            </div>

            <ForecastBand
              points={points}
              buffer={data!.buffer}
              format={(amount) => money.format(amount, { decimals: 'adaptive' })}
              formatDate={(iso) => describeDate(iso, locale)}
              formatAxisDate={(iso) => shortDate(iso, locale)}
            />

            <p className="max-w-[46ch] text-caption text-ink-2">
              {describeProjection(
                windowed,
                data!.today,
                (amount) => money.format(amount),
                (iso) => describeDate(iso, locale),
              )}
            </p>
          </>
        )}
      </section>

      {data && <RunwayCard data={data} />}

      {/* Three screens that answer the next question. Not a card: there is no
          content here to hold, only three ways out. */}
      <section className="flex flex-col gap-2.5">
        <h2 className="section-title text-ink">Working things out</h2>
        <p className="text-caption text-ink-2">
          Three questions worth an answer before you need one.
        </p>
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button variant="secondary" size="sm" onClick={() => navigate('calendar')}>
            See it on a calendar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('debt')}>
            Paying off what you owe
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('independence')}>
            When you could stop
          </Button>
        </div>
      </section>

      <p className="max-w-[46ch] text-caption text-ink-3">
        Everything on this page is worked out fresh each time from what you have recorded.
        Nothing here is saved, and none of it is a promise. It is arithmetic on what is
        already known.
      </p>
    </div>
  );
}
