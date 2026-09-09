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
  className?: string;
}

export function StatCell({ label, children, className }: StatCellProps) {
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
  className,
}: {
  /** 0 to 1 of the largest sibling, not of the total. */
  fraction: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={clsx('mt-1.5 h-[5px] overflow-hidden rounded-pill bg-sunken', className)}
    >
      <div
        className="h-full rounded-pill bg-[var(--tile-ink,var(--color-ink-3))]"
        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
      />
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
      className={clsx('no-bar flex gap-1.5 overflow-x-auto', className)}
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
              'press shrink-0 whitespace-nowrap rounded-pill px-3.5 py-2 text-caption font-medium',
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
