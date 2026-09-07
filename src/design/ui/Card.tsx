import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  /** Small uppercase label above the content. */
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
  return (
    <section
      className={clsx(
        // `rim` is the lit chamfer, not a border: an inset highlight along the
        // top edge plus a soft drop. A flat 1px line reads as a div; this
        // reads as an object sitting under the same light as everything else.
        'rim relative overflow-hidden rounded-lg',
        elevation === 'surface' ? 'bg-surface' : 'bg-raised',
        accent !== 'none' &&
          'before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[""]',
        ACCENT[accent],
        padding === 'normal' && 'p-4',
        padding === 'tight' && 'p-3',
        className,
      )}
    >
      {(label ?? action) && (
        <header
          className={clsx(
            'flex items-center justify-between gap-3',
            padding === 'none' ? 'px-4 pt-4 pb-2' : 'pb-3',
          )}
        >
          {label && (
            <h2 className="eyebrow text-ink-3">
              {label}
            </h2>
          )}
          {action && <div className="text-caption text-ink-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
