/* ===========================================================================
 * HOW LONG YOUR MONEY WOULD LAST
 * ---------------------------------------------------------------------------
 *   Runway = money you could actually use ÷ what you must spend each month
 *
 * The point of this is not the number. It is the second number: what the same
 * money would stretch to if the income stopped and everything optional came
 * off. That gap is the difference between a fright and a plan, so both are
 * always shown together.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

export interface SpendingCategory {
  id: string;
  name: string;
  /** Typical monthly spend, from the trailing months. */
  monthly: Minor;
  /**
   * Whether this is something you could stop.
   *
   * Rent and energy are not optional; eating out is. Sovereign guesses from
   * the category, and the person can disagree — which is the whole feature.
   */
  optional: boolean;
}

export interface RunwayInput {
  /** Cash you could reach today, less anything already promised. */
  usableCash: Minor;
  /** Bills that arrive whether or not you do anything. */
  fixedMonthly: Minor;
  categories: readonly SpendingCategory[];
  /** Categories the person has switched off for this scenario. */
  excludedIds?: readonly string[];
}

export interface RunwayResult {
  /** What a month costs under this scenario. */
  monthlyNeed: Minor;
  fixedMonthly: Minor;
  spendingMonthly: Minor;
  /** Whole days the money would last. Null when nothing goes out at all. */
  days: number | null;
  /** The same, in whole months, for the headline. */
  months: number | null;
  usableCash: Minor;
}

const DAYS_PER_MONTH = 30;

export function calculateRunway(input: RunwayInput): RunwayResult {
  const excluded = new Set(input.excludedIds ?? []);

  const spendingMonthly = minor(
    input.categories
      .filter((category) => !excluded.has(category.id))
      .reduce((total, category) => total + Math.max(0, category.monthly), 0),
  );

  const monthlyNeed = minor(Math.max(0, input.fixedMonthly) + spendingMonthly);

  if (monthlyNeed <= 0) {
    return {
      monthlyNeed,
      fixedMonthly: input.fixedMonthly,
      spendingMonthly,
      days: null,
      months: null,
      usableCash: input.usableCash,
    };
  }

  const cash = Math.max(0, input.usableCash);
  return {
    monthlyNeed,
    fixedMonthly: input.fixedMonthly,
    spendingMonthly,
    days: Math.floor((cash * DAYS_PER_MONTH) / monthlyNeed),
    months: Math.floor(cash / monthlyNeed),
    usableCash: input.usableCash,
  };
}

/** "about seven months", "just under three weeks" — how people actually talk. */
export function describeDuration(days: number | null): string {
  if (days === null) return 'as long as you like';
  if (days <= 0) return 'no time at all';
  if (days < 14) return `about ${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `about ${weeks} weeks`;
  }
  const months = Math.round(days / DAYS_PER_MONTH);
  if (months < 24) return `about ${months} months`;
  // Whole years only. "About 3.1 years" implies a precision this estimate
  // does not have, and nobody talks about their savings that way.
  const years = Math.round(months / 12);
  return `about ${years} years`;
}

/**
 * The two figures side by side: carrying on as you are, and cutting back to
 * essentials only.
 */
export function describeRunway(
  asYouAre: RunwayResult,
  bareBones: RunwayResult,
  format: (amount: Minor) => string,
): string {
  if (asYouAre.days === null) {
    return 'Once Sovereign knows what goes out each month, it can work out how long your money would last.';
  }

  if (asYouAre.usableCash <= 0) {
    return 'There is nothing spare at the moment, so there is nothing here to stretch.';
  }

  const asIs = describeDuration(asYouAre.days);
  const cutBack = describeDuration(bareBones.days);

  // Compare what would actually be printed. Two figures a few days apart both
  // round to "about 3 months", and saying it twice reads as a mistake.
  return asIs === cutBack
    ? `Spending as you are now, ${format(asYouAre.usableCash)} would last ${asIs}. Cutting ` +
        `back to just the essentials would not change that much.`
    : `Spending as you are now, ${format(asYouAre.usableCash)} would last ${asIs}. Cutting ` +
        `back to just the essentials, it would stretch to ${cutBack}.`;
}

/**
 * A first guess at what is optional, from the category name.
 *
 * Only ever a starting point — the person can switch anything on or off, and
 * their choice is what the figure uses.
 */
export function guessOptional(categoryName: string): boolean {
  return !/rent|mortgage|energy|electric|gas|water|council|insurance|food|shopping|health|transport|bills/i.test(
    categoryName,
  );
}
