/* ===========================================================================
 * THE ROW
 * ---------------------------------------------------------------------------
 * A category-tinted square, a name, a line of metadata, and a figure hard
 * against the right edge. It appears on six of the eight reference screens —
 * transactions, categories, scheduled payments, holdings, the payoff order,
 * the vault — and it was being rebuilt by hand on each of them.
 *
 * The tinted square is the load-bearing part. It is the same hue the category
 * has in the donut and on its envelope tile, so a person scanning a list is
 * reading colour before they read words, and the row does not need a caption
 * telling them what kind of thing it is.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIGURE IS NOT A `Money` PROP
 *
 * The amount slot takes a node rather than a `Minor`, because the rows that
 * use it need different things there: a signed amount on a transaction, a
 * sparkline and an amount on a holding, a plain count on a tag. Taking the
 * node keeps one row component instead of four, and keeps `Money` the only
 * thing that ever formats an amount.
 * ======================================================================== */

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { familyClass, type Family } from '../category';

export interface RowProps {
  /** The thing itself: a payee, a category, a holding. */
  name: ReactNode;
  /** One line under it. A date, a cadence, a running total. */
  meta?: ReactNode;
  /**
   * What goes in the tinted square: an emoji, a two-letter ticker, a glyph.
   * Given nothing, the square is a plain block of the family's colour, which
   * still carries the category.
   */
  icon?: ReactNode;
  family?: Family;
  /** Right-aligned. An amount, a chip, a chevron. */
  trailing?: ReactNode;
  /** Sits between the metadata and the trailing slot — a sparkline, a bar. */
  aside?: ReactNode;
  onClick?: () => void;
  /** Dims the row without removing it — an ignored or reversed entry. */
  muted?: boolean;
  /** A wash rather than a border, so ticking a row does not shift the list. */
  selected?: boolean;
  className?: string;
}

export function Row({
  name,
  meta,
  icon,
  family = 'housing',
  trailing,
  aside,
  onClick,
  muted,
  selected,
  className,
}: RowProps) {
  const body = (
    <>
      <CategorySquare family={family}>{icon}</CategorySquare>

      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-body', muted ? 'text-ink-3' : 'text-ink')}>
          {name}
        </span>
        {meta && <span className="block truncate pt-0.5 text-caption text-ink-3">{meta}</span>}
      </span>

      {aside && <span className="shrink-0">{aside}</span>}
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
    </>
  );

  const shared = 'flex w-full items-center gap-3 py-3 text-left';

  if (!onClick) return <div className={clsx(shared, className)}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      {...(selected === undefined ? {} : { 'aria-pressed': selected })}
      className={clsx(
        shared,
        // A row is wide, so the same scale reads as a much larger movement
        // than it does on a button. `press-row` is the gentler one.
        'press-row rounded-lg px-2 -mx-2 outline-none transition-colors',
        selected ? 'bg-[var(--fill-subtle)]' : 'active:bg-[var(--fill-subtle)]',
        'focus-visible:ring-1 focus-visible:ring-liquid',
        className,
      )}
    >
      {body}
    </button>
  );
}

/**
 * The tinted square on its own.
 *
 * Exported because the calendar dot, the donut legend and the chip leading
 * slot all want the same swatch at a different size, and they should be
 * getting it from here rather than each mixing their own.
 */
export function CategorySquare({
  family = 'housing',
  size = 'md',
  children,
  className,
}: {
  family?: Family;
  size?: 'sm' | 'md';
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        familyClass(family),
        'flex shrink-0 items-center justify-center bg-[var(--tile-wash)] text-[var(--tile-ink)]',
        size === 'md' ? 'size-[2.375rem] rounded-md text-caption' : 'size-6 rounded-sm text-micro',
        'font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A list of rows with hairlines between them.
 *
 * Separate from `List` because that one owns the older full-bleed row with its
 * own padding, and the two are not the same object: this one sits inside a
 * card that already has padding, so the hairline runs edge to edge of the
 * content rather than of the card.
 */
export function RowList({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div className={clsx('divide-y divide-line-faint', className)} {...rest}>
      {children}
    </div>
  );
}
