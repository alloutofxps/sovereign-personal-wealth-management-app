/* ===========================================================================
 * THE NET WORTH TIMELINE
 * ---------------------------------------------------------------------------
 * The line, and the round numbers it has already crossed. Both matter, and the
 * order matters too: the line is drawn first and the milestones sit behind it,
 * because the milestones are context for the line and not the other way round.
 *
 * Two things this chart refuses to do. It does not project forwards — a dotted
 * continuation into next year is a guess wearing the same ink as the facts, and
 * on a chart about somebody's whole financial life that is not a small lie. And
 * it does not draw milestones that have not been reached, because a horizon
 * line above where somebody actually is turns a record of what they built into
 * a measure of how far short they fall.
 *
 * The baseline is zero whenever zero is on the scale. Net worth genuinely can
 * be negative — a mortgage in its early years, student debt — and a chart that
 * quietly rebases so the line always looks like it is climbing would be hiding
 * the single most important thing on it.
 * ======================================================================== */

import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';
import type { Minor } from '@/core/money';
import type { Milestone, NetWorthPoint } from '@/core/analytics';

const WIDTH = 320;
const HEIGHT = 150;
const PADDING = { top: 12, right: 6, bottom: 22, left: 6 };

export interface NetWorthTimelineProps {
  points: readonly NetWorthPoint[];
  /** Only the ones already passed are drawn. */
  milestones: readonly Milestone[];
  format: (amount: Minor) => string;
  /** 'YYYY-MM' → 'March 2026', from the household's locale. */
  formatMonth: (month: string) => string;
}

export function NetWorthTimeline({
  points,
  milestones,
  format,
  formatMonth,
}: NetWorthTimelineProps) {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const innerWidth = WIDTH - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const values = points.map((p) => p.netWorth);
    const highest = Math.max(...values);
    const lowest = Math.min(...values);

    // Zero stays on the scale whenever the line is anywhere near it, so being
    // in the red reads as being in the red.
    const top = Math.max(highest, 0);
    const bottom = Math.min(lowest, 0);
    const span = top - bottom || 1;

    const x = scaleLinear()
      .domain([0, points.length - 1])
      .range([PADDING.left, PADDING.left + innerWidth]);
    const y = scaleLinear()
      .domain([bottom - span * 0.08, top + span * 0.08])
      .range([PADDING.top + innerHeight, PADDING.top]);

    const path = line<NetWorthPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.netWorth))
      .curve(curveMonotoneX);

    return {
      x,
      y,
      top,
      bottom,
      linePath: path([...points]) ?? '',
      zeroLine: y(0),
      showZero: bottom < 0,
    };
  }, [points]);

  const last = points[points.length - 1];

  if (!geometry || !last) {
    return (
      <p className="py-2 text-caption text-ink-2">
        There is only one month recorded so far. Once there are a few, this will show how what
        you are worth has moved.
      </p>
    );
  }

  const first = points[0]!;
  const rising = last.netWorth >= first.netWorth;
  const stroke = rising ? 'var(--color-liquid)' : 'var(--color-deficit)';

  const passed = milestones.filter(
    (m) => m.reachedMonth !== null && m.amount <= geometry.top && m.amount >= geometry.bottom,
  );

  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          `What you have been worth from ${formatMonth(first.month)} to ` +
          `${formatMonth(last.month)}: ${format(first.netWorth)} then, ` +
          `${format(last.netWorth)} now.`
        }
      >
        {/* Zero, drawn only when the line has been below it. */}
        {geometry.showZero && (
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={geometry.zeroLine}
            y2={geometry.zeroLine}
            stroke="var(--color-line-strong)"
            strokeWidth="1"
          />
        )}

        {passed.map((milestone) => (
          <g key={milestone.major}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={geometry.y(milestone.amount)}
              y2={geometry.y(milestone.amount)}
              stroke="var(--color-line)"
              strokeWidth="1"
              strokeDasharray="2 5"
            />
            <text
              x={WIDTH - PADDING.right}
              y={geometry.y(milestone.amount) - 3}
              textAnchor="end"
              fill="var(--color-ink-3)"
              fontSize="8"
            >
              {format(milestone.amount)}
            </text>
          </g>
        ))}

        <path
          d={geometry.linePath}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Where things stand now. */}
        <circle
          cx={geometry.x(points.length - 1)}
          cy={geometry.y(last.netWorth)}
          r="3"
          fill={stroke}
        />

        <text x={PADDING.left} y={HEIGHT - 6} fill="var(--color-ink-3)" fontSize="9">
          {formatMonth(first.month)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          fill="var(--color-ink-3)"
          fontSize="9"
        >
          now
        </text>
      </svg>

      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-caption text-ink-2">
          Worth <span className="tnum text-ink">{format(last.netWorth)}</span> now
        </span>
        <span className="tnum text-caption text-ink-3">
          {format(first.netWorth)} in {formatMonth(first.month)}
        </span>
      </figcaption>
    </figure>
  );
}
