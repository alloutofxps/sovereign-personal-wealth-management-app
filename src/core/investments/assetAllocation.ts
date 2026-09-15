/* ===========================================================================
 * HOW THE MONEY IS SPREAD
 * ---------------------------------------------------------------------------
 * The one number a person actually needs from an investment screen is not the
 * total — they can see that on a statement — it is how much of it is in one
 * kind of thing. A portfolio that is 96% equities is a different life from one
 * that is 60/40, and neither statement will ever say so.
 *
 * The shares here always add to exactly 10,000 basis points. Not "about", not
 * "to within rounding". Percentages that come to 99.9% are the single most
 * common way a financial screen tells somebody it cannot be trusted, and the
 * fix is old and well understood: floor everything, then hand out the leftover
 * units to whoever was closest to the next one. `allocate` already does that,
 * so this reaches for it rather than reinventing it slightly differently.
 * ======================================================================== */

import { allocate, basisPoints, minor, type BasisPoints, type Minor } from '@/core/money';
import { marketValue, type AssetClass, type Holding } from './holdingsMath';

/** Every class, in the order a portfolio is usually read. */
export const ASSET_CLASS_ORDER: AssetClass[] = [
  'equity',
  'fixed_income',
  'real_estate',
  'commodity',
  'crypto',
  'cash_equivalent',
  'other',
];

/** What each class is called, in words rather than in industry shorthand. */
export const ASSET_CLASS_NAMES: Record<AssetClass, string> = {
  equity: 'Shares',
  fixed_income: 'Bonds',
  cash_equivalent: 'Cash',
  real_estate: 'Property',
  commodity: 'Commodities',
  crypto: 'Crypto',
  other: 'Other',
};

/**
 * A short line saying what owning this kind of thing means.
 *
 * Written for somebody who has never been told. The point of an allocation bar
 * is not to name the slices, it is to explain why having only one is a choice.
 */
export const ASSET_CLASS_MEANINGS: Record<AssetClass, string> = {
  equity: 'Part-ownership of companies. Grows most over long stretches, and falls hardest.',
  fixed_income: 'Lending your money out for interest. Steadier, and slower.',
  cash_equivalent: 'Money kept as money. It does not fall, and it does not grow.',
  real_estate: 'Exposure to property, without owning a building yourself.',
  commodity: 'Physical things like gold or oil. Moves for reasons of its own.',
  crypto: 'Highly volatile. Worth only holding money you could do without.',
  other: 'Anything that does not sit in the groups above.',
};

export interface AllocationSlice {
  assetClass: AssetClass;
  name: string;
  value: Minor;
  /** This slice's share of the portfolio. Every slice adds to exactly 10,000. */
  shareBp: BasisPoints;
  holdings: number;
}

export interface Allocation {
  slices: AllocationSlice[];
  total: Minor;
}

/**
 * Group a portfolio by what kind of thing each holding is.
 *
 * Empty classes are left out rather than listed at zero: a legend with five
 * rows reading 0.00% is noise dressed as completeness.
 */
export function allocationOf(holdings: readonly Holding[]): Allocation {
  const byClass = new Map<AssetClass, { value: number; count: number }>();
  let total = 0;

  for (const holding of holdings) {
    const value = marketValue(holding.priceMinor, holding.quantity1e8);
    const current = byClass.get(holding.security.assetClass) ?? { value: 0, count: 0 };
    byClass.set(holding.security.assetClass, {
      value: current.value + value,
      count: current.count + 1,
    });
    total += value;
  }

  const present = ASSET_CLASS_ORDER.filter((cls) => byClass.has(cls));

  if (present.length === 0 || total <= 0) {
    return { slices: [], total: minor(Math.max(0, total)) };
  }

  // Largest remainder, over the whole 10,000, so the shares are exact by
  // construction rather than by each being rounded and hoping.
  const weights = present.map((cls) => byClass.get(cls)!.value);
  const shares = allocate(minor(10_000), weights);

  return {
    total: minor(total),
    slices: present.map((cls, index) => ({
      assetClass: cls,
      name: ASSET_CLASS_NAMES[cls],
      value: minor(byClass.get(cls)!.value),
      shareBp: basisPoints(shares[index] ?? 0),
      holdings: byClass.get(cls)!.count,
    })),
  };
}

/** A share as a percentage: `61.25%`. */
export function formatShare(shareBp: BasisPoints): string {
  return `${(shareBp / 100).toFixed(2)}%`;
}

/**
 * One sentence describing the shape of a portfolio.
 *
 * Descriptive, never prescriptive. This app does not know somebody's age,
 * their plans or their nerve, and telling them their allocation is wrong on
 * the strength of a pie chart would be advice it is in no position to give.
 */
export function describeAllocation(allocation: Allocation): string {
  if (allocation.slices.length === 0) {
    return 'Nothing recorded yet. Add what you hold and this will show how it is spread.';
  }

  const largest = [...allocation.slices].sort((a, b) => b.shareBp - a.shareBp)[0]!;

  if (allocation.slices.length === 1) {
    return (
      `Everything you hold is in ${largest.name.toLowerCase()}. That is a choice rather ` +
      `than a problem, but it is worth knowing it is the only one you have made.`
    );
  }

  return (
    `${formatShare(largest.shareBp)} of what you hold is in ${largest.name.toLowerCase()}, ` +
    `spread across ${allocation.slices.length} kinds of investment in all.`
  );
}

/**
 * The classes a *holding* may be recorded as, which is not all of them.
 *
 * `cash_equivalent` is deliberately absent. Plain cash in a brokerage has no
 * price, no cost basis and no fee, so it is not a position — and offering it
 * here alongside the account's own cash field gave two ways to record one
 * thing. Two mechanisms for one figure is how somebody's EUR 440 gets counted
 * twice, so there is one way: the cash field on the account.
 *
 * The class itself stays in `AssetClass`. It is in the schema's CHECK
 * constraints since v11, it is a legitimate *target* in a rebalancing mix, and
 * existing rows carry it. This list narrows what a person may choose, and
 * changes nothing that has already been recorded.
 *
 * The one case it costs: a money-market fund genuinely is a holding with a
 * ticker and a price, and it now has to be filed under something else. Worth
 * revisiting under an unambiguous label if anybody asks for it — the reason
 * this option went is the word "Cash", not the asset class.
 */
export const HOLDABLE_ASSET_CLASSES: AssetClass[] = ASSET_CLASS_ORDER.filter(
  (value) => value !== 'cash_equivalent',
);
