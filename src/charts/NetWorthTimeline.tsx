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

import { useCallback, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';
import type { Minor } from '@/core/money';
import { estimateTextWidth, useChartWidth } from './useChartWidth';
import type { Milestone, NetWorthPoint } from '@/core/analytics';

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

/* ===========================================================================
 * WHY A MILESTONE LABEL SOMETIMES STEPS LEFT
 * ---------------------------------------------------------------------------
 * MEASURED, in the browser, against the seeded household. The note that used to
 * sit in this file said the collision was horizontal -- Space Grotesk being
 * wider than the old face, against `textAnchor="end"`. That is wrong, and it
 * was wrong in a way worth recording, because it would have sent the fix in
 * the wrong direction.
 *
 * Every label is anchored at the SAME x. Two labels anchored at the same x
 * cannot collide with each other because of their widths. Only their y matters.
 * What was actually on screen:
 *
 *   EUR10,000.00    ink box y 106.7 - 114.7
 *   EUR25,000.00    ink box y 100.3 - 108.3
 *                   overlapping by 1.58px, baselines 6.42px apart
 *
 * A label needs about 8px of vertical room at `fontSize="8"`. The scale put
 * these two 6.42px apart, so they overlap by the difference. Shortening the
 * text changes neither number.
 *
 * The data path was checked too and is not involved: it occupies y 20-41 while
 * every label sits at y 68-115.
 *
 * ---------------------------------------------------------------------------
 * SO: THE ONE THAT WOULD COLLIDE STEPS LEFT, BY ITS NEIGHBOUR'S WIDTH.
 *
 * Not "drop one", because a milestone that has been reached is a fact and
 * hiding it to tidy the chart is the same move as hiding an overspent envelope.
 * Not "move them apart vertically", because their y IS the value they mark --
 * a milestone label that has drifted off its own line is a lie about where the
 * line is.
 *
 * Stepping left is the one axis with room in it. The label keeps its y, so it
 * still points at its own value, and the two sit side by side.
 * ======================================================================== */

/** Vertical room one label needs at `fontSize="8"`, ink box to ink box. */
const LABEL_HEIGHT = 8;
/** Air between two labels that end up side by side. */
const LABEL_GAP = 4;

/* ===========================================================================
 * THE DASHED LINE IS A COMPARISON, NEVER A FORECAST
 * ---------------------------------------------------------------------------
 * Steady progress at this window's own average: a straight line from the first
 * month to the last. Where the solid line runs above it the money arrived
 * earlier than an even run would have given, and below, later.
 *
 * The two ends meet by construction. That is deliberate and is the whole
 * mechanic -- it compares the SHAPE of the months rather than the destination,
 * which is a question the solid line alone cannot answer: "was this steady, or
 * was it one good month and a flat one?"
 *
 * It stops at the last real month. Nothing here extends past a measured point,
 * which is the refusal in CLAUDE.md and it stays.
 *
 * The reference sheet calls this "last year's savings rate". That is not
 * available to a household a few months old, and taking a rate from outside the
 * window would be a projection wearing a comparison's clothes.
 * ======================================================================== */

export function NetWorthTimeline({
  points,
  milestones,
  format,
  formatMonth,
}: NetWorthTimelineProps) {
  const [chartRef, width] = useChartWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const innerWidth = width - PADDING.left - PADDING.right;
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
  }, [points, width]);

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

  // Formatted once, so the width estimate and the drawn text cannot disagree.
  const labels = passed.map((m) => format(m.amount));

  /*
   * Where each label's right edge goes.
   *
   * A running cursor, because a one-step lookback is not enough: three
   * milestones close together on the scale are each crowded by the one before,
   * and stepping each left by its neighbour's width puts all three in the same
   * second column. That was measured on the seeded household -- two
   * overlapping pairs where there had been one -- which is why this remembers
   * where the previous label actually ended up rather than assuming it sat at
   * the right edge.
   *
   * A long enough run marches off the left of the plot. When the next column
   * would cross the padding, the cursor returns to the right edge: by then the
   * labels are far enough down the chart that the one it lands beside is well
   * clear of it vertically, and a label inside the plot beats a label outside
   * it. Six milestones on a 308-unit plot use three columns, so this is a
   * guard rather than a path anything normally takes.
   */
  const labelRightEdges: number[] = [];
  {
    const rightEdge = width - PADDING.right;
    let cursor = rightEdge;
    let previousY: number | null = null;

    passed.forEach((milestone, index) => {
      const y = geometry.y(milestone.amount);
      const crowded = previousY !== null && Math.abs(y - previousY) < LABEL_HEIGHT;
      const labelWidth = estimateTextWidth(labels[index]!, 8);

      if (!crowded) {
        cursor = rightEdge;
      } else {
        const next = cursor - labelWidth - LABEL_GAP;
        cursor = next - labelWidth < PADDING.left ? rightEdge : next;
      }

      labelRightEdges.push(cursor);
      previousY = y;
    });
  }

  const activeIndex = scrubIndex ?? points.length - 1;
  const active = points[activeIndex] ?? last;

  /*
   * Map a pointer position to the nearest month.
   *
   * The same arithmetic `CumulativeSpend` uses. Two charts that scrub
   * differently is a kit, and the viewBox conversion is the part that is easy
   * to get subtly wrong twice.
   */
  const handleScrub = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || points.length === 0) return;
      const bounds = svg.getBoundingClientRect();
      if (bounds.width === 0) return;
      const localX = ((event.clientX - bounds.left) / bounds.width) * width;
      const ratio = (localX - PADDING.left) / (width - PADDING.left - PADDING.right);
      const index = Math.round(ratio * (points.length - 1));
      setScrubIndex(Math.min(points.length - 1, Math.max(0, index)));
    },
    [points.length, width],
  );

  return (
    <figure ref={chartRef} className="m-0 flex flex-col gap-2">
      {/*
        * The readout sits above the drawing rather than following the dot.
        * A label chasing a finger is a label under the finger.
        */}
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-ink-2">{formatMonth(active.month)}</span>
        <span className="tnum text-caption text-ink">{format(active.netWorth)}</span>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={
          `What you have been worth from ${formatMonth(first.month)} to ` +
          `${formatMonth(last.month)}: ${format(first.netWorth)} then, ` +
          `${format(last.netWorth)} now.`
        }
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleScrub(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'touch') handleScrub(e);
        }}
        onPointerUp={() => setScrubIndex(null)}
        onPointerCancel={() => setScrubIndex(null)}
        onPointerLeave={() => setScrubIndex(null)}
      >
        {/* Zero, drawn only when the line has been below it. */}
        {geometry.showZero && (
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={geometry.zeroLine}
            y2={geometry.zeroLine}
            vectorEffect="non-scaling-stroke"
            stroke="var(--color-line-strong)"
            strokeWidth="1"
          />
        )}

        {passed.map((milestone, index) => (
          <g key={milestone.major}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={geometry.y(milestone.amount)}
              y2={geometry.y(milestone.amount)}
              vectorEffect="non-scaling-stroke"
              stroke="var(--color-line)"
              strokeWidth="1"
              strokeDasharray="2 5"
            />
            {/*
              * PHASE 5: the collision here is HORIZONTAL, not vertical.
              *
              * PRE-EXISTING, not caused by the redesign — this file has not
              * been touched since a318dd7, and `y` is derived from the value
              * through unchanged geometry, so nothing about the new palette or
              * type scale can move these labels down the page.
              *
              * What did change is the face: Space Grotesk is wider than Geist
              * at the same size. These are `textAnchor="end"`, so the extra
              * width extends LEFTWARDS from the right edge, and a long
              * formatted amount now reaches back far enough to overlap both
              * the label above it and the line itself.
              *
              * Do not go looking at vertical spacing. The fixes worth trying
              * are: drop to a compact format for the axis, keep only the
              * milestones that are far enough apart in value to label, or move
              * the labels inside the plot on the left where there is room.
              */}
            <text
              x={labelRightEdges[index]}
              y={geometry.y(milestone.amount) - 3}
              textAnchor="end"
              fill="var(--color-ink-3)"
              fontSize="8"
            >
              {labels[index]}
            </text>
          </g>
        ))}

        {/*
          * Steady progress at this window's own average. Drawn before the
          * solid line so the real one is never the thing being obscured.
          */}
        {points.length > 2 && (
          <line
            x1={geometry.x(0)}
            y1={geometry.y(first.netWorth)}
            x2={geometry.x(points.length - 1)}
            y2={geometry.y(last.netWorth)}
            vectorEffect="non-scaling-stroke"
            stroke="var(--color-ink-3)"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        )}

        <path
          d={geometry.linePath}
          fill="none"
          vectorEffect="non-scaling-stroke"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Where things stand now, or wherever the finger is. */}
        {scrubIndex !== null && (
          <line
            x1={geometry.x(activeIndex)}
            x2={geometry.x(activeIndex)}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            vectorEffect="non-scaling-stroke"
            stroke="var(--color-line-strong)"
            strokeWidth="1"
          />
        )}
        <circle
          cx={geometry.x(activeIndex)}
          cy={geometry.y(active.netWorth)}
          r="3"
          fill={stroke}
        />

        <text x={PADDING.left} y={HEIGHT - 6} fill="var(--color-ink-3)" fontSize="9">
          {formatMonth(first.month)}
        </text>
        <text
          x={width - PADDING.right}
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
