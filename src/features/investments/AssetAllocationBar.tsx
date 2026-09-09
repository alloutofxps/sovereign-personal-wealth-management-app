/* ===========================================================================
 * HOW IT IS SPREAD
 * ---------------------------------------------------------------------------
 * One bar. The point is not the colours, it is that somebody who has never
 * looked at their allocation can see in one glance that all of it is in one
 * thing — which is the single most common and least noticed position a private
 * investor holds.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A BAR AND NOT A DONUT
 *
 * Where it went already owns the donut. A second one here would make the two
 * screens rhyme without meaning anything by it, and two donuts in an app is a
 * kit rather than a system. A bar also does the one thing a donut is bad at:
 * "nearly all of it is in one thing" is a single long segment, read at a
 * glance, with no arc to mentally unroll.
 *
 * It is 44px tall, which is deliberate. At the 10px this used to be it read as
 * a progress meter under a heading; at 44 it is the object on the screen, and
 * the shares can be printed inside it rather than hunted for in a legend.
 *
 * ---------------------------------------------------------------------------
 * THE COLOURS ARE THE APP'S, NOT THIS FILE'S
 *
 * Asset classes are pinned to the six families in `src/design/category.ts`, so
 * the blue that means "invested" on the accounts screen is the blue that means
 * equity here. `other` is the exception and takes a neutral: it means "we do
 * not know what this is", and a family hue on that would be inventing an entry
 * in an index the whole app asks people to learn.
 * ======================================================================== */

import clsx from 'clsx';
import { formatShare, type Allocation, type AllocationSlice } from '@/core/investments';
import { useMoney } from '@/app/money/useMoney';
import { familyClassFor } from '@/design/category';
import { Card } from '@/design/ui';

/** The unclassified slice, which is not a category and does not get a hue. */
function isUnclassified(slice: AllocationSlice): boolean {
  return slice.assetClass === 'other';
}

function toneClass(slice: AllocationSlice): string {
  return isUnclassified(slice) ? 'bg-ink-4' : `${familyClassFor(slice.assetClass)} bg-[var(--tile-ink)]`;
}

export function AssetAllocationBar({
  allocation,
  description,
}: {
  allocation: Allocation;
  description: string;
}) {
  const money = useMoney();

  if (allocation.slices.length === 0) {
    return (
      <Card label="How it is spread">
        <p className="py-2 text-caption text-ink-2">{description}</p>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title text-ink">How it is spread</h2>

      {/*
        * The bar. Segments are sized in basis points, which add to exactly
        * 10,000, so it always fills its track completely.
        *
        * The 3px gaps are load-bearing rather than decorative: two adjacent
        * slices can legitimately land on the same family — a REIT and a
        * money-market fund are both the verdigris that cash carries
        * everywhere else — and without the gap they would read as one.
        */}
      <div
        className="flex h-11 w-full gap-[3px] overflow-hidden rounded-card"
        role="img"
        aria-label={allocation.slices
          .map((s) => `${s.name} ${formatShare(s.shareBp)}`)
          .join(', ')}
      >
        {allocation.slices.map((slice) => (
          <div
            key={slice.assetClass}
            style={{ flexGrow: slice.shareBp, flexBasis: 0 }}
            className={clsx(
              'flex h-full min-w-[3px] items-center justify-center overflow-hidden',
              'first:rounded-l-card last:rounded-r-card',
              toneClass(slice),
            )}
          >
            {/*
              * The share, printed in the segment it describes.
              *
              * Only where there is room. A 3% sliver with "3%" spilling out of
              * it is worse than a 3% sliver, and the legend below names every
              * slice anyway — so this is the shortcut for the big ones, not
              * the only place the figure appears.
              */}
            {allocation.slices.length > 1 && slice.shareBp >= 1_200 && !isUnclassified(slice) && (
              <span className="tnum px-1 text-micro font-medium text-[var(--tile-wash)]">
                {formatShare(slice.shareBp)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Every slice, named, with what it is worth and how many things are in
          it. The bar is the glance; this is the answer to the next question. */}
      <ul className="flex flex-col gap-2 pt-1">
        {allocation.slices.map((slice) => (
          <li key={slice.assetClass} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                aria-hidden="true"
                className={clsx(
                  'size-2 shrink-0 translate-y-px rounded-pill',
                  toneClass(slice),
                )}
              />
              <span className="truncate text-caption text-ink">{slice.name}</span>
              <span className="shrink-0 text-micro text-ink-3">
                {slice.holdings === 1 ? '1 holding' : `${slice.holdings} holdings`}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="tnum text-caption text-ink-2">
                {money.format(slice.value, { decimals: 'hide' })}
              </span>
              <span className="tnum w-[3.5rem] text-right text-caption font-medium text-ink">
                {formatShare(slice.shareBp)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-caption text-ink-2">{description}</p>
    </section>
  );
}
