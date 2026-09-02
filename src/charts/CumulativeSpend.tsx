/* ===========================================================================
 * THE CUMULATIVE SPEND CURVE
 * ---------------------------------------------------------------------------
 * Days across, money up. A dashed line for an even spread, a solid one for
 * what actually happened, and the gap between them is the whole story.
 *
 * Built on d3-shape and d3-scale only — they compute path geometry and return
 * strings, with no opinions about the DOM. That is a few kilobytes rather than
 * the hundred-odd a charting library costs, and it means the curve is styled
 * with our own tokens instead of being fought into shape.
 *
 * The scrub is a pointer handler over a single transparent rectangle. No
 * per-point hit areas, no listeners per element, nothing recreated on move —
 * the only thing that changes as a finger travels is one index in state, so
 * it holds 60fps on a mid-range phone.
 * ======================================================================== */

import { useCallback, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import type { PacingPoint } from '@/core/liquidity';
import type { Minor } from '@/core/money';

/** A fixed drawing space; the SVG scales itself through its viewBox. */
const WIDTH = 320;
const HEIGHT = 148;
const PADDING = { top: 10, right: 6, bottom: 20, left: 6 };

export interface CumulativeSpendProps {
  points: readonly PacingPoint[];
  /** Formats an amount for the readout and the top gridline. */
  format: (amount: Minor) => string;
  /** Formats a date for the readout under the finger — "Today", "Monday". */
  formatDate: (iso: string) => string;
  /** Formats the two axis ends, where a weekday would read oddly — "1 Sep". */
  formatAxisDate: (iso: string) => string;
  /** Today, so the curve knows where to stop and put its marker. */
  today: string;
}

export function CumulativeSpend({
  points,
  format,
  formatDate,
  formatAxisDate,
  today,
}: CumulativeSpendProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const innerWidth = WIDTH - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const peak = Math.max(
      ...points.map((p) => Math.max(p.cumulative, p.target)),
      1, // never a zero-height scale
    );

    const x = scaleLinear().domain([0, points.length - 1]).range([PADDING.left, PADDING.left + innerWidth]);
    const y = scaleLinear().domain([0, peak]).nice().range([PADDING.top + innerHeight, PADDING.top]);

    const actual = points.filter((p) => p.actual);

    const spendLine = line<PacingPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.cumulative))
      .curve(curveMonotoneX);

    const spendArea = area<PacingPoint>()
      .x((_, i) => x(i))
      .y0(y(0))
      .y1((p) => y(p.cumulative))
      .curve(curveMonotoneX);

    const targetLine = line<PacingPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.target));

    return {
      x,
      y,
      peak,
      actualCount: actual.length,
      actualPath: spendLine(actual) ?? '',
      areaPath: spendArea(actual) ?? '',
      targetPath: targetLine([...points]) ?? '',
      baseline: y(0),
      top: y(y.domain()[1] ?? peak),
    };
  }, [points]);

  /** Map a pointer position to the nearest day. */
  const handleScrub = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !geometry || points.length === 0) return;

      const bounds = svg.getBoundingClientRect();
      // The SVG scales via viewBox, so convert the pointer into its own units.
      const localX = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
      const ratio = (localX - PADDING.left) / (WIDTH - PADDING.left - PADDING.right);
      const index = Math.round(ratio * (points.length - 1));
      setScrubIndex(Math.min(points.length - 1, Math.max(0, index)));
    },
    [geometry, points.length],
  );

  if (!geometry || points.length === 0) return null;

  const todayIndex = Math.max(0, geometry.actualCount - 1);
  const activeIndex = scrubIndex ?? todayIndex;
  const active = points[activeIndex];
  const activeX = geometry.x(activeIndex);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-ink-2">
          {active ? formatDate(active.date) : formatDate(today)}
        </span>
        <span className="tnum text-caption text-ink">
          {active ? format(active.cumulative) : ''}{' '}
          <span className="text-ink-3">spent so far</span>
        </span>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={
          `How your spending has built up this month. ` +
          `${format(points[todayIndex]?.cumulative ?? (0 as Minor))} so far, against ` +
          `${format(points[todayIndex]?.target ?? (0 as Minor))} if it were spread evenly.`
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
        <defs>
          <linearGradient id="spend-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-liquid)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-liquid)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Two hairlines only: the floor and the top of the scale. A dense
            grid would compete with the two lines that carry the meaning. */}
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={geometry.baseline}
          y2={geometry.baseline}
          stroke="var(--color-line)"
          strokeWidth="1"
        />
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={geometry.top}
          y2={geometry.top}
          stroke="var(--color-line)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        {/* Where an even spread would have you. */}
        <path
          d={geometry.targetPath}
          fill="none"
          stroke="var(--color-ink-3)"
          strokeWidth="1.25"
          strokeDasharray="3 4"
          strokeLinecap="round"
        />

        {/* What actually happened. */}
        <path d={geometry.areaPath} fill="url(#spend-fade)" />
        <path
          d={geometry.actualPath}
          fill="none"
          stroke="var(--color-liquid)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* The point under the finger. */}
        {active && (
          <>
            <line
              x1={activeX}
              x2={activeX}
              y1={PADDING.top}
              y2={geometry.baseline}
              stroke="var(--color-line-strong)"
              strokeWidth="1"
            />
            <circle
              cx={activeX}
              cy={geometry.y(active.cumulative)}
              r="3.5"
              fill="var(--color-base)"
              stroke="var(--color-liquid)"
              strokeWidth="2"
            />
          </>
        )}

        <text
          x={PADDING.left}
          y={HEIGHT - 6}
          className="tnum"
          fill="var(--color-ink-3)"
          fontSize="9"
        >
          {formatAxisDate(points[0]?.date ?? today)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="tnum"
          fill="var(--color-ink-3)"
          fontSize="9"
        >
          {formatAxisDate(points.at(-1)?.date ?? today)}
        </text>
      </svg>
    </figure>
  );
}
