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
