/* ===========================================================================
 * WHAT NORMAL LOOKS LIKE
 * ---------------------------------------------------------------------------
 * A baseline for each category, so "you have spent €340 on food" can become
 * "which is about what you usually do" or "which is a third more than usual".
 *
 * The median, not the mean. One annual insurance payment or a month you moved
 * house would drag an average somewhere unrecognisable and then quietly
 * mis-describe every month afterwards; the middle value shrugs both off.
 *
 * The guard at the top of this file matters more than the arithmetic under it.
 * A ledger three weeks old has no baseline, and inventing one — dividing three
 * weeks of records by three months — produces a confident, specific, wrong
 * number. This module has already been the site of exactly that bug once, in
 * Slice 4, where a category average divided three days of data by three months
 * and reported €12.17 for something that was actually €36.50. So when there is
 * not enough history the answer is "not yet", said plainly, and nothing else.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

/** One closed period's spending in one category. */
export interface CycleSpend {
  /** 'YYYY-MM' — which closed cycle this is. */
  cycle: string;
  amount: Minor;
}

export interface CategoryHistory {
  categoryId: string;
  categoryName: string;
  /** Closed cycles only, oldest first. The current cycle is never in here. */
  cycles: CycleSpend[];
  /** What has been spent so far in the cycle in progress. */
  currentSpend: Minor;
}

/** Below this there is no baseline worth showing. */
export const MIN_DAYS_OF_HISTORY = 60;
export const MIN_CLOSED_CYCLES = 2;
/** How far above the usual pace is worth mentioning. */
export const VARIANCE_NOTICE_BP = 2000; // 20%

export type TrailingMedianResult =
  | {
      status: 'insufficient_history';
      daysRecorded: number;
      cyclesFound: number;
      /** A complete sentence, ready to put on a card. */
      explanation: string;
    }
  | {
      status: 'ready';
      daysRecorded: number;
      cyclesFound: number;
      categories: CategoryBaseline[];
    };

export interface CategoryBaseline {
  categoryId: string;
  categoryName: string;
  /** The middle of the closed cycles. */
  median: Minor;
  /** Spent so far in the cycle in progress. */
  currentSpend: Minor;
  /**
   * What this cycle is heading for at the current rate.
   *
   * Only meaningful part-way through a cycle, which is why the fraction
   * elapsed is taken as an argument rather than assumed.
   */
  projected: Minor;
  /** Projected against the median, in basis points. 12000 = 20% over. */
  paceBp: number;
  /** True when the projection is far enough over to be worth a word. */
  runningHot: boolean;
  /** True when it is well under, which is worth saying too. */
  runningCool: boolean;
}

/**
 * Work out a baseline per category, or explain why there is not one yet.
 *
 * `daysRecorded` is the span of the whole ledger, not of one category: a
 * category with no history at all is a category you have not spent on, which
 * is different from a ledger that is too young to know anything.
 */
export function trailingMedians(input: {
  histories: readonly CategoryHistory[];
  daysRecorded: number;
  /** 0–1. How far through the current cycle we are. */
  cycleElapsed: number;
}): TrailingMedianResult {
  const cyclesFound = input.histories.reduce(
    (most, history) => Math.max(most, history.cycles.length),
    0,
  );

  if (input.daysRecorded < MIN_DAYS_OF_HISTORY || cyclesFound < MIN_CLOSED_CYCLES) {
    const monthsShort = Math.max(
      1,
      Math.ceil((MIN_DAYS_OF_HISTORY - Math.max(input.daysRecorded, 0)) / 30),
    );
    return {
      status: 'insufficient_history',
      daysRecorded: Math.max(input.daysRecorded, 0),
      cyclesFound,
      explanation:
        `Sovereign needs about ${monthsShort} more ${monthsShort === 1 ? 'month' : 'months'} ` +
        `of records before it can show what your normal spending looks like. Until then it ` +
        `would only be guessing, which is worse than saying nothing.`,
    };
  }

  // A fraction of zero would make every projection infinite; a fraction above
  // one would shrink it. Neither is a real state, but both are cheap to rule
  // out and expensive to debug from a screenshot.
  const elapsed = Math.min(1, Math.max(input.cycleElapsed, 0.01));

  const categories = input.histories
    .filter((history) => history.cycles.length >= MIN_CLOSED_CYCLES)
    .map((history): CategoryBaseline => {
      const median = medianOf(history.cycles.map((c) => c.amount));
      const projected = minor(Math.round(history.currentSpend / elapsed));
      const paceBp = median > 0 ? Math.round((projected * 10_000) / median) : 0;

      return {
        categoryId: history.categoryId,
        categoryName: history.categoryName,
        median,
        currentSpend: history.currentSpend,
        projected,
        paceBp,
        runningHot: median > 0 && paceBp > 10_000 + VARIANCE_NOTICE_BP,
        runningCool: median > 0 && paceBp < 10_000 - VARIANCE_NOTICE_BP,
      };
    })
    .sort((a, b) => b.median - a.median);

  return {
    status: 'ready',
    daysRecorded: input.daysRecorded,
    cyclesFound,
    categories,
  };
}

/**
 * The middle value.
 *
 * An even count averages the two middle ones and rounds, so the result is
 * always a whole number of minor units — a median of "half a penny" is not a
 * thing money can be.
 */
export function medianOf(values: readonly number[]): Minor {
  if (values.length === 0) return minor(0);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? minor(Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2))
    : minor(sorted[mid] ?? 0);
}

/**
 * How a pace reads in a sentence.
 *
 * Deliberately approximate — "about a fifth higher" is what somebody can act
 * on, and a figure to two decimal places invites an argument about the second
 * decimal place instead of a look at the spending.
 */
export function describePace(baseline: CategoryBaseline): string | null {
  if (!baseline.runningHot && !baseline.runningCool) return null;

  const percent = Math.abs(Math.round(baseline.paceBp / 100) - 100);
  return baseline.runningHot
    ? `Running about ${percent}% higher than your usual three-month pace.`
    : `Running about ${percent}% lower than your usual three-month pace.`;
}
