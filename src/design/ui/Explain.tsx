/* ===========================================================================
 * THE INFORMATION BUTTON
 * ---------------------------------------------------------------------------
 * A 22px circle with a 44×44 tap target around it.
 *
 * The glyph is small because it sits beside a label and must not compete with
 * it; the target is large because a 22px control is unhittable with a thumb.
 * Those are two different measurements and conflating them is how an app ends
 * up with either a shouting icon or one nobody can press — so the padding
 * carries the difference and the glyph stays where it was drawn.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUTTON DOES NOT OPEN THE SHEET
 *
 * It reports the topic upwards and the screen owns the sheet. Two reasons: the
 * sheet needs live figures for its worked example and only the screen has
 * them, and a button that carried its own portal would put nineteen
 * explanations of prose into the first paint to render a circle.
 * ======================================================================== */

import clsx from 'clsx';
import type { ExplainTopic } from '@/content/explain';

export interface ExplainProps {
  topic: ExplainTopic;
  /**
   * What this explains, for anybody who cannot see where the button sits.
   *
   * "More about" plus the label beside it. A screen reader announcing
   * "button, information" nineteen times a screen has told somebody nothing.
   */
  label: string;
  onOpen: (topic: ExplainTopic) => void;
  className?: string;
}

export function Explain({ topic, label, onOpen, className }: ExplainProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(topic)}
      aria-label={`More about ${label}`}
      className={clsx(
        // The target, not the glyph: 44px square, centred on a 22px circle.
        'press -m-[11px] flex size-11 shrink-0 items-center justify-center',
        'text-ink-3 transition-colors [@media(hover:hover)]:hover:text-ink-2',
        'outline-none focus-visible:text-ink',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'flex size-[22px] items-center justify-center rounded-full',
          'border-[1.25px] border-current text-[13px] font-medium leading-none',
        )}
      >
        i
      </span>
    </button>
  );
}
