/* ===========================================================================
 * WHEN THINGS COME DUE
 * ---------------------------------------------------------------------------
 * Every recurring bill and every payday, expanded into actual dates.
 *
 * The whole file exists because calendars are not arithmetic. A bill on the
 * 31st has no 31st to land on in February, a fortnightly payday drifts through
 * the month while a monthly one does not, and a payroll on "the 15th and the
 * last day" is two different gaps that both call themselves half a month.
 *
 * The rule that keeps all of it honest: every occurrence is computed from the
 * *original* anchor date, never from the previous occurrence. Stepping forward
 * from what was last produced is how a bill on the 31st clamps to the 28th in
 * February and then stays on the 28th forever — the drift is silent, it only
 * costs a few days a year, and it quietly moves money between months.
 * ======================================================================== */

import type { Minor } from '@/core/money';

export type Cadence =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'quarterly'
  | 'annual';

/** How each cadence reads in a sentence. */
export const CADENCE_LABELS: Record<Cadence, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  semimonthly: 'Twice a month',
  monthly: 'Every month',
  quarterly: 'Every three months',
  annual: 'Once a year',
};

/** The least an item needs for its dates to be worked out. */
export interface RecurringItem {
  nextDue: string;
  cadence: Cadence;
  amount: Minor;
}

export interface Occurrence {
  date: string;
  amount: Minor;
}

/* --- calendar arithmetic, without a Date object where it can be avoided --- */

export function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the following month is the last day of this one, and this is the
  // one place the leap-year rule is decided. February gets 29 in 2028 because
  // the platform says so, not because we counted.
  return new Date(year, month1to12, 0).getDate();
}

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const { year, month, day } = parts(iso);
  const date = new Date(year, month - 1, day + days);
  return toIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * The nth month after an anchor, with the anchor's day clamped to fit.
 *
 * Clamping from the anchor rather than from the previous result is the whole
 * point: the 31st becomes the 30th in April and the 31st again in May, and a
 * 29 February anchor comes back every leap year instead of settling on the
 * 28th for good.
 */
export function monthsAfter(anchorIso: string, months: number): string {
  const anchor = parts(anchorIso);
  const zeroBased = anchor.month - 1 + months;
  const year = anchor.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return toIso(year, month, Math.min(anchor.day, daysInMonth(year, month)));
}

/**
 * The two days a twice-monthly schedule falls on.
 *
 * Both common payroll conventions are named outright rather than approximated,
 * because "semi-monthly" means one of two specific things to the people paid
 * that way and neither is "every fifteen days":
 *
 *   · anchored on the 1st  — the 1st and the 15th
 *   · anchored on the 15th — the 15th and the last day of the month
 *
 * Anything else is treated as the anchor day and a fortnight later, clamped
 * into the month, which is the sensible reading of an unusual choice.
 */
export function semiMonthlyDays(anchorDay: number, year: number, month: number): number[] {
  const last = daysInMonth(year, month);
  if (anchorDay === 1) return [1, 15];
  if (anchorDay === 15) return [15, last];
  const second = Math.min(anchorDay + 15, last);
  return anchorDay === second ? [anchorDay] : [anchorDay, second];
}

/* --- the generator -------------------------------------------------------- */

/** A hard stop, so a bad cadence can never spin forever. */
const MAX_OCCURRENCES = 2000;

/**
 * Every time this item comes due between two dates, inclusive.
 *
 * A weekly bill inside a 30-day window is four or five payments, not one, and
 * treating it as one would quietly overstate what is safe to spend.
 */
export function occurrencesWithin(
  item: RecurringItem,
  from: string,
  to: string,
): Occurrence[] {
  if (to < from) return [];
  const dates: string[] = [];

  if (item.cadence === 'semimonthly') {
    const anchor = parts(item.nextDue);
    // Walk months from the anchor's month, emitting both days of each.
    for (let step = 0; step < MAX_OCCURRENCES; step++) {
      const monthStart = monthsAfter(toIso(anchor.year, anchor.month, 1), step);
      const { year, month } = parts(monthStart);
      if (toIso(year, month, 1) > to) break;

      for (const day of semiMonthlyDays(anchor.day, year, month)) {
        const date = toIso(year, month, day);
        // Never before the schedule itself begins.
        if (date < item.nextDue) continue;
        if (date > to) break;
        if (date >= from) dates.push(date);
      }
    }
    return dates.map((date) => ({ date, amount: item.amount }));
  }

  const stepDays: Partial<Record<Cadence, number>> = { daily: 1, weekly: 7, biweekly: 14 };
  const stepMonths: Partial<Record<Cadence, number>> = { monthly: 1, quarterly: 3, annual: 12 };

  for (let step = 0; step < MAX_OCCURRENCES; step++) {
    const byDays = stepDays[item.cadence];
    const date =
      byDays !== undefined
        ? addDays(item.nextDue, byDays * step)
        : monthsAfter(item.nextDue, (stepMonths[item.cadence] ?? 1) * step);

    if (date > to) break;
    if (date >= from) dates.push(date);
  }

  return dates.map((date) => ({ date, amount: item.amount }));
}

/** How a schedule reads to somebody looking at it. */
export function describeSchedule(cadence: Cadence, nextDue: string): string {
  const { day, year, month } = parts(nextDue);

  if (cadence === 'semimonthly') {
    const days = semiMonthlyDays(day, year, month);
    if (day === 15) return 'Billed on the 15th and the last day of every month.';
    if (day === 1) return 'Billed on the 1st and the 15th of every month.';
    return `Billed on the ${ordinal(days[0] ?? day)} and the ${ordinal(days[1] ?? day)} of every month.`;
  }

  if (cadence === 'monthly') {
    return day > 28
      ? `Billed on the ${ordinal(day)} of every month, or the last day in a shorter month.`
      : `Billed on the ${ordinal(day)} of every month.`;
  }

  return `${CADENCE_LABELS[cadence]}, starting ${nextDue}.`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
