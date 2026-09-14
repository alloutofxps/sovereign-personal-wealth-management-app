/* ===========================================================================
 * THE RING
 * ---------------------------------------------------------------------------
 * A proportion drawn as an arc, with the figure in the middle of it.
 *
 * It appears twice in the reference sheet and means something different each
 * time — days left until payday on Today, and how much of a category has been
 * spent on Envelopes — but the drawing is the same, so it is written once.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ARC IS A DASH AND NOT A PATH
 *
 * A circle with `stroke-dasharray` set to its own circumference and
 * `stroke-dashoffset` set to the unfilled part draws exactly the arc wanted,
 * with no trigonometry and no path string to get wrong. Rotating it -90°
 * starts it at twelve o'clock, which is where a person expects a dial to
 * begin.
 *
 * The circumference is computed rather than written down. The reference sheet
 * has 163.36 hard-coded for r=26, which is correct and stops being correct the
 * moment anybody changes the radius.
 * ======================================================================== */

import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

export interface RingProps {
  /** 0 to 1. Values above 1 are clamped: an arc cannot lap itself legibly. */
  progress: number;
  /** Drawn in the middle. A count, a percentage, nothing at all. */
  children?: ReactNode;
  /** A word under the figure, e.g. "days". Small and quiet by design. */
  caption?: string;
  size?: number;
  /** Stroke width. Heavier reads as a dial, lighter as a chart. */
  weight?: number;
  className?: string;
  /**
   * A second position on the same dial, drawn as a tick.
   *
   * This is what turns a progress ring into a *pacing* ring. The arc says how
   * much of the money has gone; the tick says how much of the period has. The
   * gap between them is the whole of what the pacing engine computes, and
   * drawing both on one dial says it without a sentence — which is the point,
   * because a sentence per envelope is a paragraph per screen.
   */
  mark?: number;
  /** What the arc means, for anybody who cannot see it. */
  'aria-label'?: string;
}

export function Ring({
  progress,
  children,
  caption,
  mark,
  size = 64,
  weight = 7,
  className,
  ...rest
}: RingProps) {
  // Inset by half the stroke, or the arc is clipped by its own viewBox.
  const radius = size / 2 - weight / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, progress));
  const centre = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={clsx('shrink-0', className)}
      role={rest['aria-label'] ? 'img' : undefined}
      {...rest}
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth={weight}
      />
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={weight}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
        transform={`rotate(-90 ${centre} ${centre})`}
        // Named and given its own span so the entrance in tokens.css can sweep
        // it from empty without being told where to stop. Inside a field only;
        // see THE ONE MOMENT there.
        className="ring-arc"
        style={{ '--ring-span': circumference } as CSSProperties}
        // Strokes are specified in the drawing's own units, so without this
        // they scale with the viewBox and land heavier on a wider phone.
        vectorEffect="non-scaling-stroke"
      />
      {mark !== undefined && (
        // A short radial tick at the mark's angle. Drawn as a dash on the same
        // circle so it lands exactly on the arc's own path rather than being
        // positioned by trigonometry that has to agree with it.
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth={weight}
          strokeDasharray={`2 ${circumference}`}
          strokeDashoffset={-circumference * Math.max(0, Math.min(1, mark))}
          transform={`rotate(-90 ${centre} ${centre})`}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {children !== undefined && (
        <text
          x={centre}
          y={caption ? centre + 2 : centre + 5}
          textAnchor="middle"
          className="figure"
          fontSize={size * 0.27}
          fill="currentColor"
        >
          {children}
        </text>
      )}
      {caption && (
        <text
          x={centre}
          y={centre + size * 0.19}
          textAnchor="middle"
          fontSize={size * 0.12}
          fill="currentColor"
          opacity="0.65"
        >
          {caption}
        </text>
      )}
    </svg>
  );
}
