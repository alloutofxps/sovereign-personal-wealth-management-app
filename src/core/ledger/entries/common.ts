/* ===========================================================================
 * ENTRY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * Every builder funnels through `buildEntry`, which checks that each book
 * balances *before* it returns. An unbalanced JournalEntry therefore cannot be
 * constructed — the invariant engine in `invariants.ts` is a second line of
 * defence over stored data, not the only one.
 *
 * Builders are pure: they take ids and amounts and return an entry. They never
 * look anything up, generate a random id, or read a clock, so the same inputs
 * always produce byte-identical output and the tests can be exhaustive.
 * ======================================================================== */

import { ZERO, minor, type Minor } from '@/core/money';
import {
  LedgerError,
  type AccountId,
  type Book,
  type Clearance,
  type EntryId,
  type EntryKind,
  type IsoDate,
  type JournalEntry,
  type Posting,
  type PostingId,
} from '../types';

/** A posting before it is given an id and a place in the entry. */
export interface PostingSpec {
  book: Book;
  accountId: AccountId;
  /** Signed. Positive is a debit, negative is a credit. */
  amount: Minor;
  memo?: string;
  /** Overrides the entry-level clearance for this line only. */
  clearance?: Clearance;
}

/** Fields every builder accepts. */
export interface EntryBase {
  /** Supplied by the caller so builders stay pure and deterministic. */
  id: EntryId;
  date: IsoDate;
  /** Defaults to 'cleared'. Set 'pending' for a card authorisation. */
  clearance?: Clearance;
  sourceTransactionId?: string | null;
}

/** Record a debit: an increase in an asset or expense, or a reduction of a
 *  liability. */
export function debit(book: Book, accountId: AccountId, amount: Minor, memo?: string): PostingSpec {
  return memo === undefined
    ? { book, accountId, amount: assertPositive(amount) }
    : { book, accountId, amount: assertPositive(amount), memo };
}

/** Record a credit: a reduction of an asset, or an increase in a liability,
 *  income or envelope balance. */
export function credit(book: Book, accountId: AccountId, amount: Minor, memo?: string): PostingSpec {
  const negated = minor(-assertPositive(amount));
  return memo === undefined
    ? { book, accountId, amount: negated }
    : { book, accountId, amount: negated, memo };
}

function assertPositive(amount: Minor): Minor {
  if (amount <= 0) {
    throw new LedgerError(
      `An entry line must be a positive amount; the debit or credit direction ` +
        `carries the sign. Received ${amount}.`,
    );
  }
  return amount;
}

/**
 * Assemble and validate an entry.
 *
 * Throws if any book fails to balance, which means a bug in a builder can
 * never reach storage — it fails at the moment of construction, with the
 * offending book named.
 */
export function buildEntry(
  base: EntryBase,
  kind: EntryKind,
  description: string,
  specs: readonly PostingSpec[],
): JournalEntry {
  if (specs.length === 0) {
    throw new LedgerError('An entry must have at least one line.');
  }

  const defaultClearance: Clearance = base.clearance ?? 'cleared';

  const postings: Posting[] = specs.map((spec, index) => ({
    id: `${base.id}:${index}` as PostingId,
    entryId: base.id,
    book: spec.book,
    accountId: spec.accountId,
    amount: spec.amount,
    clearance: spec.clearance ?? defaultClearance,
    memo: spec.memo ?? null,
    sequence: index,
  }));

  assertBalanced(base.id, kind, postings);

  return {
    id: base.id,
    kind,
    date: base.date,
    description,
    postings,
    sourceTransactionId: base.sourceTransactionId ?? null,
    reversesEntryId: null,
    sealed: false,
  };
}

/** I1, enforced at construction: each book nets to zero on its own. */
export function assertBalanced(
  id: EntryId,
  kind: EntryKind,
  postings: readonly Posting[],
): void {
  for (const book of ['FINANCIAL', 'BUDGET'] as const) {
    const lines = postings.filter((p) => p.book === book);
    if (lines.length === 0) continue;

    if (lines.length < 2) {
      throw new LedgerError(
        `${kind} entry ${id} touches the ${book} book with only one line. ` +
          `Every movement needs somewhere it came from and somewhere it went.`,
      );
    }

    const total = lines.reduce((sum, p) => sum + p.amount, 0);
    if (total !== 0) {
      throw new LedgerError(
        `${kind} entry ${id} does not balance in the ${book} book: ` +
          `the lines total ${total} instead of 0.`,
      );
    }
  }
}

/**
 * Reverse a posted entry by appending its mirror image.
 *
 * A posted entry is never edited, so a correction is always visible as two
 * entries that cancel out. Both remain in the audit trail.
 */
export function reverseEntry(
  original: JournalEntry,
  id: EntryId,
  date: IsoDate,
  reason: string,
): JournalEntry {
  const postings: Posting[] = original.postings.map((p, index) => ({
    id: `${id}:${index}` as PostingId,
    entryId: id,
    book: p.book,
    accountId: p.accountId,
    amount: minor(-p.amount),
    clearance: p.clearance,
    memo: p.memo,
    sequence: index,
  }));

  assertBalanced(id, 'REVERSAL', postings);

  return {
    id,
    kind: 'REVERSAL',
    date,
    description: reason,
    postings,
    sourceTransactionId: original.sourceTransactionId,
    reversesEntryId: original.id,
    sealed: false,
  };
}

/** Guard for amounts arriving from outside the ledger. */
export function requirePositiveAmount(amount: Minor, what: string): Minor {
  if (!Number.isSafeInteger(amount)) {
    throw new LedgerError(`${what} must be a whole number of minor units.`);
  }
  if (amount <= 0) {
    throw new LedgerError(`${what} must be more than zero, received ${amount}.`);
  }
  return amount;
}

export const NO_AMOUNT = ZERO;
