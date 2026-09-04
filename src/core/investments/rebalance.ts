/* ===========================================================================
 * GETTING BACK TO WHERE YOU MEANT TO BE
 * ---------------------------------------------------------------------------
 * A portfolio drifts. Shares go up faster than bonds, so a 60/40 becomes a
 * 70/30 without anybody deciding anything, and the risk somebody signed up for
 * is not the risk they are now carrying.
 *
 * There are two ways back, and the difference between them matters more than
 * the arithmetic. Selling the overweight side and buying the underweight one
 * gets there immediately and triggers a tax bill on every gain realised on the
 * way. Directing the *next deposit* at whatever is furthest behind gets there
 * slowly and costs nothing. For most people, most of the time, the second is
 * the better trade — so it is the one offered first, and the full rebalance is
 * shown alongside with what it would realise rather than as the default.
 *
 * This file computes both and recommends neither. It cannot: it does not know
 * anybody's tax position, their horizon or whether they are about to need the
 * money, and a screen that says "sell your equities" on the strength of a
 * percentage is giving advice it has no standing to give.
 * ======================================================================== */

import {
  allocate,
  basisPoints,
  minor,
  type BasisPoints,
  type Minor,
} from '@/core/money';
import { ASSET_CLASS_NAMES } from './assetAllocation';
import type { AssetClass } from './holdingsMath';

export interface TargetAllocation {
  assetClass: AssetClass;
  targetBp: BasisPoints;
}

export interface RebalanceLine {
  assetClass: AssetClass;
  name: string;
  /** What is in this class today. */
  currentValue: Minor;
  /** What it would be after the plan, including any deposit. */
  targetValue: Minor;
  /** Positive means buy, negative means sell. */
  difference: Minor;
  /** Where this class sits today, in basis points of the portfolio. */
  currentBp: BasisPoints;
  targetBp: BasisPoints;
  /** How far off target it is. Positive means overweight. */
  driftBp: BasisPoints;
}

export interface DepositAllocation {
  assetClass: AssetClass;
  name: string;
  amount: Minor;
  /** What this class will sit at once the deposit lands. */
  resultingBp: BasisPoints;
}

export interface RebalancePlan {
  /** What the portfolio is worth now, before any deposit. */
  portfolioValue: Minor;
  depositCash: Minor;
  /** Every class with a target or a holding, worst drift first. */
  lines: RebalanceLine[];
  /**
   * Where to put new money, and nothing else.
   *
   * Fills the underweight classes in order of how far behind they are, and
   * never sells anything — so there is no tax to pay for following it.
   */
  depositPlan: DepositAllocation[];
  /** How much of the deposit the underweight classes could not absorb. */
  depositRemainder: Minor;
  /** True once no class is more than a basis point from its target. */
  alreadyBalanced: boolean;
}

export class RebalanceError extends Error {
  override name = 'RebalanceError';
}

/** Targets have to describe a whole portfolio, or they describe nothing. */
export function assertTargetsComplete(targets: readonly TargetAllocation[]): void {
  if (targets.length === 0) {
    throw new RebalanceError('Set what you want your portfolio to look like first.');
  }

  const total = targets.reduce((sum, t) => sum + t.targetBp, 0);
  if (total !== 10_000) {
    const off = Math.abs(10_000 - total) / 100;
    throw new RebalanceError(
      total < 10_000
        ? `Your targets come to ${(total / 100).toFixed(2)}%. There is ${off.toFixed(2)}% still to place.`
        : `Your targets come to ${(total / 100).toFixed(2)}%, which is ${off.toFixed(2)}% more than you have.`,
    );
  }

  const seen = new Set<AssetClass>();
  for (const target of targets) {
    if (seen.has(target.assetClass)) {
      throw new RebalanceError(`${ASSET_CLASS_NAMES[target.assetClass]} is listed twice.`);
    }
    seen.add(target.assetClass);
  }
}

/** Where a value sits as a share of the whole, in basis points. */
function shareBp(value: number, total: number): BasisPoints {
  if (total <= 0) return basisPoints(0);
  return basisPoints(Math.round((value * 10_000) / total));
}

/**
 * What it would take to get back to the targets, both ways.
 *
 * `currentValues` need not cover every class in the targets, and vice versa —
 * a class held but not targeted is fully overweight, and a class targeted but
 * not held is fully underweight. Both are ordinary states for somebody who has
 * just decided what they want.
 */
