/* ===========================================================================
 * HOW IT IS SPREAD
 * ---------------------------------------------------------------------------
 * One bar and a legend. The point is not the colours, it is that somebody who
 * has never looked at their allocation can see in one glance that all of it is
 * in one thing — which is the single most common and least noticed position a
 * private investor holds.
 *
 * Colours come from the existing palette rather than a new one. Clay is used
 * for crypto because it is this design's tone for "unusual", never for "bad";
 * there is no crimson here and nothing on this screen is a warning.
 * ======================================================================== */

import { formatShare, type Allocation, type AssetClass } from '@/core/investments';
import { useMoney } from '@/app/money/useMoney';
import { Card } from '@/design/ui';

const TONE: Record<AssetClass, string> = {
  equity: 'var(--color-liquid)',
  fixed_income: 'var(--color-liquid-dim)',
  real_estate: 'var(--color-caution)',
  commodity: 'var(--color-caution-dim)',
  crypto: 'var(--color-deficit)',
  cash_equivalent: 'var(--color-ink-4)',
  other: 'var(--color-ink-3)',
};

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
    <Card label="How it is spread">
      <div className="flex flex-col gap-4">
        {/* The bar. Segments are sized in basis points, which add to exactly
            10,000, so the bar always fills its track completely. */}
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-pill bg-sunken"
          role="img"
          aria-label={allocation.slices
            .map((s) => `${s.name} ${formatShare(s.shareBp)}`)
            .join(', ')}
        >
          {allocation.slices.map((slice) => (
            <div
              key={slice.assetClass}
              style={{
                width: `${slice.shareBp / 100}%`,
                backgroundColor: TONE[slice.assetClass],
              }}
              className="h-full first:rounded-l-pill last:rounded-r-pill"
            />
          ))}
        </div>

        <ul className="flex flex-col gap-2">
          {allocation.slices.map((slice) => (
            <li key={slice.assetClass} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 translate-y-px rounded-pill"
                  style={{ backgroundColor: TONE[slice.assetClass] }}
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
                <span className="tnum w-[4.5rem] text-right text-caption font-medium text-ink">
                  {formatShare(slice.shareBp)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-caption text-ink-2">{description}</p>
      </div>
    </Card>
  );
}
