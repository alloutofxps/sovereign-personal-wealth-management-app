/* How long your money would last, and how much further it would stretch if
 * everything optional came off. */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { calculateRunway, describeDuration, describeRunway } from '@/core/forecast';
import type { ForecastData } from '@/app/forecast/useForecast';
import { useMoney } from '@/app/money/useMoney';
import { Card, Money } from '@/design/ui';

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

  return (
    <Card label="How long your money would last">
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-figure font-medium text-ink">
              {describeDuration(scenario.days)}
            </span>
            <span className="text-caption text-ink-3">
              {changed ? 'with what you have switched off' : 'spending as you are now'}
            </span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-micro uppercase tracking-[0.1em] text-ink-3">A month costs</span>
            <Money value={scenario.monthlyNeed} size="lead" />
          </div>
        </div>

        <p className="max-w-[46ch] text-caption text-ink-2">
          {describeRunway(asYouAre, bareBones, (amount) => money.format(amount))}
        </p>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
            What could you go without?
          </span>
          <p className="max-w-[44ch] text-caption text-ink-3">
            Switch things off to see how much further the same money would go. Nothing here
            changes your records. It is only a what-if.
          </p>

          {data.categories.length === 0 ? (
            <p className="pt-1 text-caption text-ink-2">
              Once you have recorded a month or so of spending, your categories will appear here
              to switch on and off.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 pt-1">
              {data.categories.map((category) => {
                const off = excluded.has(category.id);
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      onClick={() => toggle(category.id)}
                      aria-pressed={!off}
                      className={clsx(
                        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                        off
                          ? 'border-line bg-sunken text-ink-3'
                          : 'border-line-strong bg-raised text-ink',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={clsx(
                            'flex h-4 w-7 shrink-0 items-center rounded-pill px-0.5 transition-colors',
                            off ? 'bg-line-strong' : 'bg-liquid',
                          )}
                          aria-hidden="true"
                        >
                          <span
                            className={clsx(
                              'size-3 rounded-full bg-base transition-transform',
                              off ? 'translate-x-0' : 'translate-x-3',
                            )}
                          />
                        </span>
                        <span className="truncate text-body">{category.name}</span>
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
    </Card>
  );
}
