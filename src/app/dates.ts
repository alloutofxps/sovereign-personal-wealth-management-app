/* ===========================================================================
 * DATES, THE WAY PEOPLE SAY THEM
 * ---------------------------------------------------------------------------
 * Nobody reads "2026-09-02" and thinks "today". Recent dates get the word a
 * person would use; older ones get a real date in their own locale.
 * ======================================================================== */

const MS_PER_DAY = 86_400_000;

/** Midnight local time, so "today" means the calendar day, not 24 hours. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  // Built as a local date, not UTC, or a morning in a negative offset shifts
  // to the day before.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * 'Today', 'Yesterday', a weekday within the last week, otherwise a date.
 * @param now injectable so this is testable without mocking the clock.
 */
export function describeDate(iso: string, locale: string, now: Date = new Date()): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;

  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / MS_PER_DAY);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * The same date, but fit to sit inside a sentence.
 *
 * `describeDate` returns a label — "Today", "Monday", "15 January" — which is
 * right above an amount and wrong after a verb, because "locked on Today" is
 * not a sentence anybody would say. This adds the preposition where one
 * belongs and leaves it out where it does not, so the caller never has to
 * guess which kind of answer it got.
 */
export function describeWhen(iso: string, locale: string, now: Date = new Date()): string {
  const label = describeDate(iso, locale, now);
  if (label === 'Today') return 'today';
  if (label === 'Yesterday') return 'yesterday';
  if (label === 'Tomorrow') return 'tomorrow';
  return `on ${label}`;
}

/** A compact date for chart axes and dense lists: "1 Sep". */
export function shortDate(iso: string, locale: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}
