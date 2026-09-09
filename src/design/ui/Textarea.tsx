/* ===========================================================================
 * MULTI-LINE TEXT
 * ---------------------------------------------------------------------------
 * `Input` renders an `<input>`, and a note or a pasted block of prices needs an
 * element that wraps. Four screens had each grown their own `<textarea>` with a
 * copy of `Input`'s class string on it, which is the same drift that made
 * `Input` necessary in the first place — so this is that textarea, once, with
 * the same label wiring, the same message slot and the same focus treatment.
 *
 * It is a separate component rather than a `multiline` flag on `Input` because
 * the two elements take genuinely different attributes — `rows`, `wrap` and
 * `cols` against `min`, `max`, `step` and `inputMode` — and one component
 * accepting the union of both would type-check calls that cannot work.
 *
 * `resize-none` is deliberate. A drag handle in the corner of a sheet on a
 * phone is a control nobody can use and everybody's thumb finds.
 * ======================================================================== */

import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  /** Shown under the field in plain language when something is wrong. */
  error?: string;
  /** Shown under the field the rest of the time. */
  hint?: string;
  /** Hold the space under the field even when there is nothing to say. */
  reserveMessageSpace?: boolean;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    error,
    hint,
    reserveMessageSpace = false,
    containerClassName,
    className,
    id,
    rows = 3,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? `textarea-${generated}`;
  const messageId = `${fieldId}-message`;
  const message = error ?? hint;

  return (
    <div className={clsx('flex flex-col gap-2', containerClassName)}>
      {label && (
        <label htmlFor={fieldId} className="text-caption text-ink-2">
          {label}
        </label>
      )}

      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={clsx(
          'w-full resize-none rounded-md border bg-surface px-3.5 py-3 text-body text-ink',
          'placeholder:text-ink-3',
          'transition-colors outline-none',
          'focus-visible:border-liquid focus-visible:ring-1 focus-visible:ring-liquid',
          error ? 'border-caution' : 'border-line-strong hover:border-ink-4',
          className,
        )}
        {...rest}
      />

      {(message ?? reserveMessageSpace) && (
        <p
          id={messageId}
          {...(error ? { role: 'alert' as const } : {})}
          className={clsx('min-h-[1rem] text-caption', error ? 'text-caution' : 'text-ink-3')}
        >
          {message ?? ' '}
        </p>
      )}
    </div>
  );
});
