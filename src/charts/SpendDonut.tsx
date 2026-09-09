/* ===========================================================================
 * WHERE IT WENT, AS ONE RING
 * ---------------------------------------------------------------------------
 * The reference sheet's donut: arcs in the category families, values on pills
 * outside the ring, and the total in the middle with one comparison under it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VALUES SIT OUTSIDE
 *
 * A donut's arcs are the wrong shape to hold text. A label inside an arc has to
 * fit the arc, so a 4% slice gets nothing and a 40% slice gets a label at a
 * different size to its neighbour — which is how a chart ends up labelling only
 * the segments that happen to be big, and hiding exactly the ones somebody is
 * squinting at.
 *
 * Outside, every label has the same room whatever its arc is worth. The leader
 * line is what pays for it: a short radial stroke from the arc to its pill, so
 * the pairing is stated rather than inferred from proximity.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS ONLY ONE DONUT IN THIS APP
 *
 * This is it. `Invested` uses a stacked bar for the same reason a second donut
 * would be wrong there: two of them make the two screens rhyme without meaning
 * anything by it. See `AssetAllocationBar`.
 *
 * ---------------------------------------------------------------------------
 * SMALL SLICES ARE DRAWN AND NOT LABELLED
 *
 * Every slice gets an arc, because the ring has to add up — dropping the small
 * ones would make the remainder silently wrong. Only slices with enough of the
 * circumference to point at get a pill; the rest are in the rows underneath,
 * which is where somebody looking for a specific category goes anyway.
 * ======================================================================== */

import { useMemo } from 'react';
import type { Minor } from '@/core/money';
import type { Distribution, DistributionLeaf } from '@/core/analytics';
import { familyFor } from '@/design/category';
import { estimateTextWidth, useChartWidth } from './useChartWidth';

const HEIGHT = 260;
/** Thickness of the ring, as a share of its radius. */
const RING = 0.3;
/** How far a pill's leader line reaches past the ring. */
const LEADER = 10;
/** Below this share, an arc is too short to point at. Drawn, not labelled. */
const LABEL_FLOOR_BP = 500;

export interface SpendDonutProps {
  distribution: Distribution;
  format: (amount: Minor) => string;
  /**
   * The middle line under the total — a comparison, never a second total.
   *
   * Truncated to what the hole can hold. A caller cannot know that width, and
   * a phrase that fits one household's category names overflows another's.
   */
  comparison?: string;
}

interface Arc {
  leaf: DistributionLeaf;
  /** Radians, clockwise from twelve o'clock. */
  from: number;
  to: number;
  family: string;
}

