/* ===========================================================================
 * ROWS
 * ---------------------------------------------------------------------------
 * Transactions, accounts, settings — all of them are the same shape: something
 * on the left, two lines in the middle, a figure on the right. Written once
 * here so the row height, the hairlines between rows and the press state stay
 * identical everywhere, instead of drifting apart file by file.
 *
 * A row with an `onClick` renders as a real button, so it is reachable by
 * keyboard and announced as pressable. A row without one renders as plain
 * content and is not focusable, because a div that traps a tab stop and does
 * nothing is worse than no affordance at all.
 * ======================================================================== */

import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface ListProps {
  children: ReactNode;
  /** Hairlines between rows. Off for standalone rows. */
  divided?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function List({ children, divided = true, className, ...rest }: ListProps) {
  return (
    <ul
      className={clsx(divided && 'divide-y divide-line-faint', className)}
      {...rest}
    >
      {children}
    </ul>
  );
}

export interface ListItemProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** An icon, an avatar, a coloured dot. */
  leading?: ReactNode;
  /** An amount, a pill, a chevron. */
  trailing?: ReactNode;
  onClick?: () => void;
  /** Dims the row without removing it — an ignored or reversed entry. */
  muted?: boolean;
  /**
   * Marks the row as chosen while a list is picking several at once.
   *
   * A wash rather than a border: a border would change the row's height and
   * make the whole list shift by a hairline as things are ticked.
   */
  selected?: boolean;
  className?: string;
}

export function ListItem({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  muted,
  selected,
  className,
}: ListItemProps) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}

      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-body', muted ? 'text-ink-3' : 'text-ink')}>
          {title}
        </span>
        {subtitle && (
          <span className="block truncate pt-0.5 text-caption text-ink-3">{subtitle}</span>
        )}
      </span>

      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
    </>
  );

  const shared = 'flex w-full items-center gap-3 px-4 py-3.5 text-left';

  return (
    <li className={className}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          {...(selected === undefined ? {} : { 'aria-pressed': selected })}
          className={clsx(
            shared,
            'transition-colors outline-none',
            selected ? 'bg-liquid-wash' : 'active:bg-raised hover:bg-raised/60',
            'focus-visible:ring-1 focus-visible:ring-liquid focus-visible:ring-inset',
          )}
        >
          {body}
        </button>
      ) : (
        <div className={shared}>{body}</div>
      )}
    </li>
  );
}

/** A sticky heading between groups of rows — a month, an account, a status. */
export function ListSectionHeader({ children }: { children: ReactNode }) {
  return (
    <li className="sticky top-0 z-10 border-b border-line-faint bg-surface/95 px-4 py-2 backdrop-blur-sm">
      <span className="text-micro font-medium uppercase tracking-[0.13em] text-ink-3">
        {children}
      </span>
    </li>
  );
}
