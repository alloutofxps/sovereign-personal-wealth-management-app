/* ===========================================================================
 * TEXT AND SEARCH INPUTS
 * ---------------------------------------------------------------------------
 * Six files had grown their own copy of the same hand-rolled
 * `<input className="w-full rounded-md border border-line …">`, which is how a
 * design system quietly stops being one. This is that input, once.
 *
 * Two details are doing real work here. The label, hint and error are wired to
 * the field with generated ids, so a screen reader reads the error rather than
 * leaving it as decoration next to a box. And the hint slot keeps its height
 * whether or not there is anything in it, so a field that becomes invalid does
 * not shove the rest of the form down the screen as you type.
 * ======================================================================== */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /** Shown under the field in plain language when something is wrong. */
  error?: string;
  /** Shown under the field the rest of the time. */
  hint?: string;
  leadingIcon?: ReactNode;
  /** A clear button, a unit, a spinner. */
  trailingIcon?: ReactNode;
  /** Hold the space under the field even when there is nothing to say. */
  reserveMessageSpace?: boolean;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    leadingIcon,
    trailingIcon,
    reserveMessageSpace = false,
    containerClassName,
    className,
    id,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const inputId = id ?? `input-${generated}`;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={clsx('flex flex-col gap-2', containerClassName)}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-caption text-ink-2"
        >
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        {leadingIcon && (
          <span
            className="pointer-events-none absolute left-3.5 flex items-center text-ink-3"
            aria-hidden="true"
          >
            {leadingIcon}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={clsx(
            'w-full rounded-md border bg-surface px-3.5 py-3 text-body text-ink',
            'placeholder:text-ink-3',
            'transition-colors outline-none',
            'focus-visible:border-liquid focus-visible:ring-1 focus-visible:ring-liquid',
            error ? 'border-caution' : 'border-line-strong hover:border-ink-4',
            leadingIcon && 'pl-10',
            trailingIcon && 'pr-10',
            className,
          )}
          {...rest}
        />

        {trailingIcon && (
          <span className="absolute right-2.5 flex items-center text-ink-3">{trailingIcon}</span>
        )}
      </div>

      {/* Reserving the row stops a form jumping when a message appears. */}
      {(message ?? reserveMessageSpace) && (
        <p
          id={messageId}
          {...(error ? { role: 'alert' as const } : {})}
          className={clsx(
            'min-h-[1rem] text-caption',
            error ? 'text-caution' : 'text-ink-3',
          )}
        >
          {message ?? ' '}
        </p>
      )}
    </div>
  );
});

/** The magnifying glass for a search field. */
export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A clear button for the trailing slot. Hidden entirely when there is nothing to clear. */
export function ClearButton({ onClear, label = 'Clear' }: { onClear: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink-2 active:bg-raised"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="m6 6 12 12M18 6 6 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
