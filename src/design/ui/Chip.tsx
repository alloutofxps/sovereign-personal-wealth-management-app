/* ===========================================================================
 * FILTER CHIPS
 * ---------------------------------------------------------------------------
 * Small, tappable, and stateful: a chip says both what it filters and whether
 * that filter is currently on. Counts use tabular figures so a row of chips
 * does not jitter as the numbers behind them change while you type.
 * ======================================================================== */

import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface ChipProps {
  children: ReactNode;
  /** Whether this filter is currently applied. */
  active?: boolean;
  onClick?: () => void;
  /** Shows an x. Given a handler, the chip can be taken off. */
  onDismiss?: () => void;
  /** Rendered in tabular figures, so widths stay steady. */
  count?: number;
  leading?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Chip({
  children,
  active = false,
  onClick,
  onDismiss,
  count,
  leading,
  disabled,
  className,
}: ChipProps) {
  const interactive = Boolean(onClick) && !disabled;

  return (
    <span
      className={clsx(
        'press inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[0.5px] pl-3 text-caption',
        'transition-colors',
        onDismiss ? 'pr-1.5' : 'pr-3',
        'h-8',
        active
          ? 'border-liquid-dim bg-liquid-wash text-liquid'
          : 'border-[var(--hairline)] bg-raised text-ink-2',
        interactive && !active && 'hover:border-line-strong hover:text-ink',
        disabled && 'opacity-50',
        className,
      )}
    >
      {interactive ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          disabled={disabled}
          className="flex items-center gap-1.5 outline-none focus-visible:underline"
        >
          {leading}
          <span>{children}</span>
          {count !== undefined && <Count value={count} active={active} />}
        </button>
      ) : (
        <span className="flex items-center gap-1.5">
          {leading}
          <span>{children}</span>
          {count !== undefined && <Count value={count} active={active} />}
        </span>
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Remove this filter`}
          className={clsx(
            'flex size-5 items-center justify-center rounded-full transition-colors',
            active ? 'text-liquid hover:bg-liquid-dim/30' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

function Count({ value, active }: { value: number; active: boolean }) {
  return (
    <span className={clsx('tnum text-caption', active ? 'text-liquid' : 'text-ink-3')}>
      {value}
    </span>
  );
}
