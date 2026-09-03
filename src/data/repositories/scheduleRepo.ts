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
import { CADENCE_LABELS, occurrencesWithin, type Cadence } from '@/core/recurring';
import { db, runBatch } from '../client';
import { scheduledItems } from '../schema/tables';

// The dates themselves are worked out in core, where they can be tested
// exhaustively without a database. This module only stores and fetches.
export { CADENCE_LABELS, occurrencesWithin };
export type { Cadence };

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
  /** What it is supposed to cost. Price-creep is measured against this. */
  expectedAmount: Minor;
  /** What it last actually cost, and when it last arrived. */
  lastAmount: Minor | null;
  lastBilledDate: string | null;
  /** Set when the person has said a quiet subscription is fine as it is. */
  dormantAlertDismissedAt: string | null;
}

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
    // An older row migrated in with no baseline falls back to the scheduled
    // amount, which is what it always meant.
    expectedAmount: minor(row.expectedAmount || row.amount),
    lastAmount: row.lastAmount === null ? null : minor(row.lastAmount),
    lastBilledDate: row.lastBilledDate,
    dormantAlertDismissedAt: row.dormantAlertDismissedAt,
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
      expectedAmount: item.expectedAmount || item.amount,
      lastAmount: item.lastAmount,
      lastBilledDate: item.lastBilledDate,
      dormantAlertDismissedAt: item.dormantAlertDismissedAt,
    })
    .onConflictDoUpdate({
      target: scheduledItems.id,
      set: {
        name: item.name,
        amount: item.amount,
        nextDue: item.nextDue,
        cadence: item.cadence,
        accountId: item.accountId,
        categoryId: item.categoryId,
        active: item.active ? 1 : 0,
        expectedAmount: item.expectedAmount || item.amount,
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

/* --- surveillance bookkeeping --------------------------------------------- */

/** Accept a new price as the baseline this bill is measured against. */
export async function updateExpectedAmount(id: string, amount: Minor): Promise<void> {
  const statement = db
    .update(scheduledItems)
    .set({ expectedAmount: amount, amount })
    .where(eq(scheduledItems.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/**
 * Note what a bill actually cost this time without moving the baseline.
 *
 * "Treat as a one-off" has to record something, or the same charge is flagged
 * again on the next import and the dismissal means nothing.
 */
export async function recordActualCharge(
  id: string,
  amount: Minor,
  date: string,
): Promise<void> {
  const statement = db
    .update(scheduledItems)
    .set({ lastAmount: amount, lastBilledDate: date })
    .where(eq(scheduledItems.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Stop asking about a subscription the person has said is fine. */
export async function dismissDormantAlert(id: string): Promise<void> {
  const statement = db
    .update(scheduledItems)
    .set({ dormantAlertDismissedAt: new Date().toISOString() })
    .where(eq(scheduledItems.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

export const SCHEDULE_TABLES = ['scheduled_items'] as const;
