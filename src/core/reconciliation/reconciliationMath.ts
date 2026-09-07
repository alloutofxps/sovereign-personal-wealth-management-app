/* ===========================================================================
 * CHECKING THE BOOKS AGAINST THE BANK
 * ---------------------------------------------------------------------------
 * The arithmetic is trivial and the point is not the arithmetic.
 *
 *     what the bank says  −  what has gone through here  =  the difference
 *
 * What matters is that the difference is exact. Not "about right", not "within
 * a euro" — exactly nothing, or a named amount somebody can go and find. A
 * reconciliation that tolerates a few cents is not a reconciliation; it is a
 * feeling, and the whole reason anybody does this is to stop having to rely on
 * a feeling about their own money.
 *
 * Pending lines are deliberately left out. The bank has not finalised them, so
 * the statement cannot contain them, and counting them would guarantee a
 * difference on every single check. They still come off what is safe to spend
 * — the money is gone in every sense that matters to the person who spent it —
 * but that is a different question from what the bank has settled.
 *
 * Everything here is pure integer arithmetic over a list. No database, no
 * React, no clock. That is what lets the property tests throw a hundred
 * generated account states at it.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

/** One line, reduced to what a statement check needs from it. */
export interface ReconcilableLine {
  postingId: string;
  entryId: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  /** Signed minor units, in the account's own currency. */
  amount: Minor;
  description: string;
  /** Whether the bank has settled it, and whether it is already locked. */
  clearance: 'pending' | 'cleared' | 'reconciled';
}

export type ReconciliationStatus = 'balanced' | 'unbalanced';

export interface ReconciliationState {
  /** Everything the bank has settled, up to and including the statement date. */
  clearedBalance: Minor;
  /** What has been spent but has not gone through yet. */
  unclearedBalance: Minor;
  /** What the bank says, as typed off the statement. */
  statementBalance: Minor;
  /**
   * The bank's figure less ours.
   *
   * Positive means the bank has more than we have accounted for — usually
   * something that arrived and was never recorded. Negative means we have more
   * than the bank — usually something recorded twice, or ticked off too soon.
   */
  discrepancy: Minor;
  status: ReconciliationStatus;
  /** How many lines are ticked, and how many are not. */
  clearedCount: number;
  pendingCount: number;
  /** How many would be locked by finishing. */
  lockedCount: number;
}

/**
 * What has gone through, up to a date.
 *
 * Both 'cleared' and 'reconciled' count: a line locked by last month's check
 * is still money that left the account, and dropping it would make every
 * check after the first one fail by the whole of the previous statement.
 */
export function clearedBalanceOf(lines: readonly ReconcilableLine[], asOf: string): Minor {
  let total = 0;
  for (const line of lines) {
    if (line.date > asOf) continue;
    if (line.clearance === 'pending') continue;
    total += line.amount;
  }
  return minor(total);
}

/** What has been recorded but has not gone through, up to a date. */
export function unclearedBalanceOf(lines: readonly ReconcilableLine[], asOf: string): Minor {
  let total = 0;
  for (const line of lines) {
    if (line.date > asOf) continue;
    if (line.clearance !== 'pending') continue;
    total += line.amount;
  }
  return minor(total);
}

/**
 * Where the check currently stands.
 *
 * Recomputed from scratch on every tick rather than adjusted incrementally.
 * An incremental total drifts the moment a tap is missed or applied twice, and
 * the one thing this screen cannot afford is a difference that is wrong.
 */
export function reconciliationState(input: {
  lines: readonly ReconcilableLine[];
  statementBalance: Minor;
  statementDate: string;
}): ReconciliationState {
  const inScope = input.lines.filter((line) => line.date <= input.statementDate);

  const clearedBalance = clearedBalanceOf(inScope, input.statementDate);
  const unclearedBalance = unclearedBalanceOf(inScope, input.statementDate);
  const discrepancy = minor(input.statementBalance - clearedBalance);

  const clearedCount = inScope.filter((l) => l.clearance !== 'pending').length;

  return {
    clearedBalance,
    unclearedBalance,
    statementBalance: input.statementBalance,
    discrepancy,
    status: discrepancy === 0 ? 'balanced' : 'unbalanced',
    clearedCount,
    pendingCount: inScope.length - clearedCount,
    // Already-locked lines are not locked again, so the number quoted in the
    // confirmation is the number that will actually change.
    lockedCount: inScope.filter((l) => l.clearance === 'cleared').length,
  };
}

/* ===========================================================================
 * SAYING WHERE IT STANDS
 * ======================================================================== */

/**
 * The banner sentence.
 *
 * When it balances, it says so and stops.
 *
 * When it does not, it says which way the gap runs and offers both of the
 * things that cause it, in the order they usually happen. It deliberately does
 * not pick one. An account can be overdrawn, so "the bank has more than you"
 * and "you have ticked more than the bank" are not the same as "money is
 * missing" or "money is extra" — and a sentence that asserts the wrong cause
 * sends somebody hunting through the one place the problem is not.
 */
export function describeDifference(
  state: ReconciliationState,
  format: (amount: Minor) => string,
): string {
  if (state.status === 'balanced') {
    return 'Everything matches to the exact penny.';
  }

  const amount = format(minor(Math.abs(state.discrepancy)));

  return state.discrepancy > 0
    ? `Your bank's figure is ${amount} higher than what you have ticked. Either something ` +
        `that came in has not been recorded here, or something ticked off has not really ` +
        `gone through yet.`
    : `Your bank's figure is ${amount} lower than what you have ticked. Either something ` +
        `that went out has not been recorded here, or something has been counted twice.`;
}

/** What finishing will do, said before it is done. */
export function describeLock(count: number): string {
  if (count === 0) {
    return 'There is nothing new to lock. Everything up to this date is already checked.';
  }
  return (
    `This will lock ${count} ${count === 1 ? 'payment' : 'payments'}. ` +
    `Locked records cannot be edited accidentally.`
  );
}

/**
 * What a lock means, said where somebody meets one.
 *
 * Names the date, because "locked" without a reason reads like the app being
 * difficult. With the date it reads as a record of something the person did.
 *
 * `describeWhen` supplies the whole phrase — "today", "on 15 January" — rather
 * than a bare label, because the preposition depends on the answer and this
 * module has no way to know which one it got.
 */
export function describeLocked(
  reconciledAt: string,
  describeWhen: (iso: string) => string,
): string {
  return (
    `Locked during your statement check ${describeWhen(reconciledAt.slice(0, 10))}. ` +
    `Locked records cannot be edited or deleted.`
  );
}
