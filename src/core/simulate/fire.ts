/* ===========================================================================
 * WHEN YOU COULD STOP
 * ---------------------------------------------------------------------------
 * How much you would need invested to live off it, and roughly how long that
 * takes at your current rate of saving.
 *
 *   Target = yearly spending ÷ withdrawal rate
 *
 * A 4% withdrawal rate means twenty-five times a year's spending. Moving the
 * rate to 3% makes it thirty-three times, which is why the slider matters far
 * more than most people expect — and why it is a slider rather than a constant
 * buried in the code.
 *
 * Three landmarks, because "retire" is not one thing:
 *   Lean      you could stop if you lived more simply
 *   Full      you could stop and live as you do now
 *   Coast     you could stop *saving* and still arrive on time
 *
 * Everything here is deterministic and returns the arithmetic it used. Around
 * the middle line sits a band for a better and a worse run of markets, worked
 * out directly rather than by simulating thousands of trials — the answer is
 * the same shape and costs a phone nothing.
 *
 * It is a projection, not a promise, and the copy above it says so.
 * ======================================================================== */

import { minor, mulDivRound, type BasisPoints, type Minor } from '@/core/money';

export type MilestoneKind = 'lean' | 'full' | 'fat' | 'coast';

export interface FireInput {
  /** What is invested today. */
  invested: Minor;
  /** What goes in each month from here. */
  monthlyContribution: Minor;
  /** What a year costs you now. */
  annualSpending: Minor;
  /** Expected return after inflation, in basis points. 500 = 5%. */
  realReturn: BasisPoints;
  /** Safe withdrawal rate in basis points. 300–450 covers 3%–4.5%. */
  withdrawalRate: BasisPoints;
  /**
   * How much returns bounce around, in basis points. 1500 is 15%, roughly a
   * broad equity fund. Used for the band around the line, not for the line.
   */
  volatility?: BasisPoints;
  /** Age now, so a "coast" figure can be anchored to a retirement age. */
  currentAge?: number;
  retirementAge?: number;
}

export interface Milestone {
  kind: MilestoneKind;
  /** Plain-English name, ready for a card heading. */
  label: string;
  target: Minor;
  /** Months from now, or null if it is out of reach at this rate. */
  months: number | null;
  reached: boolean;
  /** 0–100 for the progress bar. */
  percent: number;
}

export interface TrajectoryPoint {
  year: number;
  /** The middle line: steady returns, no drama. */
  balance: Minor;
  /** A rough good case and bad case around it. */
  low: Minor;
  high: Minor;
}

export interface FireResult {
  milestones: Milestone[];
  /** Year-by-year balance with a band around it, for the chart. */
  trajectory: TrajectoryPoint[];
  /** What a year's spending multiplies to at this withdrawal rate. */
  multiple: number;
  input: FireInput;
}

/** Lean is living more simply; fat is living better. */
const LEAN_SHARE = 6000; // 60% of current spending, in basis points
const FAT_SHARE = 15_000; // 150%

const MAX_YEARS = 60;

export const MILESTONE_LABELS: Record<MilestoneKind, string> = {
  lean: 'Enough to stop, living simply',
  full: 'Enough to stop, living as you do now',
  fat: 'Enough to stop, with room to spare',
  coast: 'Enough that you could stop adding to it',
};

/** What you would need invested to draw `annualSpending` from it. */
export function targetFor(annualSpending: Minor, withdrawalRate: BasisPoints): Minor {
  if (withdrawalRate <= 0) return minor(0);
  return mulDivRound(annualSpending, 10_000, withdrawalRate);
}

/**
 * Months until a pot of `from` grows to `target`, saving `monthly`.
 * Compounded monthly at the annual real return. Null when it never gets there.
 */
export function monthsToReach(
  from: Minor,
  target: Minor,
  monthly: Minor,
  realReturn: BasisPoints,
): number | null {
  if (from >= target) return 0;
  if (monthly <= 0 && realReturn <= 0) return null;

  let balance = from as number;
  for (let month = 1; month <= MAX_YEARS * 12; month++) {
    balance += (balance * realReturn) / (10_000 * 12);
    balance += monthly;
    if (balance >= target) return month;
  }
  return null;
}

