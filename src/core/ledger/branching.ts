/* ===========================================================================
 * THE TIME MACHINE
 * ---------------------------------------------------------------------------
 * What if I took the job. What if we bought it. What if I cleared the card
 * first instead of the loan. These are the questions people actually have
 * about their money, and a ledger is the only honest way to answer them —
 * because the answer is not one number, it is what happens to everything.
 *
 * A branch is a set of hypothetical entries laid over the real ledger from a
 * date onwards. Read together they make a second, imaginary household you can
 * run every projection against; read apart, the real one is untouched.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE, AND THE THING THAT ENFORCES IT
 *
 * Hypothetical money must never reach a real total. Not the balance sheet, not
 * what is safe to spend, not a pot, not net worth, not for a moment while a
 * screen is loading.
 *
 * A flag on `entries` would have been the obvious design and it is the wrong
 * one: every query in this application would then need `WHERE branch_id IS
 * NULL`, and the first one anybody forgets is money that never existed showing
 * up in what somebody is worth. So branch entries are not in `entries` at all.
 * They live in their own table, their postings ride as JSON rather than as
 * rows in `postings`, and the guarantee is structural: there is no query over
 * the real ledger that *could* return one, however it is written.
 *
 * The cost is that a branch cannot be edited by the ordinary entry paths, and
 * that is a fair price. A branch is a sketch. The ledger is the record.
 *
 * ---------------------------------------------------------------------------
 * WHAT LIVES HERE
 *
 * Only the arithmetic of laying one over the other, and the checks that say
 * whether a sketch is coherent. Nothing in this file reads or writes anything.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import { assertBalanced } from './entries/common';
import { LedgerError, type EntryKind, type IsoDate, type JournalEntry, type Posting } from './types';

/** A named what-if, and the day it starts diverging from what happened. */
export interface Branch {
  id: string;
  /** As the person would say it: "If I took the Rotterdam job". */
  name: string;
  /**
   * Nothing before this date differs from the real ledger.
   *
   * A branch is not an alternative history — it is an alternative *future*.
   * Letting one rewrite last March would answer a question nobody asked and
   * quietly invalidate every statement check already made.
   */
  divergesOn: IsoDate;
  note: string | null;
  createdAt: string;
}

/** One hypothetical event. The same shape as a real entry, kept apart. */
export interface BranchEntry {
  id: string;
  branchId: string;
  kind: EntryKind;
  date: IsoDate;
  description: string;
  /** Postings, exactly as a real entry would have. Never stored in `postings`. */
  postings: Posting[];
}

export class BranchError extends Error {
  override name = 'BranchError';
}

/* ===========================================================================
 * IS THIS SKETCH COHERENT?
 * ======================================================================== */

export interface BranchProblem {
  entryId: string;
  message: string;
}

/**
 * Everything wrong with a branch, rather than the first thing.
 *
 * A sketch is built up over several sittings and it is normal for it to be
 * temporarily incoherent. Refusing at the first fault and saying nothing about
 * the rest would make fixing it a guessing game, so this collects.
 */
export function checkBranch(branch: Branch, entries: readonly BranchEntry[]): BranchProblem[] {
  const problems: BranchProblem[] = [];

  for (const entry of entries) {
    if (entry.branchId !== branch.id) {
      problems.push({
        entryId: entry.id,
        message: 'This belongs to a different what-if, so it has not been counted.',
      });
      continue;
    }

    // The rule that keeps a branch a future rather than a rewrite.
    if (entry.date < branch.divergesOn) {
      problems.push({
        entryId: entry.id,
        message:
          `This is dated before ${branch.divergesOn}, which is where this what-if starts. ` +
          `Everything before that is what actually happened.`,
      });
    }

    // The same balance rule as a real entry, and deliberately the same
    // function: a sketch that does not balance is not a sketch of anything.
    try {
      assertBalanced(entry.id as JournalEntry['id'], entry.kind, entry.postings);
    } catch (error) {
      problems.push({
        entryId: entry.id,
        message: error instanceof LedgerError ? error.message : 'This one does not add up.',
      });
    }
  }

  return problems;
}

