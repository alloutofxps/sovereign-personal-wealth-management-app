/* ===========================================================================
 * BALANCES
 * ---------------------------------------------------------------------------
 * Every figure the app shows is derived from the journal by folding postings.
 * Nothing is stored as a running total, so a balance can never drift out of
 * step with the entries that produced it.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import {
  type AccountId,
  type Book,
  type Clearance,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerSnapshot,
  type Posting,
} from './types';

export interface BalanceFilter {
  /**
   * `cleared` counts only what the bank has settled — the figure that must
   * match a statement. `all` (the default) includes pending lines, which is
   * what Safe-to-Spend uses, because money on a pending card authorisation is
   * gone in every sense that matters to the person spending it.
   */
  clearance?: Clearance | 'all';
  /** Only count entries on or before this date. */
  upTo?: string;
}

function matches(posting: Posting, entry: JournalEntry, filter: BalanceFilter): boolean {
  if (filter.clearance && filter.clearance !== 'all' && posting.clearance !== filter.clearance) {
    return false;
  }
  if (filter.upTo && entry.date > filter.upTo) return false;
  return true;
}

/** Every posting in the snapshot, flattened, with its entry alongside. */
export function* eachPosting(
  snapshot: LedgerSnapshot,
  filter: BalanceFilter = {},
): Generator<{ posting: Posting; entry: JournalEntry }> {
  for (const entry of snapshot.entries) {
    for (const posting of entry.postings) {
      if (matches(posting, entry, filter)) yield { posting, entry };
    }
  }
}

/**
 * The raw signed balance: debits positive, credits negative, whatever kind of
 * account it is. This is the number the arithmetic uses.
 */
export function rawBalance(
  snapshot: LedgerSnapshot,
  accountId: AccountId,
  filter: BalanceFilter = {},
): Minor {
  let total = 0;
  for (const { posting } of eachPosting(snapshot, filter)) {
    if (posting.accountId === accountId) total += posting.amount;
  }
  return minor(total);
}

/**
 * The balance as a person expects to read it: a credit card with 560 owed
 * reads as 560, not −560; an envelope holding 300 reads as 300.
 */
export function presentedBalance(
  snapshot: LedgerSnapshot,
  accountId: AccountId,
  filter: BalanceFilter = {},
): Minor {
  const account = snapshot.accounts.get(accountId);
  const raw = rawBalance(snapshot, accountId, filter);
  return account?.normal === 'CREDIT' ? minor(-raw) : raw;
}

/** Raw balances for every account that has any activity. */
export function allRawBalances(
  snapshot: LedgerSnapshot,
  filter: BalanceFilter = {},
): Map<AccountId, Minor> {
  const totals = new Map<AccountId, number>();
  for (const { posting } of eachPosting(snapshot, filter)) {
    totals.set(posting.accountId, (totals.get(posting.accountId) ?? 0) + posting.amount);
  }
  return new Map([...totals].map(([id, value]) => [id, minor(value)]));
}

/** Sum of raw balances across accounts matching a predicate. */
export function totalWhere(
  snapshot: LedgerSnapshot,
  predicate: (account: LedgerAccount) => boolean,
  filter: BalanceFilter = {},
): Minor {
  let total = 0;
  for (const { posting } of eachPosting(snapshot, filter)) {
    const account = snapshot.accounts.get(posting.accountId);
    if (account && predicate(account)) total += posting.amount;
  }
  return minor(total);
}

export function totalByType(
  snapshot: LedgerSnapshot,
  type: LedgerAccountType,
  filter: BalanceFilter = {},
): Minor {
  return totalWhere(snapshot, (a) => a.type === type, filter);
}

/** What a person would call their spending: expenses, net of refunds. */
export function totalSpending(snapshot: LedgerSnapshot, filter: BalanceFilter = {}): Minor {
  return totalByType(snapshot, 'EXPENSE', filter);
}

/** What a person would call their income. Positive. */
export function totalIncome(snapshot: LedgerSnapshot, filter: BalanceFilter = {}): Minor {
  return minor(-totalByType(snapshot, 'INCOME', filter));
}

/** Assets minus liabilities. */
export function netWorth(snapshot: LedgerSnapshot, filter: BalanceFilter = {}): Minor {
  const assets = totalByType(snapshot, 'ASSET', filter);
  const liabilities = totalByType(snapshot, 'LIABILITY', filter);
  // Liabilities carry credit balances (negative raw), so adding them subtracts.
  return minor(assets + liabilities);
}

/** Cash you could actually spend today, across on-budget liquid accounts. */
export function liquidCash(snapshot: LedgerSnapshot, filter: BalanceFilter = {}): Minor {
  return totalWhere(snapshot, (a) => a.type === 'ASSET' && a.onBudget && a.liquid, filter);
}

/** The total of one book's postings. Zero when the book is consistent. */
export function bookTotal(
  snapshot: LedgerSnapshot,
  book: Book,
  filter: BalanceFilter = {},
): Minor {
  let total = 0;
  for (const { posting } of eachPosting(snapshot, filter)) {
    if (posting.book === book) total += posting.amount;
  }
  return minor(total);
}
