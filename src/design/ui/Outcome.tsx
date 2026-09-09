/* ===========================================================================
 * WHAT THIS WILL DO
 * ---------------------------------------------------------------------------
 * The panel every sheet that previews an action was already drawing by hand.
 *
 * Thirteen sheets carried the same string —
 *
 *     rounded-md border border-line bg-raised px-3.5 py-3
 *
 * — around the same thing: the consequence of the button below it, stated
 * before it is pressed. Thirteen copies of one class list is not a system, it
 * is a habit; and because it was a habit rather than a component, the copies
 * had drifted into three different paddings and two different fills.
 *
 * ---------------------------------------------------------------------------
 * WHY IT HAS NO BORDER
 *
 * A sheet is already a surface with its own edge. Drawing a hairline box
 * inside one is a second edge two inches from the first, which is precisely
 * the "kit of identical boxes" the three-surface hierarchy exists to stop.
 *
 * A sunken fill says the same thing better: this is a consequence, not a
 * control. It reads as recessed rather than as another object stacked on top,
 * and it needs no line to separate it from what it is nested in.
 *
 * ---------------------------------------------------------------------------
 * THE TONE IS NOT A SEVERITY
 *
 * `caution` is for an action whose effect is harder to walk back — writing off
 * money somebody owes you, say. It is not a warning and never a failure: the
 * amber is the app's tone for "this one deserves reading twice", which is a
 * statement about attention, not about whether the person is doing something
 * wrong. There is no crimson here on purpose.
 * ======================================================================== */

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Money, type MoneyTone } from './Money';
import type { Minor } from '@/core/money';

export interface OutcomeProps {
  children: ReactNode;
  /** Rendered in the top corner — almost always an `<Explain>`. */
  action?: ReactNode;
  /** `caution` for an action that is harder to walk back. Never a failure. */
  tone?: 'neutral' | 'caution';
  className?: string;
}

export function Outcome({ children, action, tone = 'neutral', className }: OutcomeProps) {
  return (
    <div
      className={clsx(
        'flex flex-col gap-2 rounded-lg px-3.5 py-3',
        tone === 'caution' ? 'bg-caution-wash text-ink' : 'bg-sunken',
        className,
      )}
    >
      {action && <div className="flex justify-end">{action}</div>}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * ONE LINE OF THE ARITHMETIC
 * ---------------------------------------------------------------------------
 * A label and an amount, baseline-aligned. Three sheets had defined their own
 * local `Row` for this and a fourth had inlined it; they were identical apart
 * from which `Money` size they happened to pick.
 * ------------------------------------------------------------------------ */

export interface OutcomeRowProps {
  label: string;
  value: Minor;
  tone?: MoneyTone;
  /** `lead` for the figure the panel is about, `body` for the ones around it. */
  size?: 'body' | 'lead';
}

export function OutcomeRow({ label, value, tone, size = 'body' }: OutcomeRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-caption text-ink-2">{label}</span>
      <Money value={value} size={size} {...(tone ? { tone } : {})} />
    </div>
  );
}
