/* ===========================================================================
 * TURNING AN ENTRY INTO SOMETHING A PERSON READS
 * ---------------------------------------------------------------------------
 * A journal entry is a set of postings across two books. A row on a screen is
 * a merchant, an amount, a category and an account. This is the translation,
 * written once so the list and the detail sheet can never disagree about what
 * a payment was worth or which way it went.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import { clearanceOf, type AccountId, type Clearance, type EntryKind, type LedgerAccount } from '@/core/ledger';
import type { EntryWithPostings } from '@/data/repositories/ledgerRepo';

/** Which way the money went, which decides how the figure is coloured. */
export type Direction = 'out' | 'in' | 'neutral';

export interface PresentedLine {
  accountId: AccountId;
  name: string;
  amount: Minor;
  memo: string | null;
}

export interface PresentedEntry {
  id: string;
  date: string;
  title: string;
  kind: EntryKind;
  /** What the payment was worth: the debits in the financial book. */
  amount: Minor;
  direction: Direction;
  /** The categories it was filed under, in order. */
  categories: PresentedLine[];
  /** Where the money came from or landed. */
  accountName: string | null;
  note: string | null;
  isSplit: boolean;
  isCorrection: boolean;
  /**
   * How far through the bank this entry has got, taken as a whole.
   *
   * The least settled of its lines wins. An entry with one line still pending
   * has not fully gone through, and calling it cleared would be the more
   * flattering of the two answers rather than the true one.
   */
  clearance: Clearance;
  /** When it was checked against a statement, or null. */
  reconciledAt: string | null;
  /** Every financial line, for the "what moved" section. */
  financialLines: PresentedLine[];
}

const MONEY_OUT = new Set<EntryKind>(['SPEND', 'SPEND_SPLIT', 'WRITE_OFF', 'REIMBURSABLE']);
const MONEY_IN = new Set<EntryKind>(['INCOME', 'REFUND', 'REIMBURSEMENT', 'DIVIDEND']);

export function directionOf(kind: EntryKind): Direction {
  if (MONEY_OUT.has(kind)) return 'out';
  if (MONEY_IN.has(kind)) return 'in';
  // Transfers, card payments and assignments move money you already had.
  return 'neutral';
}

export function presentEntry(
  entry: EntryWithPostings,
  accounts: Map<AccountId, LedgerAccount>,
): PresentedEntry {
  const nameOf = (id: AccountId) => accounts.get(id)?.name ?? 'Another account';
  const typeOf = (id: AccountId) => accounts.get(id)?.type;

  const financial = entry.postings.filter((p) => p.book === 'FINANCIAL');

  const line = (p: (typeof financial)[number]): PresentedLine => ({
    accountId: p.accountId,
    name: nameOf(p.accountId),
    amount: p.amount,
    memo: p.memo,
  });

  // What it was worth is the sum of the debits — the same figure whether the
  // payment went to one category or five.
  const amount = minor(
    financial.filter((p) => p.amount > 0).reduce((sum, p) => sum + p.amount, 0),
  );

  const categories = financial
    .filter((p) => p.amount > 0 && typeOf(p.accountId) === 'EXPENSE')
    .map(line);

  const funding = financial.find(
    (p) => p.amount < 0 && (typeOf(p.accountId) === 'ASSET' || typeOf(p.accountId) === 'LIABILITY'),
  );

  return {
    id: entry.id,
    date: entry.date,
    title: entry.description,
    kind: entry.kind,
    amount,
    direction: entry.kind === 'REVERSAL' ? 'neutral' : directionOf(entry.kind),
    categories,
    accountName: funding ? nameOf(funding.accountId) : null,
    note: entry.postings.find((p) => p.memo)?.memo ?? null,
    // A loan payment lands in two categories — the interest and what the
    // lender holds for tax and insurance — but nobody split it. It is one
    // payment whose parts are decided by the contract, and calling it a split
    // would suggest a choice was made that never was.
    isSplit:
      entry.kind !== 'LOAN_PAYMENT' &&
      (entry.kind === 'SPEND_SPLIT' || categories.length > 1),
    clearance: clearanceOf(entry.postings),
    reconciledAt: entry.postings.find((p) => p.reconciledAt)?.reconciledAt ?? null,
    isCorrection: entry.kind === 'REVERSAL',
    financialLines: financial.map(line),
  };
}