/** A point on a circle, measured clockwise from twelve o'clock. */
function at(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

function arcPath(cx: number, cy: number, outer: number, inner: number, from: number, to: number) {
  const [x1, y1] = at(cx, cy, outer, from);
  const [x2, y2] = at(cx, cy, outer, to);
  const [x3, y3] = at(cx, cy, inner, to);
  const [x4, y4] = at(cx, cy, inner, from);
  const large = to - from > Math.PI ? 1 : 0;
  return (
    `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} ` +
    `L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
  );
}

/**
 * Trim a line to what fits across the ring's hole.
 *
 * The hole is a circle, so the widest a line can be at its centre is the
 * diameter — less a little, because a chord touching the inner edge would
 * still collide with the arc it curves into.
 */
function fitToHole(text: string, innerRadius: number): string {
  const room = innerRadius * 2 - 8;
  if (estimateTextWidth(text, 10) <= room) return text;
  const budget = Math.max(4, Math.floor(room / (10 * 0.54)) - 1);
  return `${text.slice(0, budget).trimEnd()}…`;
}

export function SpendDonut({ distribution, format, comparison }: SpendDonutProps) {
  const [chartRef, width] = useChartWidth();

  const geometry = useMemo(() => {
    const ranked = distribution.ranked;
    if (ranked.length === 0 || distribution.total <= 0) return null;

    const cx = width / 2;
    const cy = HEIGHT / 2;
    /*
     * The ring has to leave room for a pill on each side. A pill is about 54
     * units wide, so the radius is what is left of the half-width after one of
     * them plus its leader — floored so a narrow phone still draws a ring
     * rather than a dot.
     */
    const outer = Math.max(52, Math.min(cy - 14, cx - 54 - LEADER));
    const inner = outer * (1 - RING);

    let cursor = 0;
    const arcs: Arc[] = ranked.map((leaf) => {
      const sweep = (leaf.shareBp / 10_000) * Math.PI * 2;
      const arc: Arc = {
        leaf,
        from: cursor,
        to: cursor + sweep,
        family: familyFor(leaf.categoryId),
      };
      cursor += sweep;
      return arc;
    });

    return { cx, cy, outer, inner, arcs };
  }, [distribution, width]);

  if (!geometry) return null;
  const { cx, cy, outer, inner, arcs } = geometry;

  return (
    <figure ref={chartRef} className="m-0">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          `Where it went: ${format(distribution.total)} across ` +
          `${arcs.length} ${arcs.length === 1 ? 'category' : 'categories'}. ` +
          arcs
            .slice(0, 4)
            .map((a) => `${a.leaf.categoryName} ${Math.round(a.leaf.shareBp / 100)}%`)
            .join(', ')
        }
      >
        {arcs.map((arc) => (
          <path
            key={arc.leaf.categoryId}
            d={arcPath(cx, cy, outer, inner, arc.from, arc.to)}
            fill={`var(--color-${arc.family})`}
            /*
             * A hairline in the page's own ground, so touching arcs separate
             * without a colour being introduced that means nothing. Two
             * families can legitimately sit side by side.
             */
            stroke="var(--color-base)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* The total, and one comparison under it. Never a second total: the
            middle of a ring is the one place a figure is unmissable, and two
            things there means neither is. */}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          className="figure"
          fontSize="22"
          fill="var(--color-ink)"
        >
          {format(distribution.total)}
        </text>
        {comparison && (
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--color-ink-3)">
            {fitToHole(comparison, inner)}
          </text>
        )}

        {arcs
          .filter((arc) => arc.leaf.shareBp >= LABEL_FLOOR_BP)
          .map((arc) => {
            const middle = (arc.from + arc.to) / 2;
            const [lx1, ly1] = at(cx, cy, outer, middle);
            const [lx2, ly2] = at(cx, cy, outer + LEADER, middle);
            // Right of twelve o'clock the pill sits to the right of its leader.
            const rightHalf = Math.sin(middle) >= 0;
            const share = Math.round(arc.leaf.shareBp / 100);

            return (
              <g key={arc.leaf.categoryId}>
                <line
                  x1={lx1}
                  y1={ly1}
                  x2={lx2}
                  y2={ly2}
                  vectorEffect="non-scaling-stroke"
                  stroke={`var(--color-${arc.family})`}
                  strokeWidth="1"
                />
                {/*
                  * The pill: the arc's own hue at wash strength, with the arc's
                  * ink on it. That pairing is the same one every tile in the
                  * app uses, so the label reads as belonging to its slice
                  * rather than as a caption that happens to be nearby.
                  */}
                <rect
                  x={rightHalf ? lx2 + 3 : lx2 - 3 - 46}
                  y={ly2 - 8}
                  width={46}
                  height={16}
                  rx={8}
                  fill={`var(--color-${arc.family}-wash)`}
                />
                <text
                  x={rightHalf ? lx2 + 26 : lx2 - 26}
                  y={ly2 + 4}
                  textAnchor="middle"
                  className="tnum"
                  fontSize="10"
                  fontWeight="600"
                  fill={`var(--color-${arc.family})`}
                >
                  {share}%
                </text>
              </g>
            );
          })}
      </svg>
    </figure>
  );
}
