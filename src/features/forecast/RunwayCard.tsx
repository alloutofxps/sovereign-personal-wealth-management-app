/* ===========================================================================
 * HOW LONG YOUR MONEY WOULD LAST
 * ---------------------------------------------------------------------------
 * A what-if, and it says so. Nothing switched off here is recorded anywhere;
 * the toggles change a number on this card and nothing else in the app.
 *
 * The duration leads and the monthly cost sits beside it, because "four
 * months" is the answer and "€2,140 a month" is the working. Switching a
 * category off moves both, which is the only reason the working is on screen.
 *
 * The categories are a list of switches rather than chips, because the state
 * that matters is on-or-off per row and a chip row makes people hunt for which
 * ones are dimmed. Each row keeps its amount so the size of the lever is
 * visible before it is pulled.
 * ======================================================================== */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { calculateRunway, describeDuration, describeRunway } from '@/core/forecast';
import type { ForecastData } from '@/app/forecast/useForecast';
import { useMoney } from '@/app/money/useMoney';
import { familyClassFor } from '@/design/category';
import { Card, Explain, Money } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function RunwayCard({ data }: { data: ForecastData }) {
  const money = useMoney();

  /** Categories the person has switched off. Starts with none. */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const asYouAre = data.runwayAsYouAre;

  const scenario = useMemo(
    () =>
      calculateRunway({
        usableCash: data.usableCash,
        fixedMonthly: data.fixedMonthly,
        categories: data.categories,
        excludedIds: [...excluded],
      }),
    [data, excluded],
  );

  /** What it would look like with everything optional switched off. */
  const bareBones = useMemo(
    () =>
      calculateRunway({
        usableCash: data.usableCash,
        fixedMonthly: data.fixedMonthly,
        categories: data.categories,
        excludedIds: data.categories.filter((c) => c.optional).map((c) => c.id),
      }),
    [data],
  );

  const toggle = (id: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const changed = excluded.size > 0;

  const explain = useExplain({
    usableCash: data.usableCash,
    monthlyNeed: scenario.monthlyNeed,
    ...(scenario.months === null ? {} : { runwayMonths: scenario.months }),
  });

  return (
    <Card
      label="How long your money would last"
      action={
        <Explain topic="runway" label="how long your money would last" onOpen={explain.open} />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="figure text-figure text-ink">
              {describeDuration(scenario.days)}
            </span>
            <span className="text-caption text-ink-3">
              {changed ? 'with what you have switched off' : 'spending as you are now'}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-caption text-ink-3">A month costs</span>
            <Money value={scenario.monthlyNeed} size="lead" />
          </div>
        </div>

        <p className="max-w-[46ch] text-caption text-ink-2">
          {describeRunway(asYouAre, bareBones, (amount) => money.format(amount))}
        </p>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="section-title text-ink">What could you go without?</h3>
          <p className="max-w-[44ch] text-caption text-ink-2">
            Nothing here changes your records.
          </p>

          {data.categories.length === 0 ? (
            <p className="pt-1 text-caption text-ink-2">
              Once you have recorded a month or so of spending, your categories will appear here
              to switch on and off.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-faint pt-1">
              {data.categories.map((category) => {
                const off = excluded.has(category.id);
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      onClick={() => toggle(category.id)}
                      aria-pressed={!off}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {/* The switch. Verdigris when on, because the category
                            keeps its own hue on the square beside it and two
                            colours competing in one row reads as decoration. */}
                        <span
                          className={clsx(
                            'flex h-[18px] w-8 shrink-0 items-center rounded-pill px-0.5 transition-colors',
                            off ? 'bg-line-strong' : 'bg-liquid',
                          )}
                          aria-hidden="true"
                        >
                          <span
                            className={clsx(
                              'size-3.5 rounded-full bg-base transition-transform',
                              off ? 'translate-x-0' : 'translate-x-3.5',
                            )}
                          />
                        </span>
                        <span
                          aria-hidden="true"
                          className={clsx(
                            familyClassFor(category.id),
                            'size-2 shrink-0 rounded-pill bg-[var(--tile-ink)] transition-opacity',
                            off && 'opacity-35',
                          )}
                        />
                        <span
                          className={clsx(
                            'truncate text-body transition-colors',
                            off ? 'text-ink-3' : 'text-ink',
                          )}
                        >
                          {category.name}
                        </span>
                      </span>
                      <span className={clsx('shrink-0', off && 'line-through opacity-60')}>
                        <Money
                          value={category.monthly}
                          size="caption"
                          tone={off ? 'muted' : 'neutral'}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {explain.sheet}
    </Card>
  );
}
