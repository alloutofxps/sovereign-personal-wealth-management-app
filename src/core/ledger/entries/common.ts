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

import { IDENTITY_RATE, ZERO, minor, type Minor } from '@/core/money';
import {
  LedgerError,
  type AccountId,
  type Book,
  type Clearance,
  type SettableClearance,
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
  /** Signed, in the account's own currency. Positive is a debit. */
  amount: Minor;
  /**
   * The same line in the household's reporting currency.
   *
   * Omitted for anything already in the base currency, which is almost
   * everything — the builder then sets it equal to `amount` at a rate of one,
   * so a single-currency entry is byte-for-byte what it was before any of this
   * existed.
   */
  baseAmount?: Minor;
  /** Quote-per-base rate at 1e6. Defaults to exactly one. */
  fxRateScaled?: number;
  memo?: string;
  /** Overrides the entry-level clearance for this line only. */
  clearance?: SettableClearance;
}

/** Fields every builder accepts. */
export interface EntryBase {
  /** Supplied by the caller so builders stay pure and deterministic. */
  id: EntryId;
  date: IsoDate;
  /** Defaults to 'cleared'. Set 'pending' for a card authorisation. */
  clearance?: SettableClearance;
  sourceTransactionId?: string | null;
  /**
   * A note in the person's own words: "Sam's half", "warranty until 2029".
   *
   * Postings carry memos line by line, which is what splits will need later.
   * A note about the whole transaction has to live on one of those lines, so
   * it rides on the first — which every builder writes as the FINANCIAL line
   * saying what the money was actually for.
   */
  memo?: string;
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

  const defaultClearance: SettableClearance = base.clearance ?? 'cleared';

