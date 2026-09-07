/* ===========================================================================
 * THE PIECES EVERY FIRST-FLIGHT STEP IS BUILT FROM
 * ---------------------------------------------------------------------------
 * Kept apart from both the shell and the steps so neither has to import the
 * other. Nothing here knows anything about money, or about which step it is
 * being used on.
 * ======================================================================== */

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { fromDecimalString, type Minor } from '@/core/money';

/** A step's heading, its one explanatory line, and its body. */
export function StepFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 className="text-balance text-figure font-medium leading-tight text-ink">{title}</h2>
        <p className="max-w-[42ch] text-body text-ink-2">{lede}</p>
      </header>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

/** The plain text box used throughout. A real `input`, so keyboards behave. */
export function TextBox({
  value,
  onChange,
  placeholder,
  inputMode,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'decimal';
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      inputMode={inputMode ?? 'text'}
      autoFocus={autoFocus ?? false}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder ?? ''}
      className={clsx(
        'w-full rounded-md border border-line bg-raised px-3.5 py-3',
        'text-body text-ink placeholder:text-ink-3',
        'focus:border-line-strong focus:outline-none',
      )}
    />
  );
}

/**
 * An amount, typed rather than tapped.
 *
 * The keypad is the right thing on the spending sheet, where one figure is the
 * whole point of the screen. Here there are four or five amounts to get
 * through, and a keypad for each would turn a five-minute setup into a chore.
 *
 * Parsing is `fromDecimalString`, which is the same function the importer uses
 * and takes grouping and either separator. It refuses rather than rounds, so
 * "12.345" is rejected instead of quietly becoming twelve thirty-five.
 */
export function MoneyBox({
  value,
  onChange,
  exponent,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (typed: string) => void;
  exponent: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const problem = readAmount(value, exponent) === null && value.trim() !== '';

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="text"
        value={value}
        inputMode="decimal"
        autoFocus={autoFocus ?? false}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? '0.00'}
        aria-invalid={problem}
        className={clsx(
          'tnum w-full rounded-md border bg-raised px-3.5 py-3',
          'text-body text-ink placeholder:text-ink-3 focus:outline-none',
          problem ? 'border-caution-dim' : 'border-line focus:border-line-strong',
        )}
      />
      {problem && (
        <span className="text-caption text-caution" role="alert">
          That is not an amount Sovereign can read. Digits, and at most{' '}
          {exponent === 0 ? 'no' : exponent} decimal places.
        </span>
      )}
    </div>
  );
}

/** What was typed, in minor units, or null if it is not yet an amount. */
export function readAmount(typed: string, exponent: number): Minor | null {
  if (typed.trim() === '') return null;
  try {
    const parsed = fromDecimalString(typed, exponent);
    return parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** One of a set of mutually exclusive answers. */
export function Choice({
  selected,
  onClick,
  title,
  detail,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'flex w-full flex-col gap-0.5 rounded-md border px-3.5 py-3 text-left transition-colors',
        selected
          ? 'border-liquid-dim bg-liquid-wash'
          : 'border-line bg-raised hover:border-line-strong',
      )}
    >
      <span className={clsx('text-body', selected ? 'text-liquid' : 'text-ink')}>{title}</span>
      {detail && <span className="text-caption text-ink-3">{detail}</span>}
    </button>
  );
}

/**
 * What this step has put into the ledger so far.
 *
 * Every step writes as it goes rather than saving everything at the end, so
 * this is a list of things that genuinely exist. That is why it is worth
 * showing: it is the evidence that closing the wizard now would lose nothing.
 */
export function AddedList({
  items,
  empty,
}: {
  items: { id: string; name: string; detail: string }[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-caption text-ink-3">{empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-baseline justify-between gap-3 rounded-md border border-line-faint bg-surface px-3.5 py-2.5"
        >
          <span className="min-w-0 truncate text-body text-ink">{item.name}</span>
          <span className="tnum shrink-0 text-caption text-ink-2">{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** A quiet aside. Used for the one thing a step wants understood, not obeyed. */
export function Aside({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-line-faint bg-surface px-3.5 py-3 text-caption text-ink-2">
      {children}
    </p>
  );
}

/** A line item in the worked example on the last step. */
export function Term({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'taken' | 'answer';
  note?: string;
}) {
  const answer = tone === 'answer';
  return (
    <div
      className={clsx(
        'flex items-baseline justify-between gap-3 py-2',
        answer && 'border-t border-line-strong pt-3',
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className={clsx('text-body', answer ? 'font-medium text-ink' : 'text-ink-2')}>
          {label}
        </span>
        {note && <span className="text-caption text-ink-3">{note}</span>}
      </div>
      <span
        className={clsx(
          'tnum shrink-0',
          answer ? 'text-figure font-medium text-liquid' : 'text-body',
          tone === 'taken' && 'text-ink-3',
          tone === 'plain' && 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
