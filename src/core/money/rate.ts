/* ===========================================================================
 * RATES AS BASIS POINTS
 * ---------------------------------------------------------------------------
 * Every rate in Sovereign is an integer count of basis points.
 *
 *   1 bp      = 0.01%
 *   100 bp    = 1.00%
 *   10 000 bp = 100.00%
 *
 * One representation covers all of it: card APR, loan interest, minimum
 * payment rates, savings allocation percentages, safe withdrawal rates, and
 * percentage split rules. There is no second rate type, and no float — a rate
 * applied to an integer amount produces an integer amount, exactly.
 *
 * Basis points are also how the finance industry already talks about rates,
 * so "19.99% APR" is 1999 and reads correctly to anyone auditing the data.
 * ======================================================================== */

import { MoneyError, minor, mulDivRound, type Minor } from './minor';

declare const bpBrand: unique symbol;

/** An integer count of basis points. 1 bp = 0.01%. */
export type BasisPoints = number & { readonly [bpBrand]: 'BasisPoints' };

/** Basis points in 100%. */
export const BP_PER_UNIT = 10_000;

export const BP_ZERO: BasisPoints = 0 as BasisPoints;

/** Construct from an integer count of basis points. */
export function basisPoints(value: number): BasisPoints {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      `A rate must be a whole number of basis points, received ${value}. ` +
        `19.99% is 1999, not 0.1999.`,
    );
  }
  return value as BasisPoints;
}

/**
 * From a human percentage: `19.99` becomes 1999 bp.
 * Rejects anything finer than a basis point rather than rounding it away.
 */
export function bpFromPercent(percent: number): BasisPoints {
  if (!Number.isFinite(percent)) {
    throw new MoneyError(`Not a valid percentage: ${percent}`);
  }
  const scaled = percent * 100;
  // Guard against binary representation error: 19.99 * 100 is 1998.9999...
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new MoneyError(
      `${percent}% is finer than one basis point. Rates are stored to two decimal places.`,
    );
  }
  return basisPoints(rounded);
}

/** Back to a human percentage for display. 1999 becomes 19.99. */
export function bpToPercent(rate: BasisPoints): number {
  return rate / 100;
}

/**
 * Apply a rate to an amount, rounded half away from zero, with no float at any
 * point. 19.99% of 1,000.00 is exactly 199.90.
 */
export function applyBasisPoints(amount: Minor, rate: BasisPoints): Minor {
  return mulDivRound(amount, rate, BP_PER_UNIT);
}

/**
 * One month's interest at an annual rate, using the simple 1/12 convention
 * that card and loan statements use. Kept explicit so the amortisation engine
 * in Phase 4 cannot silently pick a different day-count basis.
 */
export function monthlyInterest(balance: Minor, annualRate: BasisPoints): Minor {
  if (balance <= 0) return minor(0);
  return mulDivRound(balance, annualRate, BP_PER_UNIT * 12);
}

/** Add rates — a base rate plus a margin. */
export function addRates(a: BasisPoints, b: BasisPoints): BasisPoints {
  return basisPoints(a + b);
}

/** Format a rate for display, e.g. '19.99%'. Locale-aware via ECMA-402. */
export function formatRate(rate: BasisPoints, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rate / BP_PER_UNIT);
}