export function planRebalance(input: {
  currentValues: ReadonlyMap<AssetClass, Minor>;
  targets: readonly TargetAllocation[];
  depositCash?: Minor;
}): RebalancePlan {
  assertTargetsComplete(input.targets);

  const deposit = minor(Math.max(0, input.depositCash ?? 0));
  const byTarget = new Map(input.targets.map((t) => [t.assetClass, t.targetBp]));

  const classes = [
    ...new Set<AssetClass>([...input.currentValues.keys(), ...byTarget.keys()]),
  ];

  const portfolioValue = [...input.currentValues.values()].reduce((sum, v) => sum + v, 0);
  const totalAfter = portfolioValue + deposit;

  // Target values are allocated across the whole rather than computed one at a
  // time, so they add to exactly the portfolio and not to a penny either side.
  const targetOrder = classes.filter((cls) => (byTarget.get(cls) ?? 0) > 0);
  const targetShares = allocate(
    minor(totalAfter),
    targetOrder.map((cls) => byTarget.get(cls) ?? 0),
  );
  const targetValues = new Map<AssetClass, Minor>(
    targetOrder.map((cls, index) => [cls, targetShares[index] ?? minor(0)]),
  );

  const lines: RebalanceLine[] = classes
    .map((cls) => {
      const currentValue = minor(input.currentValues.get(cls) ?? 0);
      const targetBp = basisPoints(byTarget.get(cls) ?? 0);
      const targetValue = targetValues.get(cls) ?? minor(0);
      const currentBp = shareBp(currentValue, portfolioValue);

      return {
        assetClass: cls,
        name: ASSET_CLASS_NAMES[cls],
        currentValue,
        targetValue,
        difference: minor(targetValue - currentValue),
        currentBp,
        targetBp,
        driftBp: basisPoints(currentBp - targetBp),
      };
    })
    // Furthest from target first: the thing most worth doing something about.
    .sort((a, b) => Math.abs(b.driftBp) - Math.abs(a.driftBp) || a.name.localeCompare(b.name));

  return {
    portfolioValue: minor(portfolioValue),
    depositCash: deposit,
    lines,
    ...allocateDeposit(lines, deposit, totalAfter),
    alreadyBalanced: lines.every((line) => Math.abs(line.driftBp) <= 1),
  };
}

/**
 * Put new money where the portfolio is furthest behind.
 *
 * Only ever buys. A deposit plan that told somebody to sell something would
 * defeat the entire point of preferring deposits to trades, which is that
 * nothing taxable happens.
 *
 * The deposit is shared out in proportion to how far behind each class is,
 * capped at what each one actually needs — so a €500 deposit into a portfolio
 * that is €300 short overall buys €300 of what is missing and leaves €200
 * over rather than overshooting into a new imbalance.
 */
function allocateDeposit(
  lines: readonly RebalanceLine[],
  deposit: Minor,
  totalAfter: number,
): { depositPlan: DepositAllocation[]; depositRemainder: Minor } {
  if (deposit <= 0) return { depositPlan: [], depositRemainder: minor(0) };

  const short = lines.filter((line) => line.difference > 0);
  if (short.length === 0) return { depositPlan: [], depositRemainder: deposit };

  const needed = short.reduce((sum, line) => sum + line.difference, 0);

  // When the deposit cannot fill every gap, it is split in proportion to the
  // gaps — which keeps the portfolio's shape moving evenly towards target
  // instead of filling one class completely and leaving the rest untouched.
  const amounts =
    deposit >= needed
      ? short.map((line) => line.difference)
      : allocate(deposit, short.map((line) => line.difference));

  const plan: DepositAllocation[] = short
    .map((line, index) => ({
      assetClass: line.assetClass,
      name: line.name,
      amount: minor(amounts[index] ?? 0),
      resultingBp: shareBp(line.currentValue + (amounts[index] ?? 0), totalAfter),
    }))
    .filter((entry) => entry.amount > 0);

  const placed = plan.reduce((sum, entry) => sum + entry.amount, 0);
  return { depositPlan: plan, depositRemainder: minor(deposit - placed) };
}

/* ===========================================================================
 * SAYING IT IN WORDS
 * ======================================================================== */

/** One line per instruction: what to buy, and what it fixes. */
export function describeDepositStep(
  step: DepositAllocation,
  target: BasisPoints,
  format: (amount: Minor) => string,
): string {
  return (
    `Put ${format(step.amount)} into ${step.name.toLowerCase()} to bring it to ` +
    `${(step.resultingBp / 100).toFixed(2)}% against your ${(target / 100).toFixed(2)}% target.`
  );
}

/**
 * How the portfolio stands against the plan, in a sentence.
 *
 * Describes; never instructs. "You are 8% over on shares" is a fact somebody
 * can act on however they see fit. "Sell your shares" is advice this app has
 * no business giving.
 */
export function describeRebalance(
  plan: RebalancePlan,
  format: (amount: Minor) => string,
): string {
  if (plan.portfolioValue <= 0 && plan.depositCash <= 0) {
    return 'Once there is something in the portfolio, this will show how it compares with your targets.';
  }

  if (plan.alreadyBalanced) {
    return 'Everything is within a whisker of where you wanted it. Nothing needs doing.';
  }

  const worst = plan.lines[0];
  if (!worst) return 'Nothing to compare against your targets yet.';

  const direction = worst.driftBp > 0 ? 'more' : 'less';
  const gap = Math.abs(worst.driftBp) / 100;

  const drift =
    `You are holding ${gap.toFixed(2)}% ${direction} in ${worst.name.toLowerCase()} than ` +
    `you meant to.`;

  if (plan.depositPlan.length === 0) {
    return (
      `${drift} Putting new money into whatever is furthest behind is the way back that ` +
      `costs nothing — selling to rebalance means paying tax on the gains.`
    );
  }

  const total = plan.depositPlan.reduce((sum, step) => sum + step.amount, 0);
  return (
    `${drift} ${format(minor(total))} of your deposit would go towards closing that, ` +
    `without selling anything.`
  );
}
