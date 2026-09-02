/* ===========================================================================
 * THE INVARIANT ENGINE — I1 to I10
 * ---------------------------------------------------------------------------
 * Ten properties that must hold over the whole journal, written as executable
 * checks rather than as comments. They run in the property tests over randomly
 * generated sequences of entries, and they will run again as database triggers
 * once storage exists in Phase 4.
 *
 * Three of the ten were written in the Phase 1 draft against a multi-currency
 * ledger with an ingestion layer. v1 has neither, so they are stated here in
 * the strongest form the current model can actually enforce, and each says
 * plainly what it becomes later:
 *
 *   I2   was "the FX residual is posted explicitly".
 *        Now: every amount is an exact integer in the one ledger currency.
 *   I3   was "split amounts sum to the parent transaction".
 *        Now: every entry is structurally well formed against the chart.
 *   I10  was "an FX round trip drifts by at most one minor unit".
 *        Now: an entry and its reversal cancel exactly, on every account.
 *
 * Violation messages are user-facing. If one of these ever fires in front of
 * a person, they should be able to read it and understand what is wrong with
 * their books without knowing what a posting is.
 * ======================================================================== */

import { type Minor } from '@/core/money';
import { allRawBalances, bookTotal, totalWhere } from './balances';
import {
  BOOK_BY_TYPE,
  LedgerError,
  type AccountId,
  type Book,
  type EntryId,
  type JournalEntry,
  type LedgerSnapshot,
} from './types';

export type InvariantCode =
  | 'I1' | 'I2' | 'I3' | 'I4' | 'I5'
  | 'I6' | 'I7' | 'I8' | 'I9' | 'I10';

export interface InvariantViolation {
  code: InvariantCode;
  /** A short name for the rule, for logs and the audit screen. */
  rule: string;
  /** A complete sentence explaining what is wrong, in plain English. */
  message: string;
  entryId?: EntryId;
  accountId?: AccountId;
  observed?: number;
  expected?: number;
}

type Check = (snapshot: LedgerSnapshot) => InvariantViolation[];

/* --- I1: both books balance, on every single entry ---------------------- */

const i1: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  for (const entry of snapshot.entries) {
    for (const book of ['FINANCIAL', 'BUDGET'] as Book[]) {
      const lines = entry.postings.filter((p) => p.book === book);
      if (lines.length === 0) continue;
      const total = lines.reduce((sum, p) => sum + p.amount, 0);
      if (total !== 0) {
        violations.push({
          code: 'I1',
          rule: 'Every entry balances in every book',
          message:
            `"${entry.description}" does not add up. The money going in and the money ` +
            `coming out differ by ${Math.abs(total)}, so this record is incomplete.`,
          entryId: entry.id,
          observed: total,
          expected: 0,
        });
      }
    }
  }
  return violations;
};

/* --- I2: exact integers, one currency ----------------------------------- */

const i2: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  for (const entry of snapshot.entries) {
    for (const posting of entry.postings) {
      if (!Number.isSafeInteger(posting.amount)) {
        violations.push({
          code: 'I2',
          rule: 'Amounts are exact whole numbers',
          message:
            `An amount in "${entry.description}" is not a whole number of pence, ` +
            `which means it can no longer be relied on to the penny.`,
          entryId: entry.id,
          accountId: posting.accountId,
          observed: posting.amount,
        });
      }
      if (posting.amount === 0) {
        violations.push({
          code: 'I2',
          rule: 'Amounts are exact whole numbers',
          message: `"${entry.description}" contains a line for nothing at all.`,
          entryId: entry.id,
          accountId: posting.accountId,
        });
      }
    }
  }
  return violations;
};

/* --- I3: entries are well formed against the chart of accounts ---------- */

const i3: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  for (const entry of snapshot.entries) {
    const booksTouched = new Set(entry.postings.map((p) => p.book));

    for (const book of booksTouched) {
      const lines = entry.postings.filter((p) => p.book === book);
      if (lines.length < 2) {
        violations.push({
          code: 'I3',
          rule: 'Every movement has two sides',
          message:
            `"${entry.description}" records money moving without saying where it ` +
            `came from or where it went.`,
          entryId: entry.id,
        });
      }
    }

    for (const posting of entry.postings) {
      const account = snapshot.accounts.get(posting.accountId);
      if (!account) {
        violations.push({
          code: 'I3',
          rule: 'Every line points at a real account',
          message: `"${entry.description}" refers to an account that no longer exists.`,
          entryId: entry.id,
          accountId: posting.accountId,
        });
        continue;
      }
      if (BOOK_BY_TYPE[account.type] !== posting.book) {
        violations.push({
          code: 'I3',
          rule: 'Every line points at a real account',
          message:
            `"${entry.description}" files ${account.name} under the wrong set of books.`,
          entryId: entry.id,
          accountId: posting.accountId,
        });
      }
    }
  }
  return violations;
};