  const postings: Posting[] = specs.map((spec, index) => ({
    id: `${base.id}:${index}` as PostingId,
    entryId: base.id,
    book: spec.book,
    accountId: spec.accountId,
    amount: spec.amount,
    // Equal to the native amount at a rate of one unless a builder says
    // otherwise, so an entry in the base currency is exactly what it always
    // was and nothing downstream can tell the difference.
    baseAmount: spec.baseAmount ?? spec.amount,
    fxRateScaled: spec.fxRateScaled ?? IDENTITY_RATE,
    clearance: spec.clearance ?? defaultClearance,
    // Nothing is born locked. A line becomes locked only by being ticked off
    // against a statement that then balanced, which happens long after this.
    reconciledAt: null,
    // A line's own memo wins; the entry's note falls to the first line.
    memo: spec.memo ?? (index === 0 ? (base.memo ?? null) : null),
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

    // Balance is asserted on the reporting currency, because that is the only
    // figure every line of a cross-currency entry shares. €1,000 out and
    // $1,080 in is a correct transfer whose native amounts sum to 80; the
    // question "does this balance?" is only answerable once both sides are
    // expressed the same way.
    const total = lines.reduce((sum, p) => sum + p.baseAmount, 0);
    if (total !== 0) {
      throw new LedgerError(
        `${kind} entry ${id} does not balance in the ${book} book: ` +
          `the lines total ${total} instead of 0.`,
      );
    }

    // When every line of a book is in one currency the native amounts have to
    // balance as well — there is no conversion to explain a gap, so a gap is
    // simply a bug. This keeps the guarantee the single-currency ledger had.
    const oneCurrency = lines.every((p) => p.fxRateScaled === IDENTITY_RATE);
    if (oneCurrency) {
      const native = lines.reduce((sum, p) => sum + p.amount, 0);
      if (native !== 0) {
        throw new LedgerError(
          `${kind} entry ${id} does not balance in the ${book} book: ` +
            `the lines total ${native} instead of 0.`,
        );
      }
    }
  }
}

/**
 * The line that makes a converted entry balance to the penny.
 *
 * Converting each line at the same rate rounds each one on its own, so several
 * lines can land a unit apart from each other. Somebody has to carry that
 * unit, and the choice of who is the whole point: nudging it into the largest
 * line hides it, and dropping it breaks the books. It goes to a named equity
 * account instead, where it can be pointed at.
 *
 * The variance account is denominated in the base currency, so its native
 * amount *is* the residual — the brief specified `amount = 0` there, which the
 * `postings` table has refused since v1 (`CHECK (amount <> 0)`) and which would
 * anyway describe a line for nothing at all.
 */
export function fxResidualSpec(
  book: Book,
  varianceAccountId: AccountId,
  specs: readonly PostingSpec[],
): PostingSpec[] {
  const lines = specs.filter((s) => s.book === book);
  if (lines.length === 0) return [];

  const residual = -lines.reduce((sum, s) => sum + (s.baseAmount ?? s.amount), 0);
  if (residual === 0) return [];

  return [
    {
      book,
      accountId: varianceAccountId,
      amount: minor(residual),
      baseAmount: minor(residual),
      memo: 'The cent that converting could not place.',
    },
  ];
}

/* ===========================================================================
 * WHAT A LOCK PROTECTS
 * ======================================================================== */

/**
 * Refuse to change an entry somebody has checked against their bank.
 *
 * The point is not that the record is sacred. It is that the person went
 * through their statement line by line and confirmed this one, and the value
 * of having done that survives only as long as the answer cannot quietly
 * change afterwards. A ledger you have checked and can still edit by accident
 * is a ledger you have not checked.
 *
 * Pure, so the rule is testable, and so it can be applied where somebody tries
 * to edit rather than discovered somewhere deep in a write.
 */
export function assertNotReconciled(
  entry: Pick<JournalEntry, 'postings'>,
  /**
   * How to write the date this was locked on.
   *
   * Optional, and the default leaves the date out rather than printing an ISO
   * one. A caller that has the household's locale — a screen — passes a real
   * formatter; a caller that does not gets a sentence that is still a complete
   * sentence. Neither ever shows somebody a hyphenated timestamp.
   */
  describeDate?: (iso: string) => string,
): void {
  const locked = entry.postings.find(
    (posting) => posting.clearance === 'reconciled' || posting.reconciledAt !== null,
  );
  if (!locked) return;

  const when =
    describeDate && locked.reconciledAt
      ? ` on ${describeDate(locked.reconciledAt.slice(0, 10))}`
      : '';

  throw new LedgerError(
    `This payment was locked during your statement check${when}. Locked records cannot ` +
      `be edited or deleted. If it really is wrong, unlock that statement check first — ` +
      `the unlock is recorded, so the history still explains itself.`,
  );
}

/** Whether an entry carries a lock, without throwing about it. */
export function isReconciled(entry: Pick<JournalEntry, 'postings'>): boolean {
  return entry.postings.some(
    (posting) => posting.clearance === 'reconciled' || posting.reconciledAt !== null,
  );
}

/**
 * One state for a whole entry, from its lines.
 *
 * One locked line locks the entry, and it has to be `some` rather than
 * `every`. A payment touches two accounts and both books, and checking one
 * account's statement locks only that account's lines — but the entry cannot
 * be reversed without unwinding the locked one, so the guard in the ledger
 * refuses the whole thing. If this said `every`, the interface would offer an
 * Undo button on a payment the ledger will not undo, which is worse than not
 * offering it: the person is told they can, and then told they cannot.
 */
export function clearanceOf(postings: readonly Posting[]): Clearance {
  if (postings.length === 0) return 'cleared';
  if (postings.some((p) => p.clearance === 'reconciled')) return 'reconciled';
  if (postings.some((p) => p.clearance === 'pending')) return 'pending';
  return 'cleared';
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
    // Both sides, or a reversal would undo what the statement says while
    // leaving what you are worth exactly where it was. Invariant I10 checks
    // for precisely that.
    baseAmount: minor(-p.baseAmount),
    fxRateScaled: p.fxRateScaled,
    // A correction is a new line, and a new line has not been checked against
    // anything. The line it reverses keeps its own lock.
    clearance: p.clearance === 'reconciled' ? 'cleared' : p.clearance,
    reconciledAt: null,
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
