/* ===========================================================================
 * THREE SURFACES, DELIBERATELY UNLIKE EACH OTHER
 * ---------------------------------------------------------------------------
 * There used to be one. Every container in the app carried the same radius,
 * the same hairline and the same shadow whether it held net worth or two
 * transactions, and that is the single biggest reason the screens read as
 * generated: a hierarchy of containers is information, a kit of identical ones
 * is wallpaper.
 *
 *   Field   large, flat, category-coloured, no border, no shadow.
 *           EXACTLY ONE PER SCREEN, at the top, carrying the number that
 *           screen exists for.
 *   Card    surface fill, hairline, tight contact shadow. Lists and charts.
 *   Tile    category-coloured, small, no shadow, in a grid of siblings.
 *           Its colour is its category, never its status.
 *
 * The radii are hierarchical — hero > card > lg > md > sm — so size and
 * roundness agree and the eye can tell what kind of thing it is looking at
 * before it reads a word.
 * ======================================================================== */

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { familyClass, type Family } from '../category';

/* --- the field ----------------------------------------------------------- */

export interface FieldProps {
  children: ReactNode;
  /**
   * Which family colours it. The field takes the hue of whatever it is about:
   * the housing verdigris on Today because that is the app's spine, the
   * transport blue on Invested, the obligation clay on Payoff.
   *
   * `'none'` is for the one screen whose subject is every family at once.
   * Where it went is that screen — the Sankey under its field colours every
   * ribbon by family, so a hue above it would be a claim about nothing. It
   * goes sunken instead of washed, the way `QuietTile` does at tile size.
   * Reach for it only when a hue would be *wrong*, not when one is hard to
   * pick: a field with no family on a screen that has one is a field that
   * stopped indexing anything.
   */
  family?: Family | 'none';
  className?: string;
}

/**
 * The one panel a screen is built around.
 *
 * There is no `label` prop and no header slot on purpose. A field holds a
 * figure and the two or three things that qualify it, laid out by the screen
 * that owns it — the moment it grows a standard header it becomes another
 * card and the hierarchy collapses back to one surface.
 */
export function Field({ children, family = 'housing', className }: FieldProps) {
  return (
    <section
      className={clsx(
        'field',
        family === 'none' ? 'field-quiet' : familyClass(family),
        className,
      )}
    >
      {children}
    </section>
  );
}

/* --- the tile ------------------------------------------------------------ */

export interface TileProps {
  children: ReactNode;
  family?: Family;
  /** Renders as a button when given, keeping the tile a real tap target. */
  onClick?: () => void;
  /** Announced instead of the tile's text where the text is only figures. */
  'aria-label'?: string;
  className?: string;
}

export function Tile({ children, family = 'housing', onClick, className, ...rest }: TileProps) {
  // `relative` so a tile can carry a mark in its corner without the caller
  // having to remember to add it.
  const classes = clsx('tile relative', familyClass(family), className);
  if (!onClick) {
    return (
      <div className={classes} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} className={clsx(classes, 'press text-left')} {...rest}>
      {children}
    </button>
  );
}

/* --- the neutral tile ---------------------------------------------------- */

/**
 * A tile with no family, for the one slot on a screen that is genuinely about
 * everything rather than about a category — "assets minus debts" on the net
 * worth screen, say. Sunken rather than coloured, so it reads as the odd one
 * out on purpose rather than as a category nobody assigned a hue to.
 */
export function QuietTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-card bg-sunken p-4 text-ink-2', className)}>{children}</div>
  );
}
