/* ===========================================================================
 * A MONTH OF MONEY, DAY BY DAY
 * ---------------------------------------------------------------------------
 * Expands the schedule into a grid, and works out what each day does to the
 * balance. The running total is the part worth having: knowing a bill is on
 * the 28th is much less useful than knowing what is left after it.
 * ======================================================================== */

import { useCallback, useMemo } from 'react';
import { minor, type Minor } from '@/core/money';
import { occurrencesWithin, type Cadence } from '@/core/recurring';
import { toIsoDate } from '@/core/liquidity';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import {
  SCHEDULE_TABLES,
  listScheduled,
  type ScheduledItem,
} from '@/data/repositories/scheduleRepo';

export interface DayEvent {
  itemId: string;
  name: string;
  kind: 'bill' | 'income';
  amount: Minor;
  cadence: Cadence;
  accountId: string | null;
  categoryId: string | null;
}

export interface CalendarDay {
  date: string;
  /** Day of the month. */
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  events: DayEvent[];
  /** Money in less money out, for this day alone. */
  net: Minor;
  moneyIn: Minor;
  moneyOut: Minor;
}

export interface CalendarMonth {
  /** First day of the month being shown. */
  anchor: string;
  label: string;
  /** Always six rows of seven, so the grid never changes height. */
  weeks: CalendarDay[][];
  totalIn: Minor;
  totalOut: Minor;
}

function parts(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Move the anchor by whole months, always landing on the 1st. */
export function shiftMonth(anchorIso: string, months: number): string {
  const { year, month } = parts(anchorIso);
  const zeroBased = month - 1 + months;
  return iso(year + Math.floor(zeroBased / 12), (((zeroBased % 12) + 12) % 12) + 1, 1);
}

export function monthLabel(anchorIso: string, locale: string): string {
  const { year, month } = parts(anchorIso);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1),
  );
}

/** Weekday initials in the viewer's locale, starting on Monday. */
export function weekdayInitials(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2026-01-05 is a Monday.
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(2026, 0, 5 + i)).slice(0, 2),
  );
}

/**
 * Build the six-week grid for a month.
 *
 * Always six rows: a month that fits in five would otherwise make the whole
 * page jump in height as you page through the year.
 */
export function buildMonth(
  anchorIso: string,
  items: readonly ScheduledItem[],
  today: string,
  locale: string,
): CalendarMonth {
  const { year, month } = parts(anchorIso);

  // Monday-first offset for the 1st of the month.
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - firstWeekday);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateIso = toIsoDate(date);
    days.push({
      date: dateIso,
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1,
      isToday: dateIso === today,
      isPast: dateIso < today,
      events: [],
      net: minor(0),
      moneyIn: minor(0),
      moneyOut: minor(0),
    });
  }

  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;
  const byDate = new Map(days.map((d) => [d.date, d]));

  for (const item of items) {
    if (!item.active) continue;
    for (const occurrence of occurrencesWithin(item, from, to)) {
      const cell = byDate.get(occurrence.date);
      if (!cell) continue;
      cell.events.push({
        itemId: item.id,
        name: item.name,
        kind: item.kind,
        amount: occurrence.amount,
        cadence: item.cadence,
        accountId: item.accountId,
        categoryId: item.categoryId,
      });
    }
  }

  let totalIn = 0;
  let totalOut = 0;
  for (const cell of days) {
    let inAmount = 0;
    let outAmount = 0;
    for (const event of cell.events) {
      if (event.kind === 'income') inAmount += event.amount;
      else outAmount += event.amount;
    }
    cell.moneyIn = minor(inAmount);
    cell.moneyOut = minor(outAmount);
    cell.net = minor(inAmount - outAmount);
    if (cell.inMonth) {
      totalIn += inAmount;
      totalOut += outAmount;
    }
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < 42; i += 7) weeks.push(days.slice(i, i + 7));

  return {
    anchor: iso(year, month, 1),
    label: monthLabel(anchorIso, locale),
    weeks,
    totalIn: minor(totalIn),
    totalOut: minor(totalOut),
  };
}

/** The scheduled items, live. */
export function useScheduledItems() {
  return useLiveQuery(useCallback(() => listScheduled(), []), SCHEDULE_TABLES);
}

/** The grid for one month, rebuilt whenever the schedule changes. */
export function useCalendarMonth(anchorIso: string, locale: string) {
  const items = useScheduledItems();
  const today = toIsoDate(new Date());

  return useMemo(
    () => ({
      month: buildMonth(anchorIso, items.data ?? [], today, locale),
      loading: items.data === undefined,
    }),
    [anchorIso, items.data, today, locale],
  );
}
