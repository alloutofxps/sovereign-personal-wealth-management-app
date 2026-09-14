/* ===========================================================================
 * RUNNING A WHAT-IF AGAINST THE REAL ONE
 * ---------------------------------------------------------------------------
 * Two projections from the same starting cash: the one that is actually
 * happening, and the one where the sketch happened too. Everything else on
 * this screen is the difference between them.
 *
 * The hypothetical entries are laid over the real ledger by `branchView`,
 * which drops anything `checkBranch` refuses — a sketch dated into the real
 * past, or one that does not balance. What survives is turned into dated cash
 * movements the projection engine already understands.
 *
 * Nothing here writes. Nothing here reaches `entries` or `postings`. The only
 * thing that crosses from the branch tables into a figure is a number this
 * module worked out and labelled as imaginary.
 * ======================================================================== */

import { useCallback } from 'react';
import { minor, type Minor } from '@/core/money';
import { branchView, compare, type Branch, type BranchDifference } from '@/core/ledger/branching';
import type { JournalEntry, LedgerAccount } from '@/core/ledger';
import { project, type ProjectedEvent, type Projection } from '@/core/forecast';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import { BRANCH_TABLES, listBranchEntries, listBranches } from '@/data/repositories/branchesRepo';
import { accountsById } from '@/data/repositories/ledgerRepo';

export interface WhatIfData {
  branch: Branch;
  /** The line as things actually stand. */
  actual: Projection;
  /** The same line with the sketch in it. */
  branched: Projection;
  /** Where the two end up, side by side. */
  ending: BranchDifference;
  /** How many sketched events are actually being counted. */
  counted: number;
  /** How many were refused, and why — shown rather than swallowed. */
  refused: { entryId: string; message: string }[];
  events: ProjectedEvent[];
}

export const WHAT_IF_TABLES = [...BRANCH_TABLES, 'accounts', 'entries', 'postings'] as const;

/** Every what-if on file, most recent first. */
export function useBranches(): LiveQueryResult<Branch[]> {
  return useLiveQuery(useCallback(() => listBranches(), []), BRANCH_TABLES);
}

/**
 * What a sketch does to the next ninety days.
 *
 * @param actualEvents the real projected events, already worked out by the
 *                     forecast. Passed in rather than recomputed so the two
 *                     lines cannot disagree about what is really coming.
 */
export function useWhatIf(
  branchId: string | null,
  base: { today: string; days: number; startingCash: Minor; buffer: Minor } | null,
  actualEvents: readonly ProjectedEvent[],
): LiveQueryResult<WhatIfData | null> {
  /*
   * A key over the real events, so a re-render with an equal-but-new array
   * does not re-run a database read.
   *
   * All four fields, not two. It joined `date:amount`, and `name` and `kind`
   * both travel through `project()` into `ProjectionPoint.events` for the
   * tooltip — so renaming a bill without moving its date or amount left the
   * what-if labelling it with the old name.
   */
  const eventKey = actualEvents
    .map((e) => `${e.date}:${e.amount}:${e.kind}:${e.name}`)
    .join('|');

  const query = useCallback(async (): Promise<WhatIfData | null> => {
    if (branchId === null || base === null) return null;

    const [branches, sketches, accounts] = await Promise.all([
      listBranches(),
      listBranchEntries(branchId),
      accountsById(),
    ]);

    const branch = branches.find((candidate) => candidate.id === branchId);
    if (!branch) return null;

    // The real ledger is not needed to project cash — the forecast already
    // did that — so an empty history is passed and only the sketch's own
    // entries come back through. `branchView` still applies every refusal.
    const view = branchView([], branch, sketches);
    const accepted = new Set<string>(view.entries.map((entry) => String(entry.id)));

    const refused = sketches
      .filter((sketch) => !accepted.has(sketch.id))
      .map((sketch) => ({
        entryId: sketch.id,
        message: reasonRefused(sketch.date, branch),
      }));

    const events = view.entries.flatMap((entry) => toEvents(entry, accounts));

    const actual = project({ ...base, events: actualEvents });
    const branched = project({ ...base, events: [...actualEvents, ...events] });

    return {
      branch,
      actual,
      branched,
      ending: compare(actual.endBalance, branched.endBalance),
      counted: view.hypotheticalCount,
      refused,
      events,
    };
  }, [branchId, base?.today, base?.days, base?.startingCash, base?.buffer, eventKey]);

  return useLiveQuery(query, WHAT_IF_TABLES);
}

/**
 * What a sketched entry does to spendable cash, as a dated movement.
 *
 * Only lines against money the household could actually spend count. A sketch
 * that moves value between a pension and a house changes net worth and changes
 * nothing about the next ninety days of a current account, and showing it on a
 * cash line would be showing money that never arrives.
 */
function toEvents(
  entry: JournalEntry,
  accounts: ReadonlyMap<string, LedgerAccount>,
): ProjectedEvent[] {
  let cash = 0;
  for (const posting of entry.postings) {
    if (posting.book !== 'FINANCIAL') continue;
    const account = accounts.get(posting.accountId);
    if (!account || account.type !== 'ASSET' || !account.liquid || !account.onBudget) continue;
    cash += posting.baseAmount;
  }

  if (cash === 0) return [];

  return [
    {
      date: entry.date,
      name: entry.description,
      amount: minor(cash),
      kind: cash > 0 ? 'income' : 'bill',
    },
  ];
}

function reasonRefused(date: string, branch: Branch): string {
  return date < branch.divergesOn
    ? `Dated before this what-if starts, so it has not been counted. Everything before ${branch.divergesOn} is what actually happened.`
    : 'This one does not add up, so it has not been counted.';
}