export function projectFire(input: FireInput): FireResult {
  const full = targetFor(input.annualSpending, input.withdrawalRate);
  const lean = targetFor(
    mulDivRound(input.annualSpending, LEAN_SHARE, 10_000),
    input.withdrawalRate,
  );
  const fat = targetFor(mulDivRound(input.annualSpending, FAT_SHARE, 10_000), input.withdrawalRate);

  /**
   * Coasting: how much you would need *today* for it to grow into the full
   * target by your retirement age with nothing further added.
   */
  const yearsToRetirement = Math.max(
    0,
    (input.retirementAge ?? 65) - (input.currentAge ?? 35),
  );
  const growthFactor = Math.pow(1 + input.realReturn / 10_000, yearsToRetirement);
  const coast = minor(Math.round(growthFactor > 0 ? full / growthFactor : full));

  const milestone = (kind: MilestoneKind, target: Minor): Milestone => ({
    kind,
    label: MILESTONE_LABELS[kind],
    target,
    months:
      kind === 'coast'
        ? monthsToReach(input.invested, target, input.monthlyContribution, input.realReturn)
        : monthsToReach(input.invested, target, input.monthlyContribution, input.realReturn),
    reached: input.invested >= target,
    percent: target <= 0 ? 0 : Math.min(100, Math.round((input.invested / target) * 100)),
  });

  const trajectory = buildTrajectory(input);

  return {
    milestones: [
      milestone('coast', coast),
      milestone('lean', lean),
      milestone('full', full),
      milestone('fat', fat),
    ],
    trajectory,
    multiple: input.withdrawalRate > 0 ? Math.round(10_000 / input.withdrawalRate) : 0,
    input,
  };
}

/**
 * The middle line, with a good case and a bad case either side.
 *
 * Not ten thousand random trials — that flattens a phone battery to produce a
 * band that can be worked out directly. The spread of an *annualised* return
 * narrows with the square root of time, so the band is drawn by running the
 * same compounding at a better and a worse rate. Wide early, tighter later,
 * and still widening in pounds, which is what actually happens.
 */
function buildTrajectory(input: FireInput): TrajectoryPoint[] {
  const volatility = input.volatility ?? 1500;

  const grow = (years: number, annualRate: number): number => {
    let balance = input.invested as number;
    for (let month = 0; month < years * 12; month++) {
      balance += (balance * annualRate) / (10_000 * 12);
      balance += input.monthlyContribution;
    }
    return Math.max(0, balance);
  };

  const points: TrajectoryPoint[] = [];
  for (let year = 0; year <= 40; year++) {
    // Year zero has no spread: it is today, and today is known.
    const spread = year === 0 ? 0 : volatility / Math.sqrt(year);
    points.push({
      year,
      balance: minor(Math.round(grow(year, input.realReturn))),
      low: minor(Math.round(grow(year, input.realReturn - spread))),
      high: minor(Math.round(grow(year, input.realReturn + spread))),
    });
  }
  return points;
}

/** "in about 12 years", "in about 8 months" — the way people say it. */
export function describeWhen(months: number | null): string {
  if (months === null) return 'not at this rate';
  if (months === 0) return 'already there';
  if (months < 24) return `in about ${months} ${months === 1 ? 'month' : 'months'}`;
  const years = Math.round(months / 12);
  return `in about ${years} years`;
}

export function describeMilestone(
  milestone: Milestone,
  format: (amount: Minor) => string,
): string {
  if (milestone.reached) {
    return `You are there. ${format(milestone.target)} was the figure.`;
  }
  if (milestone.months === null) {
    return `At what you are putting away now this one stays out of reach. Saving more, or spending less later, would bring it in.`;
  }
  return `${format(milestone.target)} would do it, ${describeWhen(milestone.months)} at your current rate.`;
}
