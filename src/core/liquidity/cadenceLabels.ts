/* ===========================================================================
 * NAVIGATING AND NAMING CYCLES
 * ---------------------------------------------------------------------------
 * Separate from `period.ts` for one reason: only the budget grid steps between
 * periods or writes their names on a heading, and the grid is lazily loaded.
 * Leaving these beside `paycheckCycle` — which the home screen does need —
 * would drag `Intl.DateTimeFormat` wiring into the first paint to no purpose.
 * ======================================================================== */

import { addDays, fromIsoDate, monthCycle, paycheckCycle, type BudgetCadence, type Cycle } from './period';

/** How each cadence reads in a sentence. */
export const CADENCE_DESCRIPTIONS: Record<BudgetCadence, string> = {
  calendar_month: 'Calendar months, from the 1st to the end of each month.',
  weekly: 'A week at a time, starting from the day you are paid.',
  biweekly: 'A fortnight at a time, starting from the day you are paid.',
  semimonthly: 'Twice a month, on the two days you are paid.',
};

/**
 * A stable key for a cycle, used to group allocations.
 *
 * Calendar months key as 'YYYY-MM' so they read the way people say them;
 * everything else keys on its start date, because two fortnights inside one
 * month need to be told apart.
 */
export function cycleKey(cycle: Cycle, cadence: BudgetCadence): string {
  return cadence === 'calendar_month' ? cycle.start.slice(0, 7) : cycle.start;
}

/** Step a whole cycle forwards or backwards. */
export function shiftCycle(
  cycle: Cycle,
  cadence: BudgetCadence,
  anchorDate: string,
  by: number,
): Cycle {
  if (cadence === 'calendar_month') {
    const [y, m] = cycle.start.split('-').map(Number);
    const zero = (m ?? 1) - 1 + by;
    const year = (y ?? 1970) + Math.floor(zero / 12);
    const month = ((zero % 12) + 12) % 12 + 1;
    return monthCycle(`${year}-${String(month).padStart(2, '0')}-01`);
  }

  if (cadence === 'weekly' || cadence === 'biweekly') {
    const step = cadence === 'weekly' ? 7 : 14;
    return paycheckCycle(anchorDate, cadence, addDays(cycle.start, by * step));
  }

  // Semi-monthly steps are uneven, so walk them one at a time.
  let current = cycle;
  for (let i = 0; i < Math.abs(by); i++) {
    current =
      by > 0
        ? paycheckCycle(anchorDate, cadence, addDays(current.end, 1))
        : paycheckCycle(anchorDate, cadence, addDays(current.start, -1));
  }
  return current;
}

/** How a cycle reads as a heading. */
export function describeCycle(cycle: Cycle, cadence: BudgetCadence, locale: string): string {
  if (cadence === 'calendar_month') {
    const [y, m] = cycle.start.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
      new Date(y ?? 1970, (m ?? 1) - 1, 1),
    );
  }
  const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return `${short.format(fromIsoDate(cycle.start))} – ${short.format(fromIsoDate(cycle.end))}`;
}
