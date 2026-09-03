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
import { LedgerError } from '../types';
import { fundingFor } from '../funding';
import { cardPayment, income, refund, spend } from './builders';

/** One row of a statement, signed the way the bank wrote it. */
export interface StatementLine {
  date: IsoDate;
  /** Negative is money leaving the account. */
  amount: Minor;
  description: string;
}

/**
 * What a *positive* row on a card statement actually was.
 *
 * Money arriving on a credit card is never income, and treating it as such
 * inflates what somebody earns. It is one of two quite different things, and
 * the file cannot tell them apart — only the person can, which is why this is
 * asked in the review queue rather than guessed at here.
 */
export type CardCreditKind =
  /** You paid the bill: cash down, debt down, the reserve released. */
  | 'bill_payment'
  /** A shop gave money back: the category's spending goes down. */
  | 'refund';

export interface CardCredit {
  kind: CardCreditKind;
  /** Which account the bill was paid from. Only for a bill payment. */
  paidFromAccountId?: AccountId;
  paidFromName?: string;
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
  /** Required when a card statement row is positive. */
  cardCredit?: CardCredit;
  system: SystemAccounts;
}

/** Does this row need the person to say what it was before it can be filed? */
export function needsCardCreditChoice(account: LedgerAccount, amount: Minor): boolean {
  return account.type === 'LIABILITY' && amount > 0;
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

  // Money arriving on a card is not income. It is either the bill being paid
  // or a shop giving something back, and those post completely differently.
  if (needsCardCreditChoice(f.account, f.line.amount)) {
    return cardCreditEntry(f);
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

function cardCreditEntry(f: StatementFiling): JournalEntry {
  const choice = f.cardCredit;
  if (!choice) {
    throw new LedgerError(
      `Money arriving on ${f.account.name} is either you paying the bill or a shop ` +
        `giving something back, and those are recorded differently. Please say which ` +
        `this was.`,
    );
  }

  if (choice.kind === 'bill_payment') {
    if (!f.account.paymentEnvelopeId) {
      throw new LedgerError(
        `${f.account.name} has no pot set up for its bill, so there is nothing to ` +
          `release when the bill is paid.`,
      );
    }
    if (!choice.paidFromAccountId) {
      throw new LedgerError('Please say which account the bill was paid from.');
    }

    // Cash down, debt down, reserve released. No expense account is touched,
    // because the spending was already counted when the card was used.
    return cardPayment({
      id: f.id,
      date: f.line.date,
      amount: f.line.amount,
      cardAccountId: f.account.id,
      cardName: f.account.name,
      paymentEnvelopeId: f.account.paymentEnvelopeId,
      fromAccountId: choice.paidFromAccountId,
      fromName: choice.paidFromName ?? 'your account',
      system: f.system,
    });
  }

  // A refund reduces what was spent in that category. Counting it as earnings
  // would inflate income and quietly overstate the savings rate.
  return refund({
    id: f.id,
    date: f.line.date,
    amount: f.line.amount,
    categoryId: f.category.categoryId,
    envelopeId: f.category.envelopeId,
    refundedTo: fundingFor(f.account),
    payee: f.line.description,
    system: f.system,
  });
}
