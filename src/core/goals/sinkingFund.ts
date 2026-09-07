/* ===========================================================================
 * POTS: SAVING UP FOR THINGS
 * ---------------------------------------------------------------------------
 * Irregular costs are what wreck an otherwise sensible month. Car insurance
 * once a year, a holiday in August, the boiler service — each one arrives as a
 * shock only because nothing was put by for it.
 *
 *   MonthlyAllocation = (Target − BalanceAtCycleStart) ÷ MonthsRemaining
 *
 * The figure is set once at the start of each month and holds for that whole
 * month, so paying in never moves the target you were paying towards. At
 * rollover it is worked out again from wherever the pot has actually reached:
 * fall behind and next month asks for more, get ahead and it asks for less.
 *
 * That is one of three shapes, and since v17 the pot says which it is rather
 * than having it guessed from whether a date happens to be set. See
 * `PotTargetKind` below.
 *
 * What this produces feeds straight into G_savings in the Safe-to-Spend
 * calculation: money that has to be put by is not money that is safe to spend,
 * whether or not it has physically moved yet.
 * ======================================================================== */

import { ZERO, minor, mulDivRound, type Minor } from '@/core/money';

export type PotStatus = 'funded' | 'on_track' | 'behind' | 'open_ended' | 'overdue';

/**
 * The three shapes a saving pot can have.
 *
 * These are genuinely different sums, not three labels on one:
 *
 *   by_date  MonthlyAllocation = (Target - BalanceAtCycleStart) / MonthsLeft
 *   monthly  MonthlyAllocation = Target, every month, for ever
 *   open     MonthlyAllocation = nothing. Put in what you can.
 *
 * A `monthly` pot is never "funded" — a fifty-a-month pot has not finished
 * when it reaches fifty, it has finished *this month*. Saying otherwise would
 * quietly stop holding the money back from the second month onwards.
 */
export type PotTargetKind = 'by_date' | 'monthly' | 'open';

export interface PotTarget {
  envelopeId: string;
  /** As the person named it: "Car insurance", "Holiday". */
  name: string;
  /** What needs to be there by the date. */
  targetAmount: Minor;
  /** What is in the pot right now. */
  currentBalance: Minor;
  /**
   * What kind of saving this is, and so which sum applies.
   *
   * Stored on the account since v17. Before that it was inferred from whether
   * `targetDate` happened to be null, which could not express the middle case
   * at all.
   */
  kind: PotTargetKind;
  /** 'YYYY-MM-DD'. Read only when `kind` is 'by_date'. */
  targetDate: string | null;
  /** True when it starts again once reached — an annual bill. */
  recurring: boolean;
  /** How much has been put into this pot during the current cycle. */
  assignedThisCycle: Minor;
  /**
   * What was in the pot when this month began.
   *
   * The month's target is worked out from this, not from the live balance.
   * Otherwise paying in would immediately lower the very figure it was
   * paying towards — you would put in the 85 you were asked for and be told
   * the month now wanted 77.92, which reads as though the goalposts moved
   * the moment you reached them.
   */
  balanceAtCycleStart: Minor;
}

export interface PotPlan extends PotTarget {
  /** Whole months from today to the target date. Never below one. */
  monthsRemaining: number;
  /**
   * This month's target. Fixed for the whole cycle, and recalculated at
   * rollover from wherever the pot has actually got to.
   */
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
  // The month's ask is set from where the pot stood when the month began.
  const outstandingAtCycleStart = minor(
    Math.max(0, target.targetAmount - target.balanceAtCycleStart),
  );

  // A fixed amount every month. The target is the monthly share rather than a
  // finishing line, so nothing here looks at the balance: what matters is what
  // has gone in *this* month, and next month asks for the same again.
  if (target.kind === 'monthly') {
    const putIn = minor(Math.max(0, target.assignedThisCycle));
    const stillNeededThisCycle = minor(Math.max(0, target.targetAmount - putIn));
    return {
      ...target,
      monthsRemaining: 0,
      monthlyAllocation: target.targetAmount,
      stillNeededThisCycle,
      // What is left to find is this month's share, not a lifetime total —
      // there is no lifetime total on a pot that never ends.
      outstanding: stillNeededThisCycle,
      status: stillNeededThisCycle === 0 ? 'on_track' : 'behind',
      percentFunded: percent(putIn, target.targetAmount),
    };
  }

  // No deadline, so nothing is *required* of any month. A pot whose kind says
  // 'by_date' but which has lost its date is treated the same way rather than
  // dividing by a month count it cannot work out.
  if (target.kind === 'open' || !target.targetDate) {
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

  const monthlyAllocation =
    // Once the whole target is met there is nothing more to ask for, even
    // mid-month — being asked to keep paying into a full pot would be absurd.
    funded
      ? ZERO
      : // Rounded up, so the last month never leaves a penny short.
        minor(Math.ceil(outstandingAtCycleStart / monthsRemaining));

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
  // A monthly pot has no finishing line, so none of the sentences below fit:
  // they all talk about what is left to find "in total", and on a pot that
  // starts again every month that phrase has no meaning.
  if (plan.kind === 'monthly') {
    return plan.stillNeededThisCycle === 0
      ? `${format(plan.monthlyAllocation)} goes into ${plan.name.toLowerCase()} every month, and this month's is in.`
      : plan.assignedThisCycle > 0
        ? `${format(plan.assignedThisCycle)} of this month's ${format(plan.monthlyAllocation)} has gone in. ${format(plan.stillNeededThisCycle)} to go.`
        : `${format(plan.monthlyAllocation)} goes into ${plan.name.toLowerCase()} every month. Tap to put this month's in.`;
  }

  switch (plan.status) {
    case 'funded':
      return plan.recurring
        ? `Fully saved. ${format(plan.targetAmount)} is ready for ${plan.name.toLowerCase()}, and it will start again once it is paid.`
        : `Fully saved. ${format(plan.targetAmount)} is ready whenever you need it.`;

    case 'on_track':
      return `${format(plan.monthlyAllocation)} was planned for this month and ${format(plan.assignedThisCycle)} has gone in. ${format(plan.outstanding)} still to find in total.`;

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
