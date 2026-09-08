import clsx from 'clsx';
import type { ReactNode } from 'react';

/* ===========================================================================
 * THE CARD
 * ---------------------------------------------------------------------------
 * One of three surfaces, not the only one. This is the workaday container for
 * lists and charts: surface fill, a hairline, and a contact shadow tight
 * enough to read as occlusion rather than as a lift. `Field` is the coloured
 * panel at the top of a screen and `Tile` is the small coloured sibling in a
 * grid; both are in Surfaces.tsx.
 *
 * ---------------------------------------------------------------------------
 * THE LABEL IS SENTENCE CASE NOW, AND SOMETIMES NOTHING
 *
 * It used to render a tracked-out uppercase eyebrow. That treatment appeared
 * above almost every container in the app and was the loudest generated-design
 * tell left in it, so the class is gone and this renders `.section-title`
 * instead — the same size as body text, in sentence case, which is a thing
 * somebody can actually read rather than a decoration above the thing they
 * came for.
 *
 * A card with no label renders no header at all and no leading space, so the
 * content starts at the padding edge. That matters more than it sounds:
 * roughly half the cards in the app never had a label, and a header slot that
 * reserved height whether or not it held anything would have left a gap at the
 * top of every one of them.
 * ======================================================================== */

export interface CardProps {
  children: ReactNode;
  /**
   * A heading for the card, in sentence case.
   *
   * Leave it off when the content already says what it is — a chart with its
   * own axis labels, a single figure that is captioned in place. An empty
   * string is treated the same as leaving it off.
   */
  label?: string;
  /** Rendered opposite the label — a count, a filter, a link. */
  action?: ReactNode;
  /** `raised` lifts a card off a surface that is already elevated. */
  elevation?: 'surface' | 'raised';
  /** A hairline accent along the top edge, for tone without a coloured fill. */
  accent?: 'none' | 'liquid' | 'caution' | 'deficit';
  padding?: 'none' | 'tight' | 'normal';
  className?: string;
}

const ACCENT: Record<NonNullable<CardProps['accent']>, string> = {
  none: '',
  liquid: 'before:bg-liquid',
  caution: 'before:bg-caution',
  deficit: 'before:bg-deficit',
};

export function Card({
  children,
  label,
  action,
  elevation = 'surface',
  accent = 'none',
  padding = 'normal',
  className,
}: CardProps) {
  // An empty string is a caller saying "no heading", usually because the
  // heading moved into the content. Treat it as absent rather than rendering
  // an empty row that still takes its margin.
  const heading = label !== undefined && label !== '' ? label : null;
  const hasHeader = heading !== null || action !== undefined;

  return (
    <section
      className={clsx(
        'card relative overflow-hidden',
        elevation === 'raised' && 'bg-raised',
        accent !== 'none' &&
          'before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[""]',
        ACCENT[accent],
        padding === 'normal' && 'p-4',
        padding === 'tight' && 'p-3',
        className,
      )}
    >
      {hasHeader && (
        <header
          className={clsx(
            'flex items-baseline justify-between gap-3',
            padding === 'none' ? 'px-4 pt-4 pb-2' : 'pb-3',
          )}
        >
          {heading && <h2 className="section-title text-ink">{heading}</h2>}
          {action && <div className="text-caption text-ink-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
