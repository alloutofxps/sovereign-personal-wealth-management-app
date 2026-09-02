import clsx from 'clsx';
import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'liquid' | 'caution' | 'deficit';

export interface StatPillProps {
  label: string;
  value: ReactNode;
  /** Optional trailing context — "of 14 days", "since Tuesday". */
  detail?: string;
  tone?: PillTone;
  /** A filled dot before the label, for status at a glance. */
  dot?: boolean;
  className?: string;
}

const TONE: Record<PillTone, { border: string; text: string; dot: string; wash: string }> = {
  neutral: { border: 'border-line', text: 'text-ink', dot: 'bg-ink-3', wash: 'bg-raised' },
  liquid: {
    border: 'border-liquid-dim/50',
    text: 'text-liquid',
    dot: 'bg-liquid',
    wash: 'bg-liquid-wash',
  },
  caution: {
    border: 'border-caution-dim/50',
    text: 'text-caution',
    dot: 'bg-caution',
    wash: 'bg-caution-wash',
  },
  deficit: {
    border: 'border-deficit-dim/50',
    text: 'text-deficit',
    dot: 'bg-deficit',
    wash: 'bg-deficit-wash',
  },
};

/**
 * A compact labelled figure. Used across the triage bar and the dashboard's
 * lower band, where several numbers sit side by side and each needs its own
 * status without any of them shouting.
 */
export function StatPill({ label, value, detail, tone = 'neutral', dot, className }: StatPillProps) {
  const t = TONE[tone];
  return (
    <div
      className={clsx(
        'flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2.5',
        t.border,
        t.wash,
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {dot && <span className={clsx('size-1.5 shrink-0 rounded-full', t.dot)} aria-hidden="true" />}
        <span className="truncate text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
      </div>
      <div className={clsx('truncate text-lead font-medium tnum', t.text)}>{value}</div>
      {detail && <div className="truncate text-caption text-ink-3">{detail}</div>}
    </div>
  );
}