/* ===========================================================================
 * LAYING ONE OVER THE OTHER
 * ======================================================================== */

export interface BranchView {
  /** Real entries up to the divergence, then real and hypothetical together. */
  entries: JournalEntry[];
  /** How many of them are imagined. Shown wherever the view is. */
  hypotheticalCount: number;
  /** The date from which the two histories differ. */
  divergesOn: IsoDate;
}

/**
 * The imaginary household, as a list of entries a projection can read.
 *
 * Real entries are taken whole — a branch adds to history, it does not edit
 * it. That is what makes the answer trustworthy: whatever the projection says
 * about the branch, the part before the divergence is the same ledger that
 * produced the figures on the home screen.
 *
 * Returns plain entries rather than anything that could be saved. There is no
 * function here that writes, and there is deliberately no way to turn a
 * `BranchView` back into something `saveEntry` would accept.
 */
export function branchView(
  real: readonly JournalEntry[],
  branch: Branch,
  hypothetical: readonly BranchEntry[],
): BranchView {
  const problems = checkBranch(branch, hypothetical);
  const refused = new Set(problems.map((problem) => problem.entryId));

  const imagined: JournalEntry[] = hypothetical
    .filter((entry) => !refused.has(entry.id))
    .map((entry) => ({
      id: entry.id as JournalEntry['id'],
      kind: entry.kind,
      date: entry.date,
      description: entry.description,
      postings: entry.postings,
      sourceTransactionId: null,
      reversesEntryId: null,
      sealed: false,
    }));

  const entries = [...real, ...imagined].sort((a, b) => a.date.localeCompare(b.date));

  return {
    entries,
    hypotheticalCount: imagined.length,
    divergesOn: branch.divergesOn,
  };
}

/* ===========================================================================
 * WHAT IT CHANGES
 * ======================================================================== */

export interface BranchDifference {
  /** The figure as things actually stand. */
  actual: Minor;
  /** The same figure in the what-if. */
  branched: Minor;
  /** Branched less actual. Negative means the what-if leaves you worse off. */
  difference: Minor;
}

/**
 * Two figures side by side.
 *
 * Deliberately not "the answer". A what-if that leaves somebody eleven
 * thousand better off in four years may still be the wrong choice, and this
 * module has no standing to say which — it puts the two numbers next to each
 * other and stops.
 */
export function compare(actual: Minor, branched: Minor): BranchDifference {
  return { actual, branched, difference: minor(branched - actual) };
}

/**
 * The comparison, in a sentence.
 *
 * Says which is which and by how much, and offers no verdict. "Better off" is
 * about money only, and the whole reason somebody is modelling a job in
 * another city is that money is not the only thing in it.
 */
export function describeDifference(
  result: BranchDifference,
  name: string,
  format: (amount: Minor) => string,
): string {
  if (result.difference === 0) {
    return `${name} comes out exactly the same as things stand today.`;
  }

  const size = format(minor(Math.abs(result.difference)));

  return result.difference > 0
    ? `${name} leaves you ${size} ahead of where you are now: ${format(result.branched)} against ${format(result.actual)}. Whether that makes it the right call is not a question this can answer.`
    : `${name} leaves you ${size} behind where you are now: ${format(result.branched)} against ${format(result.actual)}. That is the money only, and money is rarely the whole of it.`;
}

/**
 * A short label for a branch, for a chip or a tab.
 *
 * Always says it is a what-if. A branch figure that could be mistaken for a
 * real one, even for a second, is the failure this whole design exists to
 * prevent — and structure alone does not stop somebody misreading a screen.
 */
export function branchLabel(branch: Branch): string {
  return `What if: ${branch.name}`;
}
