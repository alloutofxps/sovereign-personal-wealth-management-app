/* ===========================================================================
 * WHAT THE FUNDS CHARGE
 * ---------------------------------------------------------------------------
 * Nobody is ever sent a bill for a fund's expense ratio. It comes out of the
 * fund's value before the price is published, which means it is the largest
 * regular cost most people carry and the only one they never see leave. A
 * quarter of a percent sounds like nothing and is not: on a portfolio held for
 * thirty years it is routinely a fifth of the final balance.
 *
 * So this file exists to say the number out loud. It is deliberately not
 * advice — this app does not know somebody's plans, their nerve or their tax
 * position, and it is in no position to tell them which fund to hold. It
 * states what they are paying and what that compounds to, and stops there.
 *
 * Everything is integer arithmetic through `mulDivRound`. A projection is
 * still a projection, but it should at least be the same projection twice.
 * ======================================================================== */

import {
  BP_ZERO,
  applyBasisPoints,
  basisPoints,
  minor,
  mulDivRound,
  type BasisPoints,
  type Minor,
} from '@/core/money';
import { marketValue, type Holding } from './holdingsMath';

/**
 * What a broad, cheap index fund costs, in basis points.
 *
 * The comparison has to be against something reachable rather than against
 * zero: no fund is free, and measuring against nothing would overstate the
 * gap and make the figure easy to dismiss. 0.15% a year is what a mainstream
 * whole-market tracker charges, so the difference shown is one somebody could
 * actually act on.
 */
export const LOW_COST_BASELINE_BP: BasisPoints = basisPoints(15);

/** The long-run gross return the projection assumes, before any fees. */
export const ASSUMED_GROSS_RETURN_BP: BasisPoints = basisPoints(700);

/** The horizons worth showing. Long enough for compounding to be the point. */
export const HORIZONS = [10, 20, 30] as const;

export interface FeeDrag {
  /** What the portfolio is worth now. */
  portfolioValue: Minor;
  /**
   * The average charge across everything held, weighted by how much of each
   * is held. A large cheap holding matters more than a small expensive one.
   */
  weightedBp: BasisPoints;
  /** What that costs over the coming year at today's size. */
  annualCost: Minor;
  /** The single most expensive thing held, when there is one worth naming. */
  costliest: { symbol: string; name: string; expenseRatioBp: BasisPoints } | null;
  projections: FeeProjection[];
}

export interface FeeProjection {
  years: number;
  /** What it could grow to at the assumed return, after the fees actually paid. */
  withYourFees: Minor;
  /** The same, in a fund charging the low-cost baseline. */
  withBaselineFees: Minor;
  /** The gap between those two. What the difference in charges costs. */
  versusBaseline: Minor;
  /** What all fees take, measured against paying none at all. */
  feesAbsorbed: Minor;
}

/**
 * The average charge across a portfolio, weighted by value.
 *
 * Weighted rather than averaged: somebody holding €90,000 of a 0.07% tracker
 * and €1,000 of a 1.50% fund is paying about 0.09%, not the 0.79% a plain
 * average would report. Reporting the plain average would frighten people out
 * of a portfolio that is already cheap.
 */
export function weightedExpenseRatio(holdings: readonly Holding[]): BasisPoints {
  let weighted = 0;
  let total = 0;

  for (const holding of holdings) {
    const value = marketValue(holding.priceMinor, holding.quantity1e8);
    weighted += value * holding.security.expenseRatioBp;
    total += value;
  }

  if (total <= 0) return BP_ZERO;
  return basisPoints(mulDivRound(minor(weighted), 1, total));
}

/**
 * Grow an amount for a number of years at an annual rate, in integer steps.
 *
 * One rounded multiplication per year rather than a single power. It costs
 * thirty multiplications at the outside and it means the figure is reached the
 * same way every time, on every machine, with no float anywhere in it.
 */
export function compound(value: Minor, annualBp: BasisPoints, years: number): Minor {
  let current: Minor = value;
  for (let year = 0; year < years; year++) {
    current = mulDivRound(current, 10_000 + annualBp, 10_000);
  }
  return current;
}