/* --- I4: budgetable cash mirrors real spendable money ------------------- */

const i4: Check = (snapshot) => {
  const budgetable = totalWhere(snapshot, (a) => a.type === 'BUDGETABLE_CASH');
  const liquid = totalWhere(snapshot, (a) => a.type === 'ASSET' && a.onBudget && a.liquid);

  if (budgetable === liquid) return [];
  return [
    {
      code: 'I4',
      rule: 'Budgeted money matches money you actually have',
      message:
        `The amount your budget thinks you have does not match what is really in ` +
        `your everyday accounts. They differ by ${Math.abs(budgetable - liquid)}.`,
      observed: budgetable,
      expected: liquid,
    },
  ];
};

/* --- I5: every penny is either in a pot or waiting to be given a job ---- */

const i5: Check = (snapshot) => {
  const cash = totalWhere(snapshot, (a) => a.type === 'BUDGETABLE_CASH');
  const envelopes = totalWhere(snapshot, (a) => a.type === 'ENVELOPE');
  const readyToAssign = totalWhere(snapshot, (a) => a.type === 'READY_TO_ASSIGN');

  // Envelopes and Ready-to-Assign hold credit balances, so a consistent
  // budget book nets to exactly zero against budgetable cash.
  const total = cash + envelopes + readyToAssign;
  if (total === 0) return [];
  return [
    {
      code: 'I5',
      rule: 'Every penny is accounted for',
      message:
        `${Math.abs(total)} is unaccounted for: the money in your pots plus the money ` +
        `still waiting to be given a job does not add up to what you have.`,
      observed: total,
      expected: 0,
    },
  ];
};

/* --- I6, I7, I8: what does and does not count as spending --------------- */

function contributionOf(
  snapshot: LedgerSnapshot,
  entries: readonly JournalEntry[],
  type: 'EXPENSE' | 'INCOME',
): Minor {
  return totalWhere({ ...snapshot, entries }, (a) => a.type === type);
}

const i6: Check = (snapshot) => {
  const neutral = snapshot.entries.filter(
    (e) => e.kind === 'TRANSFER' || e.kind === 'CC_PAYMENT',
  );
  const spending = contributionOf(snapshot, neutral, 'EXPENSE');
  const income = contributionOf(snapshot, neutral, 'INCOME');

  const violations: InvariantViolation[] = [];
  if (spending !== 0) {
    violations.push({
      code: 'I6',
      rule: 'Moving your own money is not spending',
      message:
        `Moving money between your accounts, or paying off a card, has been counted ` +
        `as spending. That would show ${Math.abs(spending)} you have not actually spent.`,
      observed: spending,
      expected: 0,
    });
  }
  if (income !== 0) {
    violations.push({
      code: 'I6',
      rule: 'Moving your own money is not income',
      message:
        `Moving money between your accounts has been counted as money coming in, ` +
        `which would make your income look ${Math.abs(income)} higher than it is.`,
      observed: income,
      expected: 0,
    });
  }
  return violations;
};

const i7: Check = (snapshot) => {
  const fronted = snapshot.entries.filter(
    (e) => e.kind === 'REIMBURSABLE' || e.kind === 'REIMBURSEMENT',
  );
  const spending = contributionOf(snapshot, fronted, 'EXPENSE');
  const income = contributionOf(snapshot, fronted, 'INCOME');

  const violations: InvariantViolation[] = [];
  if (spending !== 0) {
    violations.push({
      code: 'I7',
      rule: 'Money you fronted is not your spending',
      message:
        `Money you paid out for someone else has been counted as your own spending. ` +
        `That would overstate what you spent by ${Math.abs(spending)}.`,
      observed: spending,
      expected: 0,
    });
  }
  if (income !== 0) {
    violations.push({
      code: 'I7',
      rule: 'Being paid back is not income',
      message:
        `Being paid back has been counted as money you earned. Getting your own money ` +
        `returned is not income, and this would overstate it by ${Math.abs(income)}.`,
      observed: income,
      expected: 0,
    });
  }
  return violations;
};

