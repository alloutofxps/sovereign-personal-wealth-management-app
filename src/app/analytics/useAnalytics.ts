/* ===========================================================================
 * FEEDING THE ANALYTICS
 * ---------------------------------------------------------------------------
 * Gathers a period out of the ledger and hands it to the pure builders. All
 * the arithmetic lives in `@/core/analytics`; this only knows how to ask the
 * database for the right rows and which window "last month" means.
 *
 * Everything here is imported only by the analytics route, so it travels in
 * that lazy chunk and never reaches first paint.
 * ======================================================================== */

import { useCallback, useMemo } from 'react';
import { sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import { toIsoDate } from '@/core/liquidity';
import {
  buildDistribution,
  buildSankeyFlow,
  trailingMedians,
  type Distribution,
  type SankeyGraph,
  type SpendRow,
  type SpendSlice,
  type TrailingMedianResult,
} from '@/core/analytics';
import { db } from '@/data/client';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';

export type Horizon = 'this-month' | 'last-month' | 'trailing-90' | 'year-to-date';

export const HORIZON_LABELS: Record<Horizon, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'trailing-90': 'Last 90 days',
  'year-to-date': 'This year',
};

export interface Period {
  start: string;
  /** Inclusive. */
  end: string;
  label: string;
  /** 0–1, how far through this window we are. 1 for closed windows. */
  elapsed: number;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOf(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Turn a horizon into actual dates, relative to today. */
export function periodFor(horizon: Horizon, today: string): Period {
  const [y, m, d] = today.split('-').map(Number);
  const year = y ?? 1970;
  const month = m ?? 1;
  const day = d ?? 1;

  switch (horizon) {
    case 'this-month': {
      const end = lastDayOf(year, month);
      return {
        start: iso(year, month, 1),
        end: today,
        label: HORIZON_LABELS[horizon],
        elapsed: day / end,
      };
    }
    case 'last-month': {
      const lastMonth = month === 1 ? 12 : month - 1;
      const lastYear = month === 1 ? year - 1 : year;
      return {
        start: iso(lastYear, lastMonth, 1),
        end: iso(lastYear, lastMonth, lastDayOf(lastYear, lastMonth)),
        label: HORIZON_LABELS[horizon],
        elapsed: 1,
      };
    }
    case 'trailing-90': {
      const from = new Date(year, month - 1, day - 89);
      return {
        start: toIsoDate(from),
        end: today,
        label: HORIZON_LABELS[horizon],
        elapsed: 1,
      };
    }
    case 'year-to-date': {
      const daysThroughYear =
        Math.round(
          (new Date(year, month - 1, day).getTime() - new Date(year, 0, 1).getTime()) / 86_400_000,
        ) + 1;
      return {
        start: iso(year, 1, 1),
        end: today,
        label: HORIZON_LABELS[horizon],
        elapsed: Math.min(1, daysThroughYear / 365),
      };
    }
  }
}

export interface AnalyticsData {
  period: Period;
  flow: SankeyGraph;
  distribution: Distribution;
  baselines: TrailingMedianResult;
  /** True when the whole ledger holds nothing at all. */
  emptyLedger: boolean;
}

type Row = Record<number, unknown>;

const num = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string => String(value ?? '');

/**
 * One period, gathered and handed to the builders.
 *
 * Categories that a scheduled bill points at are treated as commitments rather
 * than day-to-day spending: the person has already told us those are
 * contractual, so inferring it again from the amounts would be guessing at
 * something already known.
 */
async function gather(horizon: Horizon): Promise<AnalyticsData> {
  const today = toIsoDate(new Date());
  const period = periodFor(horizon, today);

  const [spendRows, incomeRows, savingRows, fixedRows, spanRows, cycleRows] = await Promise.all([
    db.all(sql`
      SELECT a.id, a.name, parent.id, parent.name,
             COALESCE(SUM(p.amount), 0)
        FROM postings p
        JOIN entries e  ON e.id = p.entry_id
        JOIN accounts a ON a.id = p.account_id
        LEFT JOIN accounts parent ON parent.id = a.parent_id
       WHERE p.book = 'FINANCIAL' AND a.type = 'EXPENSE'
         AND e.date >= ${period.start} AND e.date <= ${period.end}
       GROUP BY a.id, a.name, parent.id, parent.name
      HAVING COALESCE(SUM(p.amount), 0) > 0`),

    db.all(sql`
      SELECT a.id, a.name, COALESCE(-SUM(p.amount), 0)
        FROM postings p
        JOIN entries e  ON e.id = p.entry_id
        JOIN accounts a ON a.id = p.account_id
       WHERE p.book = 'FINANCIAL' AND a.type = 'INCOME'
         AND e.date >= ${period.start} AND e.date <= ${period.end}
       GROUP BY a.id, a.name
      HAVING COALESCE(-SUM(p.amount), 0) > 0`),

    // Money moved into a saving pot during the window.
    db.all(sql`
      SELECT a.id, a.name, COALESCE(SUM(p.amount), 0)
        FROM postings p
        JOIN entries e  ON e.id = p.entry_id
        JOIN accounts a ON a.id = p.account_id
       WHERE p.book = 'BUDGET' AND a.type = 'ENVELOPE'
         AND a.envelope_role IN ('goal', 'sinking_fund')
         AND e.date >= ${period.start} AND e.date <= ${period.end}
       GROUP BY a.id, a.name
      HAVING COALESCE(SUM(p.amount), 0) > 0`),

    db.all(sql`SELECT DISTINCT category_id FROM scheduled_items
                WHERE active = 1 AND kind = 'bill' AND category_id IS NOT NULL`),

    db.all(sql`SELECT MIN(date), MAX(date) FROM entries`),

    // Closed months only: the current month is still being written.
    db.all(sql`
      SELECT a.id, a.name, substr(e.date, 1, 7), COALESCE(SUM(p.amount), 0)
        FROM postings p
        JOIN entries e  ON e.id = p.entry_id
        JOIN accounts a ON a.id = p.account_id
       WHERE p.book = 'FINANCIAL' AND a.type = 'EXPENSE'
         AND substr(e.date, 1, 7) < ${today.slice(0, 7)}
       GROUP BY a.id, a.name, substr(e.date, 1, 7)
      HAVING COALESCE(SUM(p.amount), 0) > 0
       ORDER BY substr(e.date, 1, 7) ASC`),
  ]);

  const fixedIds = new Set((fixedRows as Row[]).map((row) => str(row[0])));

  const spends: SpendSlice[] = (spendRows as Row[]).map((row) => ({
    categoryId: str(row[0]),
    categoryName: str(row[1]),
    groupId: row[2] ? str(row[2]) : null,
    groupName: row[3] ? str(row[3]) : null,
    amount: minor(num(row[4])),
    fixed: fixedIds.has(str(row[0])),
  }));

  const flow = buildSankeyFlow({
    incomes: (incomeRows as Row[]).map((row) => ({
      accountId: str(row[0]),
      name: str(row[1]),
      amount: minor(num(row[2])),
    })),
    spends,
    savings: (savingRows as Row[]).map((row) => ({
      potId: str(row[0]),
      name: str(row[1]),
      amount: minor(num(row[2])),
    })),
  });

  const distributionRows: SpendRow[] = spends.map((slice) => ({
    categoryId: slice.categoryId,
    categoryName: slice.categoryName,
    groupId: slice.groupId,
    groupName: slice.groupName,
    amount: slice.amount,
  }));

  // How long the ledger has actually been running, which decides whether any
  // baseline can be shown at all.
  const span = (spanRows as Row[])[0];
  const earliest = span ? str(span[0]) : '';
  const latest = span ? str(span[1]) : '';
  const daysRecorded =
    earliest && latest
      ? Math.round(
          (new Date(latest).getTime() - new Date(earliest).getTime()) / 86_400_000,
        ) + 1
      : 0;

  const byCategory = new Map<
    string,
    { name: string; cycles: { cycle: string; amount: Minor }[] }
  >();
  for (const row of cycleRows as Row[]) {
    const id = str(row[0]);
    const bucket = byCategory.get(id) ?? { name: str(row[1]), cycles: [] };
    bucket.cycles.push({ cycle: str(row[2]), amount: minor(num(row[3])) });
    byCategory.set(id, bucket);
  }

  const currentByCategory = new Map(spends.map((s) => [s.categoryId, s.amount]));

  const baselines = trailingMedians({
    histories: [...byCategory].map(([categoryId, bucket]) => ({
      categoryId,
      categoryName: bucket.name,
      // The three most recent closed months.
      cycles: bucket.cycles.slice(-3),
      currentSpend: currentByCategory.get(categoryId) ?? minor(0),
    })),
    daysRecorded,
    cycleElapsed: period.elapsed,
  });

  return {
    period,
    flow,
    distribution: buildDistribution(distributionRows),
    baselines,
    emptyLedger: daysRecorded === 0,
  };
}

export const ANALYTICS_TABLES = ['entries', 'postings', 'accounts', 'scheduled_items'] as const;

export function useAnalytics(horizon: Horizon): LiveQueryResult<AnalyticsData> {
  const run = useCallback(() => gather(horizon), [horizon]);
  return useLiveQuery(run, ANALYTICS_TABLES);
}

/** Trailing medians keyed by category, for the bar chart's notches. */
export function useMedianMarks(data: AnalyticsData | undefined) {
  return useMemo(() => {
    if (!data || data.baselines.status !== 'ready') return undefined;
    return new Map(
      data.baselines.categories.map((baseline) => [
        baseline.categoryId,
        { median: baseline.median, runningHot: baseline.runningHot },
      ]),
    );
  }, [data]);
}
