/* ===========================================================================
 * TURNING A STATEMENT LINE INTO AN ENTRY
 * ---------------------------------------------------------------------------
 * The decision that goes wrong quietly: a row on a bank statement and a row on
 * a credit card statement look identical in the file, and they must become
 * completely different BUDGET postings.
 *
 * This used to live inside the confirm handler in the app layer, where it
 * could not be tested without a database, and where it hardcoded cash funding
 * for every row regardless of the account it came from. It is a pure function
 * here so the import path and the by-hand path are provably the same decision,
 * and so the regression test can drive it straight from a CSV.
 * ======================================================================== */

import type { Minor } from '@/core/money';
import { minor } from '@/core/money';
import type {
  AccountId,
  EntryId,
  IsoDate,
  JournalEntry,
  LedgerAccount,
  SystemAccounts,
} from '../types';
import { fundingFor } from '../funding';
import { income, spend } from './builders';

/** One row of a statement, signed the way the bank wrote it. */
export interface StatementLine {
  date: IsoDate;
  /** Negative is money leaving the account. */
  amount: Minor;
  description: string;
}

export interface StatementFiling {
  id: EntryId;
  line: StatementLine;
  /** The account whose statement this is — what decides everything below. */
  account: LedgerAccount;
  /** What the person filed it as. */
  category: { categoryId: AccountId; envelopeId: AccountId; categoryName: string };
  /** Where money arriving is recorded as having come from. */
  incomeAccountId: AccountId;
  system: SystemAccounts;
}

/**
 * Build the entry a confirmed statement row becomes.
 *
 * Money leaving is spending, funded according to what the account actually is:
 * cash out of an account you hold, or money set aside for the bill when the
 * statement is a card's. Money arriving is treated as income into that
 * account.
 */
export function entryFromStatementLine(f: StatementFiling): JournalEntry {
  const outgoing = f.line.amount < 0;

  if (outgoing) {
    return spend({
      id: f.id,
      date: f.line.date,
      amount: minor(-f.line.amount),
      categoryId: f.category.categoryId,
      envelopeId: f.category.envelopeId,
      categoryName: f.category.categoryName,
      // The whole point. `fundingFor` reads the account, so a card statement
      // reserves for its bill instead of spending cash that never moved.
      funding: fundingFor(f.account),
      payee: f.line.description,
      system: f.system,
    });
  }

  return income({
    id: f.id,
    date: f.line.date,
    amount: f.line.amount,
    sourceId: f.incomeAccountId,
    depositAccountId: f.account.id,
    // Money landing in an account that is not on budget — a pension, a
    // tracking account — moves net worth without becoming money to assign.
    countsAsBudgetableCash: f.account.onBudget,
    payer: f.line.description,
    system: f.system,
  });
}