/**
 * What the charges on a portfolio come to, now and over time.
 *
 * The projection holds the balance still — no further contributions — because
 * this is a question about the money already there. Adding an assumed monthly
 * contribution would make the numbers larger and the answer less honest, since
 * it would be projecting somebody's future saving rather than measuring their
 * present cost.
 */
export function feeDragOf(holdings: readonly Holding[]): FeeDrag {
  let portfolioValue = 0;
  let costliest: FeeDrag['costliest'] = null;

  for (const holding of holdings) {
    portfolioValue += marketValue(holding.priceMinor, holding.quantity1e8);
    if (
      holding.security.expenseRatioBp > 0 &&
      (!costliest || holding.security.expenseRatioBp > costliest.expenseRatioBp)
    ) {
      costliest = {
        symbol: holding.security.symbol,
        name: holding.security.name,
        expenseRatioBp: holding.security.expenseRatioBp,
      };
    }
  }

  const value = minor(portfolioValue);
  const weightedBp = weightedExpenseRatio(holdings);

  // Net of charges. Floored at zero rather than allowed to go negative: a fund
  // charging more than the assumed return is a broken input, not a portfolio
  // that shrinks to nothing in the projection.
  const yourNet = basisPoints(Math.max(0, ASSUMED_GROSS_RETURN_BP - weightedBp));
  const baselineNet = basisPoints(
    Math.max(0, ASSUMED_GROSS_RETURN_BP - LOW_COST_BASELINE_BP),
  );

  const projections: FeeProjection[] = HORIZONS.map((years) => {
    const withYourFees = compound(value, yourNet, years);
    const withBaselineFees = compound(value, baselineNet, years);
    const withNoFees = compound(value, ASSUMED_GROSS_RETURN_BP, years);

    return {
      years,
      withYourFees,
      withBaselineFees,
      versusBaseline: minor(withBaselineFees - withYourFees),
      feesAbsorbed: minor(withNoFees - withYourFees),
    };
  });

  return {
    portfolioValue: value,
    weightedBp,
    annualCost: applyBasisPoints(value, weightedBp),
    costliest,
    projections,
  };
}

/** A rate as a person reads it: `0.18%`. */
export function formatExpenseRatio(rateBp: BasisPoints): string {
  return `${(rateBp / 100).toFixed(2)}%`;
}

/**
 * What the fees come to, said plainly.
 *
 * Calm on purpose. Somebody who has just learned that their funds will take
 * five figures off their retirement does not need an exclamation mark; they
 * need the number, the comparison, and no instruction about what to do with
 * either.
 */
export function describeFeeDrag(
  drag: FeeDrag,
  format: (amount: Minor) => string,
  years = 20,
): string {
  if (drag.portfolioValue <= 0) {
    return 'Once you have recorded what you hold, this will show what the funds charge for it.';
  }

  if (drag.weightedBp === 0) {
    return (
      'Nothing you hold has a charge recorded against it. If you know the yearly fee on ' +
      'any of them, adding it here will show what it comes to over time.'
    );
  }

  const horizon = drag.projections.find((p) => p.years === years) ?? drag.projections[0]!;

  return (
    `At your current size, fund charges cost about ${format(drag.annualCost)} a year — ` +
    `${formatExpenseRatio(drag.weightedBp)} of what you hold. Held for ${horizon.years} years ` +
    `at a steady ${(ASSUMED_GROSS_RETURN_BP / 100).toFixed(2)}% before charges, that ` +
    `difference adds up to roughly ${format(horizon.versusBaseline)} less than the same ` +
    `money in a ${formatExpenseRatio(LOW_COST_BASELINE_BP)} tracker.`
  );
}

/** The honest caveat that has to sit under any projection. */
export const PROJECTION_CAVEAT =
  'This assumes the money stays where it is and grows steadily, which no investment ever ' +
  'does. It is here to show what charges compound to, not to predict what you will have.';
