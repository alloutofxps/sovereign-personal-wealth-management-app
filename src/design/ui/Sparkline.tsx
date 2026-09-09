/* ===========================================================================
 * THE SPARKLINE
 * ---------------------------------------------------------------------------
 * A shape, at the size of a word.
 *
 * It exists so a list of holdings is itself a chart. A row that says a name, a
 * percentage and an amount tells you what a thing is worth; the same row with
 * the line in it tells you how it got there, which is the part somebody is
 * actually scanning for. Nothing about it is interactive and nothing is
 * labelled — at this size a label would be longer than the drawing.
 *
 * ---------------------------------------------------------------------------
 * IT DRAWS NOTHING RATHER THAN DRAWING A LIE
 *
 * Fewer than two points is not a line, and one point stretched across a box
 * reads as "flat" when the truth is "we do not know yet". A flat line is a
 * claim; an empty space is not.
 * ======================================================================== */

import clsx from 'clsx';

export interface SparklineProps {
  /** Oldest first. Fewer than two and nothing is drawn. */
  values: readonly number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ values, width = 56, height = 22, className }: SparklineProps) {
  if (values.length < 2) return null;

  const high = Math.max(...values);
  const low = Math.min(...values);
  const span = high - low;

  // A flat series has no range to scale against. Draw it down the middle
  // rather than dividing by zero or pinning it to an edge, which would read
  // as a fall to the floor.
  const y = (value: number) =>
    span === 0 ? height / 2 : height - 2 - ((value - low) / span) * (height - 4);
  const x = (index: number) => (index / (values.length - 1)) * width;

  const path = values.map((value, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={clsx('shrink-0 overflow-visible', className)}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Without this the stroke scales with the viewBox and lands heavier on
        // a wider phone than it was drawn for.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
