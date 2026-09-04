/* ===========================================================================
 * THE ROUND NUMBERS
 * ---------------------------------------------------------------------------
 * Nobody decided that €100,000 matters. It matters because it has a lot of
 * zeroes, and because the first time somebody crosses it they remember it. The
 * numbers here are arbitrary in exactly that way, and pretending otherwise
 * would be dishonest — so the copy says what was passed and when, and does not
 * dress it up as a financial achievement with a meaning of its own.
 *
 * What this deliberately does not do is set targets. A milestone is recorded
 * once it has already happened; there is no "you are 60% of the way to
 * €250,000", because that would turn a landmark somebody passed into a
 * scoreboard they are behind on. Software that makes people feel poor by
 * showing them how far they have to go is the thing this app exists not to be.
 *
 * Crossings are found in the history, not stored. Somebody who corrects an old
 * transaction should find the date they crossed €50,000 corrected too, rather
 * than keeping a milestone that the numbers no longer support.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import type { NetWorthPoint } from './netWorthHistory';

/**
 * The thresholds, in major units of the reporting currency.
 *
 * Deliberately not converted per currency. €100,000 and $100,000 are not the
 * same amount of money, but they are the same landmark to the person holding
 * them, and rounding a converted threshold would produce milestones at
 * €92,400, which is not a landmark at all.
 */
export const MILESTONE_MAJORS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

export interface Milestone {
  /** The threshold in minor units. */
  amount: Minor;
  /** How it is written: '€10k', '€1M'. Built by the caller's formatter. */
  major: number;
  /** 'YYYY-MM' the line first reached it, or null if it has not. */
  reachedMonth: string | null;
  /** The last day of that month. */
  reachedOn: string | null;
  /** How much of the window had passed. Null when never reached. */
  monthsFromStart: number | null;
}

/**
 * Which round numbers the line has passed, and when it first did.
 *
 * "First" is meant literally: somebody who crossed €50,000, dropped below it
 * buying a car, and crossed it again keeps the first date. The moment they
 * first got there is the one worth remembering, and re-dating it every time
 * the balance wobbles would make it worthless.
 */
export function findMilestones(
  points: readonly NetWorthPoint[],
  minorUnitsPerMajor = 100,
): Milestone[] {
  return MILESTONE_MAJORS.map((major) => {
    const amount = minor(major * minorUnitsPerMajor);
    const index = points.findIndex((point) => point.netWorth >= amount);
    const point = index >= 0 ? points[index] : undefined;

    return {
      amount,
      major,
      reachedMonth: point?.month ?? null,
      reachedOn: point?.asOf ?? null,
      monthsFromStart: index >= 0 ? index : null,
    };
  });
}

/** The ones already passed, most recent first. */
export function reachedMilestones(milestones: readonly Milestone[]): Milestone[] {
  return milestones.filter((m) => m.reachedMonth !== null).sort((a, b) => b.major - a.major);
}

/** The most recent one passed, which is the only one worth putting on a chart. */
export function latestMilestone(milestones: readonly Milestone[]): Milestone | null {
  return reachedMilestones(milestones)[0] ?? null;
}

/**
 * A round number written the way people say it.
 *
 * Uses the household's own formatter for the amount, so a currency is never
 * hardcoded — 'k' and 'M' are the only things added, and they are added to
 * whatever the formatter produced.
 */
export function describeMilestoneAmount(
  milestone: Milestone,
  format: (amount: Minor) => string,
): string {
  return format(milestone.amount);
}

/**
 * What passing it means, which is: it happened, and here is when.
 *
 * No congratulation beyond naming the fact. Somebody who inherited €100,000
 * and somebody who saved it over fifteen years see the same sentence, and
 * neither is told what to feel about it.
 */
export function describeMilestone(
  milestone: Milestone,
  format: (amount: Minor) => string,
  describeMonth: (isoDate: string) => string,
): string {
  if (!milestone.reachedOn) {
    return `${format(milestone.amount)} has not been passed yet.`;
  }
  return `You passed ${format(milestone.amount)} in ${describeMonth(milestone.reachedOn)}.`;
}