const i8: Check = (snapshot) => {
  const refunds = snapshot.entries.filter((e) => e.kind === 'REFUND');
  const income = contributionOf(snapshot, refunds, 'INCOME');
  const spending = contributionOf(snapshot, refunds, 'EXPENSE');

  const violations: InvariantViolation[] = [];
  if (income !== 0) {
    violations.push({
      code: 'I8',
      rule: 'A refund is not income',
      message:
        `A refund has been counted as money you earned. It should reduce what you ` +
        `spent instead, or your income looks ${Math.abs(income)} higher than it is.`,
      observed: income,
      expected: 0,
    });
  }
  if (spending > 0) {
    violations.push({
      code: 'I8',
      rule: 'A refund reduces what you spent',
      message: `A refund has increased what you spent rather than reducing it.`,
      observed: spending,
    });
  }
  return violations;
};

/* --- I9, I10: corrections are appended, and cancel exactly -------------- */

const i9: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  const byId = new Map(snapshot.entries.map((e) => [e.id, e]));
  const reversedTargets = new Set<EntryId>();

  for (const entry of snapshot.entries) {
    if (!entry.reversesEntryId) continue;

    const original = byId.get(entry.reversesEntryId);
    if (!original) {
      violations.push({
        code: 'I9',
        rule: 'Corrections point at what they correct',
        message: `A correction refers to a record that is no longer there.`,
        entryId: entry.id,
      });
      continue;
    }

    if (reversedTargets.has(original.id)) {
      violations.push({
        code: 'I9',
        rule: 'A record is only corrected once',
        message:
          `"${original.description}" has been cancelled more than once, which would ` +
          `remove the same amount twice.`,
        entryId: entry.id,
      });
    }
    reversedTargets.add(original.id);

    if (original.postings.length !== entry.postings.length) {
      violations.push({
        code: 'I9',
        rule: 'A correction mirrors the original exactly',
        message: `The correction to "${original.description}" does not match it line for line.`,
        entryId: entry.id,
      });
    }
  }
  return violations;
};

const i10: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  const byId = new Map(snapshot.entries.map((e) => [e.id, e]));

  for (const entry of snapshot.entries) {
    if (!entry.reversesEntryId) continue;
    const original = byId.get(entry.reversesEntryId);
    if (!original) continue;

    const pair: LedgerSnapshot = { ...snapshot, entries: [original, entry] };
    for (const [accountId, balance] of allRawBalances(pair)) {
      if (balance !== 0) {
        violations.push({
          code: 'I10',
          rule: 'A cancelled record leaves nothing behind',
          message:
            `Cancelling "${original.description}" left ${Math.abs(balance)} behind on one ` +
            `of your accounts, so the correction did not fully undo it.`,
          entryId: entry.id,
          accountId,
          observed: balance,
          expected: 0,
        });
      }
    }
  }
  return violations;
};

/* --- the suite ----------------------------------------------------------- */

export const INVARIANTS: Record<InvariantCode, Check> = {
  I1: i1,
  I2: i2,
  I3: i3,
  I4: i4,
  I5: i5,
  I6: i6,
  I7: i7,
  I8: i8,
  I9: i9,
  I10: i10,
};

/** Run every rule. An empty array means the books are sound. */
export function checkInvariants(snapshot: LedgerSnapshot): InvariantViolation[] {
  return (Object.keys(INVARIANTS) as InvariantCode[]).flatMap((code) =>
    INVARIANTS[code](snapshot),
  );
}

/** Run one rule by name. Used by the tests to isolate failures. */
export function checkInvariant(
  code: InvariantCode,
  snapshot: LedgerSnapshot,
): InvariantViolation[] {
  return INVARIANTS[code](snapshot);
}

/** Throw on the first problem. For use at a write boundary. */
export function assertInvariants(snapshot: LedgerSnapshot): void {
  const violations = checkInvariants(snapshot);
  if (violations.length > 0) {
    const first = violations[0]!;
    throw new LedgerError(
      `${first.code} (${first.rule}): ${first.message}` +
        (violations.length > 1 ? ` — and ${violations.length - 1} more.` : ''),
    );
  }
}

/** Convenience: does the whole of each book net to zero? */
export function booksBalance(snapshot: LedgerSnapshot): boolean {
  return bookTotal(snapshot, 'FINANCIAL') === 0 && bookTotal(snapshot, 'BUDGET') === 0;
}
