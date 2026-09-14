/* ===========================================================================
 * THE PIECES A CHAPTER IS BUILT FROM
 * ---------------------------------------------------------------------------
 * Two kinds of thing, and the difference between them is the whole point of
 * the manual.
 *
 * Prose: `Passage`, `Aside`, `Formula`. Words, set for reading — a longer
 * measure and more air than anywhere else in the app, because this is the one
 * screen somebody is on to understand rather than to act.
 *
 * Labs: `Lab`, `Dial`, `Switch`, `Readout`, `Ledger`. A working model of one
 * engine, wired to controls. Every one of them runs the real function — the
 * same `calculateSafeToSpend`, the same `relieveLotsFIFO` — on figures that
 * are openly made up. That combination is deliberate: a diagram of how
 * something works can quietly stop being true, and an explanation drawn from
 * somebody's own money would let them act on a number that was never theirs.
 *
 * `Lab` says so on its face, every time, without apology or small print.
 * ======================================================================== */

import { useId, type ReactNode } from 'react';
import clsx from 'clsx';
/*
 * Deep import on purpose, and the barrel's own header explains why it has to
 * be one: the registry is kept out of `@/content/explain` so that rendering a
 * 22px information button on a first-paint screen does not drag every
 * explanation in behind it.
 *
 * The manual is the opposite case. It is lazily loaded and quarantined from
 * the opening bundle, and its whole subject is the prose, so it can have the
 * registry synchronously without costing first paint anything. `ManualView` is
 * verified absent from the opening chunk in the manual's own test.
 */
import { EXPLANATIONS } from '@/content/explain/registry';
import type { ChapterSlug } from './chapters/slugs';

/* --- prose --------------------------------------------------------------- */

/**
 * The line a chapter opens with, taken from its own `Explain` entry.
 *
 * Not a copy of it. The brief asks that the short answer on a screen and the
 * first line of the long one never drift, and the only way to be sure of that
 * is for there to be one string. This renders
 * `EXPLANATIONS[slug].short` directly, so the two cannot disagree even in
 * principle.
 *
 * Every chapter slug is also an explanation id — `safe-to-spend`, `two-books`,
 * `pots`, `cards`, `selling`, `checking` — which is what makes the lookup
 * possible from the address the chapter already has. `chapterShortLines` in
 * the manual's test asserts that stays true.
 *
 * Set larger than a `Passage` and in the darker ink: it is the answer, and
 * everything under it is the working.
 */
export function Standfirst({ slug }: { slug: ChapterSlug }) {
  return (
    <p className="measure text-lead leading-relaxed text-ink">
      {EXPLANATIONS[slug].short}
    </p>
  );
}

/** A paragraph of the chapter. Set at a reading measure, not a UI one. */
export function Passage({ children }: { children: ReactNode }) {
  return <p className="measure text-body leading-relaxed text-ink-2">{children}</p>;
}

/** A heading inside a chapter. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="measure text-balance pt-2 text-lead font-medium text-ink">{children}</h3>
  );
}

/** Something worth pausing on. Used sparingly — one or two a chapter. */
export function Aside({ children }: { children: ReactNode }) {
  return (
    <div className="measure border-l-2 border-liquid-dim bg-liquid-wash/40 px-4 py-3">
      <p className="text-body leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

/**
 * The arithmetic, written out.
 *
 * Monospaced and centred, because the whole reason it is here is that the
 * shape of the sum is easier to hold than the sentence describing it.
 */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-sunken px-4 py-3.5">
      <code className="block whitespace-pre text-caption leading-relaxed text-ink-2">
        {children}
      </code>
    </div>
  );
}

/** A list where each item is a claim, not a step. */
export function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex measure flex-col gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-body leading-relaxed text-ink-2">
          {/* A drawn rule rather than a dash character: it sits on the optical
              baseline at any size, and it keeps the one glyph this app has no
              other use for out of the running text. */}
          <span
            aria-hidden="true"
            className="mt-[0.72em] h-px w-3 shrink-0 rounded-full bg-liquid-dim"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* --- labs ---------------------------------------------------------------- */

/**
 * A working model of one engine.
 *
 * The border and the standing line at the top are the contract: everything
 * inside is real code running on invented figures. Somebody who takes a number
 * out of here and applies it to their own money has been misled, and the only
 * defence against that is saying so plainly, every time, where it cannot be
 * scrolled past.
 */
