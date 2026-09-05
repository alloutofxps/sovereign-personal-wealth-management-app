/* ===========================================================================
 * IS THIS POT GOING TO LAST THE MONTH?
 * ---------------------------------------------------------------------------
 * The app already answers this for the household as a whole. It has never
 * answered it for one pot, which is where the question actually gets asked:
 * nobody wonders whether they are overspending in general, they wonder whether
 * there is enough left for dinner out on Friday.
 *
 * The comparison is between two fractions, both in basis points:
 *
 *     how much of the money is gone   vs   how much of the period is gone
 *
 * Eighty per cent spent on the tenth of the month is worth a word. Eighty per
 * cent spent on the twenty-eighth is simply somebody using their budget, and
 * saying anything about it would be nagging.
 *
 * The tone stops at amber. There is no red here and there is not going to be:
 * spending your own money faster than a calendar is not a moral failure, and
 * an app that shouts at somebody in week three teaches them to stop opening it
 * in week three.
 * ======================================================================== */

import { minor, mulDivRound, type Minor } from '@/core/money';

export type PaceStatus = 'unbudgeted' | 'unspent' | 'under_pace' | 'on_pace' | 'ahead_of_pace';

export interface EnvelopePace {
  /** How much of what was assigned has been spent, in basis points. */
  spentPercentBp: number;
  /** How much of the period has passed, in basis points. Echoed back. */
  periodProgressBp: number;
  /**
   * Spending minus time, in basis points.
   *
   * Positive means the money is going faster than the month. This is the
   * figure the bar is drawn from and the one worth reading.
   */
  paceDeltaBp: number;
  status: PaceStatus;
  /** True when the pot is already empty or overspent. */
  exhausted: boolean;
}

/**
 * How far ahead of the calendar spending has to be before it is worth saying.
 *
 * Fifteen points. Below that the difference is noise — a weekly shop landing
 * on a Tuesday rather than a Thursday moves a food budget by more than this —
 * and flagging noise is how an indicator becomes something people stop seeing.
 */
export const AHEAD_NOTICE_BP = 1_500;

/** And the same margin the other way, before calling something comfortable. */
export const UNDER_NOTICE_BP = 1_500;

export interface EnvelopePaceInput {
  /** What was given to this pot for the period. */
  assignedMinor: Minor;
  /** What has gone out of it. Positive: 4000 means forty pounds spent. */
  activityMinor: Minor;
  /** How much of the period has elapsed, 0 to 10,000. */
  periodProgressBp: number;
}

/**
 * Where one pot stands against the calendar.
 *
 * Pure integer arithmetic, so a pacing bar and the figure beside it can never
 * disagree about the same pot.
 */
export function envelopePace(input: EnvelopePaceInput): EnvelopePace {
  const progress = clamp(input.periodProgressBp, 0, 10_000);
  const spent = minor(Math.max(0, input.activityMinor));

  // Nothing assigned: there is no fraction to take, and dividing by nothing
  // would be a percentage of an empty promise. A pot with spending and no
  // budget is a real situation and it is named rather than scored.
  if (input.assignedMinor <= 0) {
    return {
      spentPercentBp: 0,
      periodProgressBp: progress,
      paceDeltaBp: 0,
      status: 'unbudgeted',
      exhausted: spent > 0,
    };
  }

  const spentPercentBp = mulDivRound(spent, 10_000, input.assignedMinor);
  const paceDeltaBp = spentPercentBp - progress;

  const status: PaceStatus =
    spent === 0
      ? 'unspent'
      : paceDeltaBp >= AHEAD_NOTICE_BP
        ? 'ahead_of_pace'
        : paceDeltaBp <= -UNDER_NOTICE_BP
          ? 'under_pace'
          : 'on_pace';

  return {
    spentPercentBp,
    periodProgressBp: progress,
    paceDeltaBp,
    status,
    // From the amounts, never from the rounded percentage. One cent short of
    // empty rounds to 100% — half away from zero — and calling that "spent"
    // would put a pot with money left in it under a spent-pot sentence.
    exhausted: spent >= input.assignedMinor,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The pace, said in words.
 *
 * States the two fractions and stops. It does not tell anybody to slow down —
 * the whole point of assigning money to a pot is that spending it is allowed —
 * and it does not congratulate anybody for underspending, because there is
 * nothing admirable about not eating.
 */
export function describePace(pace: EnvelopePace, name: string): string {
  const spent = Math.round(pace.spentPercentBp / 100);
  const gone = Math.round(pace.periodProgressBp / 100);

  switch (pace.status) {
    case 'unbudgeted':
      return pace.exhausted
        ? `${name} has money going out of it but nothing given to it yet.`
        : `${name} has nothing given to it yet.`;
    case 'unspent':
      return `Nothing spent from ${name} yet, with ${gone}% of the period gone.`;
    case 'ahead_of_pace':
      return pace.exhausted
        ? `${name} is spent, with ${100 - gone}% of the period still to go.`
        : `${spent}% of ${name} is spent, with ${gone}% of the period gone.`;
    case 'under_pace':
      return `${spent}% of ${name} is spent, with ${gone}% of the period gone.`;
    case 'on_pace':
      return `${name} is going about as fast as the period is.`;
  }
}

/**
 * Which of the app's two safe tones this deserves.
 *
 * Never 'deficit'. The clay tone means something has gone wrong; a pot being
 * spent faster than a calendar has not gone wrong, it is just worth seeing.
 */
export function paceTone(pace: EnvelopePace): 'liquid' | 'caution' | 'neutral' {
  if (pace.status === 'ahead_of_pace') return 'caution';
  if (pace.status === 'under_pace' || pace.status === 'unspent') return 'liquid';
  return 'neutral';
}
