/* ===========================================================================
 * REGULAR PAYMENTS IN AND OUT
 * ---------------------------------------------------------------------------
 * The bills someone already knows about, and when their money next arrives.
 * Without these, "safe to spend" would just be the account balance — which is
 * exactly the backward-looking number the whole product exists to replace.
 * ======================================================================== */

import { asc, eq, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import { addDays } from '@/core/liquidity';
import { db, runBatch } from '../client';
import { scheduledItems } from '../schema/tables';

export type Cadence = 'weekly' | 'fortnightly' | 'monthly' | 'yearly';

export interface ScheduledItem {
  id: string;
  kind: 'bill' | 'income';
  /** As the person would say it: "Rent", "Phone", "Pay from work". */
  name: string;
  amount: Minor;
  nextDue: string;
  cadence: Cadence;
  accountId: AccountId | null;
  categoryId: AccountId | null;
  active: boolean;
}

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
  yearly: 'Once a year',
};

type Row = typeof scheduledItems.$inferSelect;

function toItem(row: Row): ScheduledItem {
  return {
    id: row.id,
    kind: row.kind as ScheduledItem['kind'],
    name: row.name,
    amount: minor(row.amount),
    nextDue: row.nextDue,
    cadence: row.cadence as Cadence,
    accountId: (row.accountId as AccountId | null) ?? null,
    categoryId: (row.categoryId as AccountId | null) ?? null,
    active: row.active === 1,
  };
}

export async function listScheduled(): Promise<ScheduledItem[]> {
  const rows = await db
    .select()
    .from(scheduledItems)
    .where(eq(scheduledItems.active, 1))
    .orderBy(asc(scheduledItems.nextDue));
  return rows.map(toItem);
}

export async function saveScheduled(item: ScheduledItem): Promise<void> {
  const statement = db
    .insert(scheduledItems)
    .values({
      id: item.id,
      kind: item.kind,
      name: item.name,
      amount: item.amount,
      nextDue: item.nextDue,
      cadence: item.cadence,
      accountId: item.accountId,
      categoryId: item.categoryId,
      active: item.active ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: scheduledItems.id,
      set: {
        name: item.name,
        amount: item.amount,
        nextDue: item.nextDue,
        cadence: item.cadence,
        active: item.active ? 1 : 0,
      },
    })
    .toSQL();

  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

export async function removeScheduled(id: string): Promise<void> {
  const statement = db
    .update(scheduledItems)
    .set({ active: 0 })
    .where(eq(scheduledItems.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

export async function countScheduled(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(scheduledItems)
    .where(eq(scheduledItems.active, 1));
  return Number(row?.n ?? 0);
}

/* --- what falls inside a window ------------------------------------------ */

/**
 * Every time this item comes due between today and the horizon.
 *
 * A weekly bill inside a 30-day window is four or five payments, not one, and
 * treating it as one would quietly overstate what is safe to spend.
 */
export function occurrencesWithin(
  item: ScheduledItem,
  from: string,
  to: string,
): { date: string; amount: Minor }[] {
  const stepDays: Record<Cadence, number> = {
    weekly: 7,
    fortnightly: 14,
    monthly: 0, // handled by calendar month arithmetic below
    yearly: 0,
  };

  const dates: string[] = [];
  let cursor = item.nextDue;

  // A hard stop, so a bad cadence can never spin forever.
  for (let guard = 0; guard < 400 && cursor <= to; guard++) {
    if (cursor >= from) dates.push(cursor);

    if (item.cadence === 'monthly') cursor = addCalendarMonths(cursor, 1);
    else if (item.cadence === 'yearly') cursor = addCalendarMonths(cursor, 12);
    else cursor = addDays(cursor, stepDays[item.cadence]);
  }

  return dates.map((date) => ({ date, amount: item.amount }));
}

/** Keeps the day of the month, clamping where the next month is shorter. */
function addCalendarMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(year ?? 1970, (month ?? 1) - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day ?? 1, lastDay));
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const SCHEDULE_TABLES = ['scheduled_items'] as const;