export function Lab({
  title,
  engine,
  children,
}: {
  title: string;
  /** The module this lab is actually running, named for anyone curious. */
  engine: string;
  children: ReactNode;
}) {
  return (
    <section className="demo overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-dashed border-[var(--tile-ink)] px-4 py-3">
        <h4 className="text-body font-medium text-ink">{title}</h4>
        <span className="font-mono text-micro text-[var(--tile-ink)]">{engine}</span>
      </header>
      <div className="flex flex-col gap-5 p-4">{children}</div>
      <p className="px-4 pb-3 text-caption text-ink-3">
        Made-up figures. Nothing here touches your records.
      </p>
    </section>
  );
}

/** A row of controls inside a lab. */
export function Controls({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

/**
 * A number somebody can drag.
 *
 * A range input rather than a text box: the point of a lab is watching one
 * figure move as another one does, and that only happens if changing it costs
 * nothing.
 */
export function Dial({
  label,
  value,
  onChange,
  min,
  max,
  step,
  display,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** How the current value reads. Already formatted. */
  display: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-caption text-ink-2">
          {label}
        </label>
        <span className="tnum text-body font-medium text-ink">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 w-full accent-[var(--color-liquid)]"
      />
    </div>
  );
}

/** A small set of mutually exclusive choices, laid out along one line. */
export function Switch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-ink-2">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={clsx(
              'rounded-md border px-3 py-2 text-caption transition-colors',
              value === option.value
                ? 'border-liquid-dim bg-liquid-wash text-liquid'
                : 'border-line bg-raised text-ink-2 [@media(hover:hover)]:hover:border-line-strong',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the engine said, given what the controls are set to. */
export function Readout({
  lines,
  answer,
}: {
  lines: { label: string; value: string; note?: string; tone?: 'plain' | 'taken' }[];
  answer: { label: string; value: string; tone?: 'liquid' | 'deficit' | 'ink' };
}) {
  return (
    <div className="rounded-md border border-line bg-sunken px-3.5 py-1">
      {lines.map((line) => (
        <div
          key={line.label}
          className="flex items-baseline justify-between gap-3 border-b border-line-faint py-2 last:border-b-0"
        >
          <div className="flex min-w-0 flex-col">
            <span className="text-caption text-ink-2">{line.label}</span>
            {line.note && <span className="text-micro text-ink-3">{line.note}</span>}
          </div>
          <span
            className={clsx(
              'tnum shrink-0 text-body',
              line.tone === 'taken' ? 'text-ink-3' : 'text-ink',
            )}
          >
            {line.value}
          </span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 border-t border-line-strong py-3">
        <span className="text-body font-medium text-ink">{answer.label}</span>
        <span
          className={clsx(
            'tnum shrink-0 text-figure font-medium',
            answer.tone === 'deficit'
              ? 'text-deficit'
              : answer.tone === 'ink'
                ? 'text-ink'
                : 'text-liquid',
          )}
        >
          {answer.value}
        </span>
      </div>
    </div>
  );
}

/**
 * A journal entry, shown as the two books it actually is.
 *
 * Debits positive, credits negative, and each book's own total printed
 * underneath — because "both books balance" is a claim the reader should be
 * able to check by adding up the column themselves rather than take on trust.
 */
export function Ledger({
  books,
}: {
  books: {
    book: string;
    rows: { account: string; amount: string; debit: boolean }[];
    total: string;
    balanced: boolean;
  }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {books.map((book) => (
        <div key={book.book} className="overflow-hidden rounded-md border border-line">
          <div className="border-b border-line bg-raised px-3 py-2">
            <span className="text-caption text-ink-2">
              {book.book}
            </span>
          </div>
          <table className="w-full">
            <tbody>
              {book.rows.map((row, index) => (
                <tr key={index} className="border-b border-line-faint last:border-b-0">
                  <td className="px-3 py-2 text-caption text-ink-2">{row.account}</td>
                  <td
                    className={clsx(
                      'tnum whitespace-nowrap px-3 py-2 text-right text-caption',
                      row.debit ? 'text-ink' : 'text-liquid',
                    )}
                  >
                    {row.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-baseline justify-between gap-2 border-t border-line-strong bg-sunken px-3 py-2">
            <span className="text-caption text-ink-3">Adds up to</span>
            <span
              className={clsx(
                'tnum text-caption font-medium',
                book.balanced ? 'text-liquid' : 'text-deficit',
              )}
            >
              {book.total}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A sentence the engine itself produced, quoted back as evidence. */
export function EngineSays({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-line-faint bg-raised px-3.5 py-3 text-body text-ink">
      {children}
    </p>
  );
}
