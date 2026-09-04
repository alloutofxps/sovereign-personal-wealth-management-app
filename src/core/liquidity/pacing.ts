/* ===========================================================================
 * HOW FAST THE MONEY IS GOING
 * ---------------------------------------------------------------------------
 * Two percentages, side by side: how much of the cycle has passed, and how
 * much of the money has gone. Everything a person needs to know about their
 * pace is in the gap between those two numbers.
 *
 * There is no failure state here. Spending faster than planned produces a
 * calm sentence and a recalculated daily allowance, never a warning — the
 * research is unambiguous that punitive framing is what makes people stop
 * opening the app, and an app nobody opens cannot help anybody.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import { cycleDays, type Cycle } from './period';

/** Percentage points of slack before pace is worth mentioning at all. */
const TOLERANCE = 6;

export type PaceStatus = 'on_track' | 'ahead' | 'fast' | 'no_plan';

export interface PacingPoint {
  date: string;
  /** Cumulative spend up to and including this day. */
  cumulative: Minor;
  /** Where an even spread would have you by this day. */
  target: Minor;
  /** False for days that have not happened yet. */
  actual: boolean;
}

export interface PacingResult {
  status: PaceStatus;
  /** A complete sentence for the person to read. */
  message: string;
  /** 0-100. How far through the cycle we are. */
  elapsedPercent: number;
  /** 0-100. How much of the money has gone. Can exceed 100. */
  spentPercent: number;
  spent: Minor;
  /** Spent so far plus what is still safe to spend. */
  allowance: Minor;
  curve: PacingPoint[];
  cycle: Cycle;
}

export interface PacingInput {
  cycle: Cycle;
  /** Spending per day so far this cycle, keyed by 'YYYY-MM-DD'. */
  spendByDay: ReadonlyMap<string, Minor>;
  /** What is still safe to spend across the rest of the cycle. */
  remaining: Minor;
  today: string;
  /**
   * What to call this stretch of time. Defaults to a month, because that is
   * what most people budget in — but somebody paid fortnightly is not living
   * in months, and being told about "the month" would be being told about
   * somebody else's calendar.
   */
  periodNoun?: string;
}

export function calculatePacing(input: PacingInput): PacingResult {
  const days = cycleDays(input.cycle);

  // First pass: the running total, which only advances on days that have
  // actually happened. Future days hold the line flat at today's total.
  let running = 0;
  const cumulative = days.map((date) => {
    const isPast = date <= input.today;
    if (isPast) running += input.spendByDay.get(date) ?? 0;
    return { date, total: running, isPast };
  });

  const spent = minor(running);
  // The plan is what has gone plus what is still safe to go. It moves as the
  // month moves, which is the point: the allowance recalibrates rather than
  // a fixed budget being "blown".
  const allowance = minor(Math.max(0, spent + Math.max(0, input.remaining)));

  // Second pass: the even-spread line, which needs the allowance to exist.
  const curve: PacingPoint[] = cumulative.map((day, index) => ({
    date: day.date,
    cumulative: minor(day.total),
    target: minor(Math.round((allowance * (index + 1)) / input.cycle.totalDays)),
    actual: day.isPast,
  }));

  const elapsedPercent = round1((input.cycle.elapsedDays / input.cycle.totalDays) * 100);
  const spentPercent = allowance > 0 ? round1((spent / allowance) * 100) : 0;

  const { status, message } = describePace({
    elapsedPercent,
    spentPercent,
    allowance,
    spent,
    remainingDays: input.cycle.remainingDays,
    periodNoun: input.periodNoun ?? 'month',
  });

  return { status, message, elapsedPercent, spentPercent, spent, allowance, curve, cycle: input.cycle };
}

function describePace(input: {
  elapsedPercent: number;
  spentPercent: number;
  allowance: Minor;
  spent: Minor;
  remainingDays: number;
  periodNoun: string;
}): { status: PaceStatus; message: string } {
  if (input.allowance <= 0) {
    return {
      status: 'no_plan',
      message:
        'Once you have recorded a little spending, this will show you how your pace is going.',
    };
  }

  const gap = input.spentPercent - input.elapsedPercent;
  const daysWord = input.remainingDays === 1 ? 'day' : 'days';

  if (gap > TOLERANCE) {
    return {
      status: 'fast',
      message:
        `You are spending a bit faster than the ${input.periodNoun} is passing. ` +
        `There are ` +
        `${input.remainingDays} ${daysWord} to go, so the daily amount above has ` +
        `already been adjusted to fit.`,
    };
  }

  if (gap < -TOLERANCE) {
    return {
      status: 'ahead',
      message:
        `You are spending more slowly than the ${input.periodNoun} is passing, so ` +
        `there is a ` +
        `little more room than usual over the next ${input.remainingDays} ${daysWord}.`,
    };
  }

  return {
    status: 'on_track',
    message:
      `You are right on track with ${input.remainingDays} ${daysWord} of the ` +
      `${input.periodNoun} left.`,
  };
}

/** A short label for the pace, for the badge next to the bars. */
export function paceLabel(status: PaceStatus): string {
  switch (status) {
    case 'on_track':
      return 'Right on track';
    case 'ahead':
      return 'Ahead of plan';
    case 'fast':
      return 'Running a bit fast';
    case 'no_plan':
      return 'Nothing to compare yet';
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
