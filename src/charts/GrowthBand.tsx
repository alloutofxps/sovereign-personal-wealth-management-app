/* ===========================================================================
 * THE GROWTH BAND
 * ---------------------------------------------------------------------------
 * A middle line for steady returns, with a shaded band for a better and a
 * worse run of markets, and dashed lines where the landmarks sit.
 *
 * The band is the honest part. A single confident line towards a number
 * decades away is the sort of chart that gets people into trouble; showing
 * how wide the range genuinely is says more than any disclaimer underneath.
 * ======================================================================== */

import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import type { Minor } from '@/core/money';
import { useChartWidth } from './useChartWidth';
import type { Milestone, TrajectoryPoint } from '@/core/simulate';

const HEIGHT = 140;
const PADDING = { top: 10, right: 6, bottom: 20, left: 6 };

export interface GrowthBandProps {
  points: readonly TrajectoryPoint[];
  /** Drawn as a dashed line across the chart, where it fits. */
  milestones: readonly Milestone[];
  format: (amount: Minor) => string;
  /** How many years to show. The full run is forty. */
  years: number;
}

export function GrowthBand({ points, milestones, format, years }: GrowthBandProps) {
  const [chartRef, width] = useChartWidth();
  const shown = useMemo(() => points.slice(0, years + 1), [points, years]);

  const geometry = useMemo(() => {
    if (shown.length < 2) return null;

    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const highest = Math.max(...shown.map((p) => p.high), 1);

    const x = scaleLinear()
      .domain([0, shown.length - 1])
      .range([PADDING.left, PADDING.left + innerWidth]);
    const y = scaleLinear()
      .domain([0, highest])
      .nice()
      .range([PADDING.top + innerHeight, PADDING.top]);

    const middle = line<TrajectoryPoint>()
      .x((_, i) => x(i))
      .y((p) => y(p.balance))
      .curve(curveMonotoneX);

    const band = area<TrajectoryPoint>()
      .x((_, i) => x(i))
      .y0((p) => y(p.low))
      .y1((p) => y(p.high))
      .curve(curveMonotoneX);

    return {
      x,
      y,
      highest,
      middlePath: middle([...shown]) ?? '',
      bandPath: band([...shown]) ?? '',
      baseline: y(0),
    };
  }, [shown, width]);

  if (!geometry) return null;

  return (
    <figure ref={chartRef} className="m-0 flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          `How your investments might grow over ${years} years: ` +
          `${format(shown.at(-1)!.balance)} in the middle, somewhere between ` +
          `${format(shown.at(-1)!.low)} and ${format(shown.at(-1)!.high)}.`
        }
      >
        <line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={geometry.baseline}
          y2={geometry.baseline}
          vectorEffect="non-scaling-stroke"
          stroke="var(--color-line)"
          strokeWidth="1"
        />

        {/* Where the landmarks sit, if they fit on the scale at all. */}
        {milestones
          .filter((milestone) => milestone.target > 0 && milestone.target <= geometry.highest)
          .map((milestone) => (
            <g key={milestone.kind}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={geometry.y(milestone.target)}
                y2={geometry.y(milestone.target)}
                vectorEffect="non-scaling-stroke"
                stroke="var(--color-line-strong)"
                strokeWidth="1"
                strokeDasharray="2 5"
              />
              <text
                x={PADDING.left}
                y={geometry.y(milestone.target) - 3}
                fill="var(--color-ink-3)"
                fontSize="8"
              >
                {shortLabel(milestone.kind)}
              </text>
            </g>
          ))}

        <path d={geometry.bandPath} fill="var(--color-liquid)" fillOpacity="0.14" />
        <path
          d={geometry.middlePath}
          fill="none"
          vectorEffect="non-scaling-stroke"
          stroke="var(--color-liquid)"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <text x={PADDING.left} y={HEIGHT - 6} className="tnum" fill="var(--color-ink-3)" fontSize="9">
          now
        </text>
        <text
          x={width - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="tnum"
          fill="var(--color-ink-3)"
          fontSize="9"
        >
          in {years} years
        </text>
      </svg>

      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-caption text-ink-2">
          In {years} years, most likely{' '}
          <span className="tnum text-ink">{format(shown.at(-1)!.balance)}</span>
        </span>
        <span className="tnum text-caption text-ink-3">
          somewhere between {format(shown.at(-1)!.low)} and {format(shown.at(-1)!.high)}
        </span>
      </figcaption>
    </figure>
  );
}

function shortLabel(kind: Milestone['kind']): string {
  switch (kind) {
    case 'coast':
      return 'could stop adding';
    case 'lean':
      return 'living simply';
    case 'full':
      return 'as you live now';
    case 'fat':
      return 'room to spare';
  }
}
