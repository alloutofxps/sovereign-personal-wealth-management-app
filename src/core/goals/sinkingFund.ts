/* ===========================================================================
 * POTS: SAVING UP FOR THINGS
 * ---------------------------------------------------------------------------
 * Irregular costs are what wreck an otherwise sensible month. Car insurance
 * once a year, a holiday in August, the boiler service — each one arrives as a
 * shock only because nothing was put by for it.
 *
 *   MonthlyAllocation = (Target − CurrentBalance) ÷ MonthsRemaining
 *
 * The allocation recalculates every time the balance or the date moves, so
 * falling behind one month raises the next month's share rather than leaving
 * a fixed plan quietly broken.
 *
 * What this produces feeds straight into G_savings in the Safe-to-Spend
 * calculation: money that has to be put by is not money that is safe to spend,
 * whether or not it has physically moved yet.
 * ======================================================================== */

import { ZERO, minor, mulDivRound, type Minor } from '@/core/money';

export type PotStatus = 'funded' | 'on_track' | 'behind' | 'open_ended' | 'overdue';

export interface PotTarget {
  envelopeId: string;
  /** As the person named it: "Car insurance", "Holiday". */
  name: string;
  /** What needs to be there by the date. */
  targetAmount: Minor;
  /** What is in the pot right now. */
  currentBalance: Minor;
  /** 'YYYY-MM-DD', or null for an open-ended pot with no deadline. */
  targetDate: string | null;
  /** True when it starts again once reached — an annual bill. */
  recurring: boolean;
  /** How much has been put into this pot during the current cycle. */
  assignedThisCycle: Minor;
}

export interface PotPlan extends PotTarget {
  /** Whole months from today to the target date. Never below one. */
  monthsRemaining: number;
  /** What needs to go in each month from here to hit the target. */
  monthlyAllocation: Minor;
  /** What still needs to go in this month, after what already has. */
  stillNeededThisCycle: Minor;
  /** How much is left to find in total. */
  outstanding: Minor;
  status: PotStatus;
  /** 0-100, for the progress bar. */
  percentFunded: number;
}

/** Whole calendar months between two dates, rounded down, never below zero. */
export function monthsUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 1) - (fm ?? 1));
  // A target on the 5th when today is the 20th is not a whole month away.
  if ((td ?? 1) < (fd ?? 1)) months -= 1;
  return Math.max(0, months);
}

export function planFor(target: PotTarget, today: string): PotPlan {
  const outstanding = minor(Math.max(0, target.targetAmount - target.currentBalance));
  const funded = target.currentBalance >= target.targetAmount && target.targetAmount > 0;

  // An open-ended pot has no deadline, so nothing is *required* of any month.
  if (!target.targetDate) {
    return {
      ...target,
      monthsRemaining: 0,
      monthlyAllocation: ZERO,
      stillNeededThisCycle: ZERO,
      outstanding,
      status: funded ? 'funded' : 'open_ended',
      percentFunded: percent(target.currentBalance, target.targetAmount),
    };
  }

  const overdue = target.targetDate < today && !funded;
  // Once the date has passed, the whole remainder is needed now, not spread.
  const monthsRemaining = overdue ? 1 : Math.max(1, monthsUntil(today, target.targetDate));

  const monthlyAllocation = funded
    ? ZERO
    : // Rounded up, so the last month never leaves a penny short.
      minor(Math.ceil(outstanding / monthsRemaining));

  const stillNeededThisCycle = minor(
    Math.max(0, monthlyAllocation - Math.max(0, target.assignedThisCycle)),
  );

  const status: PotStatus = funded
    ? 'funded'
    : overdue
      ? 'overdue'
      : stillNeededThisCycle === 0
        ? 'on_track'
        : 'behind';

  return {
    ...target,
    monthsRemaining,
    monthlyAllocation,
    stillNeededThisCycle,
    outstanding,
    status,
    percentFunded: percent(target.currentBalance, target.targetAmount),
  };
}

/**
 * What all the pots together take out of what is safe to spend.
 *
 * Two parts, and both belong there:
 *   · what is already in the pots — it is sitting in the bank account, so it
 *     is inside the cash figure, and spending it would empty the pot;
 *   · what still has to go in this month — promised, even though it has not
 *     moved yet.
 */
export function reservedForPots(plans: readonly PotPlan[]): Minor {
  return minor(
    plans.reduce(
      (total, plan) => total + Math.max(0, plan.currentBalance) + plan.stillNeededThisCycle,
      0,
    ),
  );
}

/** Total that ought to go into pots this month, funded or not. */
export function monthlyPotTotal(plans: readonly PotPlan[]): Minor {
  return minor(plans.reduce((total, plan) => total + plan.monthlyAllocation, 0));
}

/**
 * A complete sentence about where this pot stands.
 * Takes the formatter so core stays free of locale and currency concerns.
 */
export function describePot(plan: PotPlan, format: (amount: Minor) => string): string {
  switch (plan.status) {
    case 'funded':
      return plan.recurring
        ? `Fully saved. ${format(plan.targetAmount)} is ready for ${plan.name.toLowerCase()}, and it will start again once it is paid.`
        : `Fully saved. ${format(plan.targetAmount)} is ready whenever you need it.`;

    case 'on_track':
      return `You have put ${format(plan.assignedThisCycle)} in this month, which keeps you on track. ${format(plan.outstanding)} still to find.`;

    case 'behind':
      return plan.assignedThisCycle > 0
        ? `${format(plan.stillNeededThisCycle)} more this month would keep you on track. Tap to catch up.`
        : `Putting ${format(plan.monthlyAllocation)} in this month keeps you on track. Tap to add it.`;

    case 'overdue':
      return `The date has passed and ${format(plan.outstanding)} is still to find. Tap to top it up, or move the date.`;

    case 'open_ended':
      return plan.targetAmount > 0
        ? `${format(plan.currentBalance)} saved of ${format(plan.targetAmount)}. There is no deadline on this one, so put in what you can.`
        : `${format(plan.currentBalance)} saved so far. Put in whatever you can, whenever you like.`;
  }
}

/** A short status word for the chip on the card. */
export function potStatusLabel(status: PotStatus): string {
  switch (status) {
    case 'funded':
      return 'All saved';
    case 'on_track':
      return 'On track';
    case 'behind':
      return 'Needs a top-up';
    case 'overdue':
      return 'Date has passed';
    case 'open_ended':
      return 'No deadline';
  }
}

function percent(balance: Minor, target: Minor): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, balance) / target) * 100));
}

/** Split a lump sum across pots that are behind, largest shortfall first. */
export function suggestCatchUp(plans: readonly PotPlan[], available: Minor): Map<string, Minor> {
  const behind = plans
    .filter((p) => p.stillNeededThisCycle > 0)
    .sort((a, b) => b.stillNeededThisCycle - a.stillNeededThisCycle);

  const result = new Map<string, Minor>();
  let left: number = Math.max(0, available);

  for (const plan of behind) {
    if (left <= 0) break;
    const give = Math.min(left, plan.stillNeededThisCycle);
    result.set(plan.envelopeId, minor(give));
    left -= give;
  }
  return result;
}

/** Proportion of a target reached, as basis points, for progress rings. */
export function fundedBasisPoints(plan: PotPlan): number {
  if (plan.targetAmount <= 0) return 0;
  return mulDivRound(minor(Math.max(0, plan.currentBalance)), 10_000, plan.targetAmount);
}
