/* ===========================================================================
 * THE FORECAST CURVE
 * ---------------------------------------------------------------------------
 * Where your balance is heading, with the safety cushion drawn across it.
 *
 * The line changes colour where it drops under the cushion, so the answer to
 * "am I going to be alright?" is available without reading a single number.
 * Amber, never red: dipping into a cushion is a thing to know about, not a
 * thing to be told off for.
 *
 * Same performance shape as the spend curve — one pointer handler over the
 * whole SVG updating a single index, and all the geometry memoised.
 * ======================================================================== */

import { useCallback, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import type { Minor } from '@/core/money';
import { useChartWidth } from './useChartWidth';
import type { ProjectionPoint } from '@/core/forecast';

const HEIGHT = 150;
const PADDING = { top: 12, right: 6, bottom: 22, left: 6 };

export interface ForecastBandProps {
  points: readonly ProjectionPoint[];
  buffer: Minor;
  format: (amount: Minor) => string;
  formatDate: (iso: string) => string;
  formatAxisDate: (iso: string) => string;
}

export function ForecastBand({
  points,
  buffer,
  format,
  formatDate,
  formatAxisDate,
}: ForecastBandProps) {
  const [chartRef, width] = useChartWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const values = points.map((p) => p.balance);
    // The cushion is always on the scale, or the threshold line would sit off
    // the top or bottom of the chart and mean nothing.
    const high = Math.max(...values, buffer, 1);
    const low = Math.min(...values, buffer, 0);

    const x = scaleLinear()
      .domain([0, points.length - 1])
      .range([PADDING.left, PADDING.left + innerWidth]);
    const y = scaleLinear()
      .domain([low, high])
      .nice()
      .range([PADDING.top + innerHeight, PADDING.top]);

    const balanceLine = line<ProjectionPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.balance))
      .curve(curveMonotoneX);

    const balanceArea = area<ProjectionPoint>()
      .x((_, i) => x(i))
      .y0(y(low))
      .y1((p) => y(p.balance))
      .curve(curveMonotoneX);

    // Where the line is under the cushion, drawn over the top in amber.
    const shortfallRuns: ProjectionPoint[][] = [];
    let run: ProjectionPoint[] = [];
    for (const point of points) {
      if (point.belowBuffer) run.push(point);
      else if (run.length > 0) {
        shortfallRuns.push(run);
        run = [];
      }
    }
    if (run.length > 0) shortfallRuns.push(run);

    return {
      x,
      y,
      bufferY: y(buffer),
      zeroY: y(0),
      floor: y(low),
      linePath: balanceLine([...points]) ?? '',
      areaPath: balanceArea([...points]) ?? '',
      shortfallPaths: shortfallRuns.map((segment) => {
        const from = points.indexOf(segment[0]!);
        const scoped = line<ProjectionPoint>()
          .x((_, i) => x(i + from))
          .y((p) => y(p.balance))
          .curve(curveMonotoneX);
        return scoped(segment) ?? '';
      }),
      /*
       * Every stretch where the balance is under the cushion, as an x-range.
       *
       * ALL of them are hatched. A squeeze is a fact about the shape of the
       * period, it is descriptive, and hiding the second one would be hiding
       * something true. Only the deepest is named — see the label below, and
       * the rule in CLAUDE.md.
       */
      squeezes: shortfallRuns.map((segment) => {
        const from = points.indexOf(segment[0]!);
        const deepest = segment.reduce((low2, p) => (p.balance < low2.balance ? p : low2));
        return {
          x0: x(from),
          x1: x(from + segment.length - 1),
          deepest,
          deepestX: x(from + segment.indexOf(deepest)),
        };
      }),
      showsZero: low < 0,
    };
  }, [points, buffer, width]);

  const handleScrub = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || points.length === 0) return;
      const bounds = svg.getBoundingClientRect();
      const localX = ((event.clientX - bounds.left) / bounds.width) * width;
      const ratio = (localX - PADDING.left) / (width - PADDING.left - PADDING.right);
      const index = Math.round(ratio * (points.length - 1));
      setScrubIndex(Math.min(points.length - 1, Math.max(0, index)));
    },
    [points.length],
  );

  if (!geometry || points.length === 0) return null;

  const activeIndex = scrubIndex ?? 0;
  const active = points[activeIndex]!;
  const activeX = geometry.x(activeIndex);

  // The one worth naming: the window holding the lowest point of them all.
  const deepestSqueeze =
    geometry.squeezes.length === 0
      ? null
      : geometry.squeezes.reduce((worst, s) =>
          s.deepest.balance < worst.deepest.balance ? s : worst,
        );

  /*
   * Where the word sits.
   *
   * Centred on the deepest day, but kept inside the drawing: a squeeze whose
   * lowest point is the first day put half of "tight" past x=0 and it rendered
   * as "ight". The word annotates a band rather than marking a tick, so
   * sliding it along the band costs nothing and clipping it costs the label.
   */
  const SQUEEZE_LABEL_HALF_WIDTH = 14;
  const squeezeLabelX =
    deepestSqueeze === null
      ? 0
      : Math.min(
          Math.max(deepestSqueeze.deepestX, PADDING.left + SQUEEZE_LABEL_HALF_WIDTH),
          width - PADDING.right - SQUEEZE_LABEL_HALF_WIDTH,
        );

  return (
    <figure ref={chartRef} className="m-0 flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-ink-2">{formatDate(active.date)}</span>
        <span className="tnum text-caption text-ink">
          {format(active.balance)}{' '}
          <span className="text-ink-3">{active.belowBuffer ? 'into your cushion' : 'in the bank'}</span>
        </span>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`Your projected balance over the next ${points.length - 1} days, ending at ${format(points.at(-1)!.balance)}.`}
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
          <linearGradient id="forecast-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-liquid)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--color-liquid)" stopOpacity="0" />
          </linearGradient>
          {/*
            * The squeeze hatch.
            *
            * A pattern rather than a fill, because a solid block over the
            * chart would read as a region of the data. Diagonal lines read as
            * an annotation laid on top of it, which is what this is.
            */}
          <pattern
            id="forecast-squeeze"
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              vectorEffect="non-scaling-stroke"
              stroke="var(--color-obligation)"
              strokeWidth="2.6"
              opacity="0.3"
            />
          </pattern>
        </defs>

        {/*
          * Every tight window, hatched. See the note in the geometry above:
          * describing all of them is the point, and there may be three.
          */}
        {geometry.squeezes.map((squeeze) => (
          <rect
            key={squeeze.deepest.date}
            x={squeeze.x0}
            y={PADDING.top}
            width={Math.max(2, squeeze.x1 - squeeze.x0)}
            height={geometry.floor - PADDING.top}
            fill="url(#forecast-squeeze)"
          />
        ))}

        <path d={geometry.areaPath} fill="url(#forecast-fade)" />

        {/* Zero, only when the projection actually reaches it. */}
        {geometry.showsZero && (
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={geometry.zeroY}
            y2={geometry.zeroY}
            vectorEffect="non-scaling-stroke"
            stroke="var(--color-deficit-dim)"
            strokeWidth="1"
          />
        )}

        {/*
          * ONE label, on the deepest squeeze only.
          *
          * The hatching describes every tight window; this names the one worth
          * planning around. Three labels on one chart is no label — the eye
          * has nowhere to go — so this picks a single winner rather than
          * annotating each band. See CLAUDE.md: describe every instance, name
          * only the one that needs a decision.
          */}
        {deepestSqueeze && (
          <text
            x={squeezeLabelX}
            y={PADDING.top + 10}
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill="var(--color-obligation)"
          >
            tight
          </text>
        )}

        {/* The cushion. */}
        <line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={geometry.bufferY}
          y2={geometry.bufferY}
          vectorEffect="non-scaling-stroke"
          stroke="var(--color-caution-dim)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <text
          x={width - PADDING.right}
          y={geometry.bufferY - 4}
          textAnchor="end"
          fill="var(--color-caution-dim)"
          fontSize="8"
          className="tnum"
        >
          your cushion
        </text>

        <path
          d={geometry.linePath}
          fill="none"
          vectorEffect="non-scaling-stroke"
          stroke="var(--color-liquid)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Amber over the stretches that fall short. */}
        {geometry.shortfallPaths.map((d, index) => (
          <path
            key={index}
            d={d}
            fill="none"
            vectorEffect="non-scaling-stroke"
            stroke="var(--color-caution)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        ))}

        <line
          x1={activeX}
          x2={activeX}
          y1={PADDING.top}
          y2={geometry.floor}
          vectorEffect="non-scaling-stroke"
          stroke="var(--color-line-strong)"
          strokeWidth="1"
        />
        <circle
          cx={activeX}
          cy={geometry.y(active.balance)}
          r="3.5"
          fill="var(--color-base)"
          vectorEffect="non-scaling-stroke"
          stroke={active.belowBuffer ? 'var(--color-caution)' : 'var(--color-liquid)'}
          strokeWidth="2"
        />

        <text x={PADDING.left} y={HEIGHT - 6} className="tnum" fill="var(--color-ink-3)" fontSize="9">
          {formatAxisDate(points[0]!.date)}
        </text>
        <text
          x={width - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="tnum"
          fill="var(--color-ink-3)"
          fontSize="9"
        >
          {formatAxisDate(points.at(-1)!.date)}
        </text>
      </svg>
    </figure>
  );
}
