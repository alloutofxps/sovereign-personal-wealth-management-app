/* ===========================================================================
 * CHOOSING ONE OF SEVERAL
 * ---------------------------------------------------------------------------
 * A native `<select>`, dressed to match `Input`. Native on purpose: on a phone
 * this opens the platform's own wheel or list, which is faster to use, works
 * with every assistive technology already, and cannot trap focus — none of
 * which a hand-built popover gets for free.
 *
 * Option groups are supported because 6.3 introduces category groups, and a
 * flat list of thirty categories is exactly the thing groups exist to fix.
 * ======================================================================== */

import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  hint?: string;
  /** Flat options, or groups. Groups win when both are given. */
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  /** Shown as a disabled first row when nothing is chosen yet. */
  placeholder?: string;
  /** What to say when there is genuinely nothing to choose from. */
  emptyLabel?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    error,
    hint,
    options,
    groups,
    placeholder,
    emptyLabel = 'Nothing to choose from yet',
    containerClassName,
    className,
    id,
    value,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const selectId = id ?? `select-${generated}`;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;

  const groupList = groups ?? [];
  const flatList = options ?? [];
  const isEmpty = groupList.length === 0 && flatList.length === 0;

  const renderOption = (option: SelectOption) => (
    <option key={option.value} value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  );

  return (
    <div className={clsx('flex flex-col gap-2', containerClassName)}>
      {label && (
        <label
          htmlFor={selectId}
          className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3"
        >
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        <select
          ref={ref}
          id={selectId}
          value={value}
          disabled={isEmpty || rest.disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={clsx(
            'w-full appearance-none rounded-md border bg-surface px-3.5 py-3 pr-10',
            'text-body text-ink transition-colors outline-none',
            'focus-visible:border-liquid focus-visible:ring-1 focus-visible:ring-liquid',
            'disabled:text-ink-3',
            error ? 'border-caution' : 'border-line-strong hover:border-ink-4',
            className,
          )}
          {...rest}
        >
          {isEmpty ? (
            <option value="">{emptyLabel}</option>
          ) : (
            <>
              {placeholder && (
                <option value="" disabled>
                  {placeholder}
                </option>
              )}
              {groupList.length > 0
                ? groupList.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map(renderOption)}
                    </optgroup>
                  ))
                : flatList.map(renderOption)}
            </>
          )}
        </select>

        <Chevron />
      </div>

      {message && (
        <p
          id={messageId}
          {...(error ? { role: 'alert' as const } : {})}
          className={clsx('text-caption', error ? 'text-caution' : 'text-ink-3')}
        >
          {message}
        </p>
      )}
    </div>
  );
});

function Chevron(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none absolute right-3.5 text-ink-3"
    >
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
