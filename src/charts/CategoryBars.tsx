/* ===========================================================================
 * RANKED BARS
 * ---------------------------------------------------------------------------
 * The unglamorous chart people actually use: biggest first, longest bar at the
 * top, share on the right in tabular figures so the column does not jitter.
 *
 * The median tick is the part worth the trouble. A bar on its own says what
 * was spent; a bar with a notch says whether that is normal, which is the
 * question underneath. It is only drawn where there is enough history to know
 * — an invented baseline would be worse than none, and there is no visual
 * difference between a confident tick and a correct one.
 * ======================================================================== */

import { useState } from 'react';
import clsx from 'clsx';
import type { Minor } from '@/core/money';
import type { Distribution, DistributionLeaf } from '@/core/analytics';

export interface MedianMark {
  /** Category id to its trailing median. */
  median: Minor;
  runningHot: boolean;
}

export interface CategoryBarsProps {
  distribution: Distribution;
  format: (amount: Minor) => string;
  /** Missing entirely when the ledger is too young to have baselines. */
  medians?: Map<string, MedianMark>;
  onSelectCategory?: (categoryId: string) => void;
}

export function CategoryBars({
  distribution,
  format,
  medians,
  onSelectCategory,
}: CategoryBarsProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (distribution.empty) return null;

  // Bars are scaled against the biggest single row, not against the total, so
  // the longest bar always fills the width and the differences stay readable.
  const widest = Math.max(
    ...distribution.groups.map((g) => g.amount),
    ...distribution.ungrouped.map((c) => c.amount),
    1,
  );

  const toggle = (groupId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  return (
    <ul className="flex flex-col gap-1">
      {distribution.groups.map((group) => {
        const open = expanded.has(group.groupId);
        return (
          <li key={group.groupId} className="flex flex-col">
            <Row
              name={group.groupName}
              amount={group.amount}
              shareBp={group.shareBp}
              fraction={group.amount / widest}
              format={format}
              emphasis
              expandable
              expanded={open}
              onClick={() => toggle(group.groupId)}
            />

            {open && (
              <ul className="flex flex-col gap-1 pb-1 pl-4">
                {group.categories.map((category) => (
                  <li key={category.categoryId}>
                    <Row
                      name={category.categoryName}
                      amount={category.amount}
                      shareBp={category.shareBp}
                      fraction={category.amount / widest}
                      format={format}
                      {...(medians?.get(category.categoryId)
                        ? {
                            median: medians.get(category.categoryId)!,
                            medianFraction:
                              medians.get(category.categoryId)!.median / widest,
                          }
                        : {})}
                      {...(onSelectCategory
                        ? { onClick: () => onSelectCategory(category.categoryId) }
                        : {})}
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}

      {distribution.ungrouped.map((category) => (
        <li key={category.categoryId}>
          <Row
            name={category.categoryName}
            amount={category.amount}
            shareBp={category.shareBp}
            fraction={category.amount / widest}
            format={format}
            {...(medians?.get(category.categoryId)
              ? {
                  median: medians.get(category.categoryId)!,
                  medianFraction: medians.get(category.categoryId)!.median / widest,
                }
              : {})}
            {...(onSelectCategory
              ? { onClick: () => onSelectCategory(category.categoryId) }
              : {})}
          />
        </li>
      ))}
    </ul>
  );
}

function Row({
  name,
  amount,
  shareBp,
  fraction,
  format,
  median,
  medianFraction,
  emphasis,
  expandable,
  expanded,
  onClick,
}: {
  name: string;
  amount: Minor;
  shareBp: number;
  fraction: number;
  format: (amount: Minor) => string;
  median?: MedianMark;
  medianFraction?: number;
  emphasis?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  const width = `${Math.max(1.5, Math.min(100, fraction * 100))}%`;
  const percent = Math.round(shareBp / 100);

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          {expandable && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={clsx(
                'shrink-0 text-ink-3 transition-transform duration-200',
                expanded && 'rotate-90',
              )}
            >
              <path
                d="m9 6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span
            className={clsx(
              'truncate',
              emphasis ? 'text-body text-ink' : 'text-caption text-ink-2',
            )}
          >
            {name}
          </span>
        </span>

        <span className="flex shrink-0 items-baseline gap-2">
          <span className={clsx('tnum', emphasis ? 'text-body text-ink' : 'text-caption text-ink-2')}>
            {format(amount)}
          </span>
          <span className="tnum w-8 text-right text-caption text-ink-3">{percent}%</span>
        </span>
      </div>

      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-sunken">
        <div
          className={clsx(
            'h-full rounded-pill',
            median?.runningHot ? 'bg-caution' : emphasis ? 'bg-liquid-dim' : 'bg-line-strong',
          )}
          style={{ width }}
        />

        {/* The notch: where this category usually lands. Absent when the
            ledger has not been running long enough to know. */}
        {medianFraction !== undefined && medianFraction > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0 h-full w-px bg-ink-2"
            style={{ left: `${Math.min(100, medianFraction * 100)}%` }}
          />
        )}
      </div>
    </>
  );

  const shared = 'w-full rounded-md px-2 py-2 text-left';

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expandable ? expanded : undefined}
      className={clsx(shared, 'transition-colors hover:bg-raised active:bg-raised')}
    >
      {body}
    </button>
  ) : (
    <div className={shared}>{body}</div>
  );
}

/** Explains the notch, once, rather than on every bar. */
export function MedianTickKey() {
  return (
    <p className="flex items-center gap-2 text-caption text-ink-3">
      <span className="inline-block h-3 w-px bg-ink-2" aria-hidden="true" />
      Where that category usually lands over the last three months.
    </p>
  );
}

export type { DistributionLeaf };
