/* ===========================================================================
 * WHAT SITS INSIDE A FIELD
 * ---------------------------------------------------------------------------
 * The three or four supporting numbers that qualify the hero figure. In the
 * old design they were a paragraph; in the reference they are cells, and the
 * difference is the whole argument of the redesign — a person reads three
 * figures in a row faster than they read a sentence containing them.
 *
 * The cells sit on a translucent lift of the surface colour rather than on
 * white, so the same component works on a verdigris field in Daylight and an
 * indigo one in Midnight without either being told which it is on.
 * ======================================================================== */

import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface StatStripProps {
  children: ReactNode;
  className?: string;
}

/** A row of supporting figures across the bottom of a field. */
export function StatStrip({ children, className }: StatStripProps) {
  return <div className={clsx('flex gap-2', className)}>{children}</div>;
}

export interface StatCellProps {
  label: string;
  /** A `Money`, a duration, a count. Never a sentence. */
  children: ReactNode;
  /**
   * The same quantity said the other way — an amount beside a percentage, a
   * date beside a countdown. Optional, and still not a sentence.
   *
   * It exists because the alternative kept being a fourth cell, and four cells
   * across a phone is a table nobody reads. Two readings of one fact belong in
   * one cell.
   *
   * It sits on its own line rather than beside the figure. Inline was tried
   * and lost: three cells across a 390pt phone leaves about 86pt of text per
   * cell, and "+€1,543" with "+16.6%" after it truncated to "+€1,54…" — which
   * is worse than either figure on its own.
   */
  hint?: string;
  className?: string;
}

export function StatCell({ label, children, hint, className }: StatCellProps) {
  return (
    <div
      className={clsx(
        'min-w-0 flex-1 rounded-lg px-3 py-2.5',
        // A lift of whatever the field is sitting on, so this reads as raised
        // on both a light wash and a dark one.
        'bg-[color-mix(in_srgb,var(--color-surface)_62%,transparent)]',
        className,
      )}
    >
      <div className="truncate text-micro opacity-70">{label}</div>
      <div className="truncate pt-0.5 text-lead font-medium">{children}</div>
      {hint && <div className="truncate text-micro opacity-70">{hint}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * THE PROPORTION BAR
 * ---------------------------------------------------------------------------
 * A category row's share, drawn under its name. Deliberately thin: it is the
 * second thing read on that row, after the name and before the amount, and a
 * heavier bar would fight the amount for attention.
 * ------------------------------------------------------------------------ */

export function MiniBar({
  fraction,
  mark,
  className,
}: {
  /** 0 to 1 of the largest sibling, not of the total. */
  fraction: number;
  /**
   * A second position on the same track, drawn as a notch.
   *
   * The same mechanic `Ring` carries: the fill says where this is, the mark
   * says where it usually is, and the gap between them is the whole point. A
   * category past its own notch is running hot without anything having to
   * change colour to say so.
   */
  mark?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={clsx('relative mt-1.5 h-[5px] overflow-hidden rounded-pill bg-sunken', className)}
    >
      <div
        className="h-full rounded-pill bg-[var(--tile-ink,var(--color-ink-3))]"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
      {mark !== undefined && mark > 0 && (
        <span
          className="absolute top-0 h-full w-px bg-ink-2"
          style={{ left: `${Math.min(100, Math.max(0, mark) * 100)}%` }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * PERIOD PILLS
 * ---------------------------------------------------------------------------
 * Distinct from `Tabs`, which is the full ARIA tab pattern for switching
 * panes. This is the lighter thing the reference uses for a window of time —
 * Jul, Aug, Sep, 3 mo, Year — where there is no panel being controlled and the
 * whole strip is one choice.
 *
 * It scrolls when it does not fit, for the same reason `Tabs` does: five
 * labels of any length will eventually exceed a phone, and wrapping turns one
 * row into three.
 * ------------------------------------------------------------------------ */

export interface PillOption<T extends string> {
  value: T;
  label: string;
}

export function PillRow<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the choice for a screen reader, e.g. "Which period to look at". */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      // `py`/`-my` in a pair: a scroll container clips its children's
      // overflow, so without the padding the pills' 44px hit areas would be
      // cut back to the 34px the pills are drawn at. The negative margin
      // gives the padding back to the layout, so nothing moves.
      className={clsx('no-bar flex gap-1.5 overflow-x-auto py-[5px] -my-[5px]', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={clsx(
              'target press shrink-0 whitespace-nowrap rounded-pill px-3.5 py-2 text-caption font-medium',
              'transition-colors outline-none focus-visible:ring-1 focus-visible:ring-liquid',
              active
                ? 'bg-ink text-base'
                : 'bg-[color-mix(in_srgb,var(--color-surface)_70%,transparent)] text-ink-2',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
