/* What your balance is going to do, and how long your money would last. */

import { useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import { HORIZONS, describeProjection, type Horizon } from '@/core/forecast';
import { useForecast } from '@/app/forecast/useForecast';
import { describeDate, shortDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { ForecastBand } from '@/charts/ForecastBand';
import { Button, Card, Money } from '@/design/ui';
import { RunwayCard } from './RunwayCard';

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
        <h1 className="text-lead font-medium text-ink">What is coming</h1>
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

      <Card
        label="Projected balance"
        action={
          <div className="flex gap-1" role="group" aria-label="How far ahead to look">
            {HORIZONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setHorizon(option)}
                aria-pressed={horizon === option}
                className={clsx(
                  'rounded-pill px-2.5 py-1 text-micro font-medium transition-colors',
                  horizon === option
                    ? 'bg-liquid-wash text-liquid'
                    : 'bg-raised text-ink-3 hover:text-ink-2',
                )}
              >
                {option} days
              </button>
            ))}
          </div>
        }
      >
        {!windowed ? (
          <div className="h-36 animate-pulse rounded-sm bg-raised" />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-caption text-ink-3">
                  In {horizon} days
                </span>
                <Money
                  value={windowed.endBalance}
                  size="figure"
                  tone={windowed.endBalance < 0 ? 'deficit' : 'neutral'}
                />
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-caption text-ink-3">
                  Tightest point
                </span>
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
          </div>
        )}
      </Card>

      {data && <RunwayCard data={data} />}

      <Card label="Working things out">
        <div className="flex flex-col gap-3">
          <p className="text-caption text-ink-2">
            Two questions worth an answer before you need one.
          </p>
          <div className="flex flex-wrap gap-2">
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
        </div>
      </Card>

      <p className="max-w-[46ch] text-caption text-ink-3">
        Everything on this page is worked out fresh each time from what you have recorded.
        Nothing here is saved, and none of it is a promise. It is arithmetic on what is
        already known.
      </p>
    </div>
  );
}
