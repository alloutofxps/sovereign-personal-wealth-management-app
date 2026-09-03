/* ===========================================================================
 * WHAT THE SUBSCRIPTION AUDIT KNOWS
 * ---------------------------------------------------------------------------
 * Joins the pure detectors in core to the journal on the device. Nothing here
 * decides anything — it gathers the history, hands it over, and passes back
 * whatever came out.
 * ======================================================================== */

import { useCallback } from 'react';
import { minor } from '@/core/money';
import { normaliseMerchant } from '@/core/taxonomy/merchantMemory';
import {
  detectDormantSubscriptions,
  detectPriceCreep,
  inferRecurringCandidates,
  worthMentioning,
  type DormantCandidate,
  type PriceChange,
  type RecurringCandidate,
} from '@/core/recurring';
import { toIsoDate } from '@/core/liquidity';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import { db } from '@/data/client';
import { sql } from 'drizzle-orm';
import {
  SCHEDULE_TABLES,
  listScheduled,
  type ScheduledItem,
} from '@/data/repositories/scheduleRepo';

export interface SubscriptionAudit {
  dormant: DormantCandidate[];
  candidates: RecurringCandidate[];
  /** Anything already noticed as costing more than it should. */
  priceChanges: PriceChange[];
}

/** How many times a year each cadence bills, for annualising a rise. */
export function timesPerYear(item: ScheduledItem): number {
  switch (item.cadence) {
    case 'daily':
      return 365;
    case 'weekly':
      return 52;
    case 'biweekly':
      return 26;
    case 'semimonthly':
      return 24;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'annual':
      return 1;
  }
}

interface HistoryRow {
  0: string;
  1: string;
  2: number;
}

/**
 * Everything the detectors need, in two reads.
 *
 * The spend history is fetched once and reused by both the dormancy check and
 * the candidate scan, rather than each going to the database for its own copy
 * of the same rows.
 */
async function runAudit(): Promise<SubscriptionAudit> {
  const items = await listScheduled();
  const today = toIsoDate(new Date());

  const rows = (await db.all(
    sql`SELECT e.description, e.date, p.amount
          FROM entries e
          JOIN postings p ON p.entry_id = e.id
          JOIN accounts a ON a.id = p.account_id
         WHERE p.book = 'FINANCIAL' AND p.amount > 0 AND a.type = 'EXPENSE'
           AND e.kind IN ('SPEND', 'SPEND_SPLIT')
         ORDER BY e.date DESC
         LIMIT 600`,
  )) as unknown as HistoryRow[];

  const payments = rows.map((row) => ({
    merchant: normaliseMerchant(String(row[0] ?? '')),
    date: String(row[1] ?? ''),
    amount: minor(Number(row[2] ?? 0)),
  }));

  // The last time anything was recorded against each category.
  const lastByCategory = new Map<string, string>();
  const categoryRows = (await db.all(
    sql`SELECT p.account_id, MAX(e.date)
          FROM entries e
          JOIN postings p ON p.entry_id = e.id
         WHERE p.book = 'FINANCIAL' AND p.amount > 0
         GROUP BY p.account_id`,
  )) as unknown as { 0: string; 1: string }[];
  for (const row of categoryRows) lastByCategory.set(String(row[0]), String(row[1]));

  const dormant = detectDormantSubscriptions(
    items
      .filter((item) => item.kind === 'bill' && item.active)
      .map((item) => ({
        id: item.id,
        name: item.name,
        expectedAmount: item.expectedAmount,
        amount: item.amount,
        timesPerYear: timesPerYear(item),
      })),
    items.map((item) => ({
      itemId: item.id,
      lastActivity: item.categoryId ? (lastByCategory.get(item.categoryId) ?? null) : null,
      dismissedAt: item.dormantAlertDismissedAt,
    })),
    today,
  );

  const candidates = inferRecurringCandidates(
    payments,
    items.map((item) => normaliseMerchant(item.name)),
    today,
  );

  // A rise already recorded against a bill, still standing against its
  // baseline. Only what is worth mentioning survives.
  const priceChanges = items
    .filter((item) => item.lastAmount !== null)
    .map((item) =>
      detectPriceCreep(
        { id: item.id, name: item.name, expectedAmount: item.expectedAmount },
        item.lastAmount!,
        timesPerYear(item),
      ),
    )
    .filter((change): change is PriceChange => change !== null)
    .filter(worthMentioning);

  return { dormant, candidates, priceChanges };
}

export function useSubscriptionAudit(): LiveQueryResult<SubscriptionAudit> {
  return useLiveQuery(useCallback(() => runAudit(), []), [
    ...SCHEDULE_TABLES,
    'entries',
    'postings',
  ]);
}
