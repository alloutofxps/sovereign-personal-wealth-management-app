/* ===========================================================================
 * THE ENTRY BUILDERS
 * ---------------------------------------------------------------------------
 * One builder per thing that can actually happen to a person's money. Each
 * returns a single JournalEntry carrying postings for both books.
 *
 * The descriptions these produce are user-facing, so they are written as
 * complete sentences a person would recognise — never as accounting terms.
 * ======================================================================== */

import type { Minor } from '@/core/money';
import { LedgerError, type AccountId, type JournalEntry, type SystemAccounts } from '../types';
import {
  buildEntry,
  credit,
  debit,
  requirePositiveAmount,
  type EntryBase,
} from './common';

const FIN = 'FINANCIAL' as const;
const BUD = 'BUDGET' as const;

/**
 * How a payment was funded.
 *
 * `card` is the case that breaks naive budgeting apps: no cash moves, but the
 * envelope must still go down and cash must be set aside for the eventual
 * bill. Making it a distinct shape means a caller cannot forget the reserve.
 */
export type Funding =
  | { via: 'cash'; accountId: AccountId }
  | { via: 'card'; accountId: AccountId; paymentEnvelopeId: AccountId };

/* --- opening balance ----------------------------------------------------- */

export interface OpeningBalanceParams extends EntryBase {
  accountId: AccountId;
  amount: Minor;
  /** Only on-budget, spendable accounts add to the money you can assign. */
  countsAsBudgetableCash: boolean;
  accountName: string;
  system: SystemAccounts;
}

export function openingBalance(p: OpeningBalanceParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'An opening balance');

  return buildEntry(p, 'OPENING_BALANCE', `Starting balance for ${p.accountName}.`, [
    debit(FIN, p.accountId, amount),
    credit(FIN, p.system.openingBalances, amount),
    ...(p.countsAsBudgetableCash
      ? [debit(BUD, p.system.budgetableCash, amount), credit(BUD, p.system.readyToAssign, amount)]
      : []),
  ]);
}

/* --- assigning money to an envelope -------------------------------------- */

export interface AssignParams extends EntryBase {
  envelopeId: AccountId;
  envelopeName: string;
  amount: Minor;
  system: SystemAccounts;
}

/** Give money a job. Budget book only — no cash actually moves. */
export function assign(p: AssignParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'An amount to set aside');

  return buildEntry(p, 'ASSIGN', `Set money aside for ${p.envelopeName}.`, [
    debit(BUD, p.system.readyToAssign, amount),
    credit(BUD, p.envelopeId, amount),
  ]);
}

/* --- spending ------------------------------------------------------------ */

export interface SpendParams extends EntryBase {
  amount: Minor;
  /** The EXPENSE account — what the money was spent on. */
  categoryId: AccountId;
  /** The envelope the category draws from. */
  envelopeId: AccountId;
  funding: Funding;
  /** Where the money went, as the person would say it: "Albert Heijn". */
  payee: string;
  system: SystemAccounts;
}

/**
 * Money spent on something.
 *
 * Paid by card, no cash moves — so the budget book moves the envelope down and
 * the card's payment envelope up by the same amount. The cash is now spoken
 * for, and the eventual bill is already covered. Paying that bill later is a
 * separate entry that touches no expense account, so the spending is counted
 * exactly once however it is settled.
 */
export function spend(p: SpendParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'A payment');

  const budget =
    p.funding.via === 'card'
      ? [debit(BUD, p.envelopeId, amount), credit(BUD, p.funding.paymentEnvelopeId, amount)]
      : [debit(BUD, p.envelopeId, amount), credit(BUD, p.system.budgetableCash, amount)];

  return buildEntry(p, 'SPEND', `Paid ${p.payee}.`, [
    debit(FIN, p.categoryId, amount),
    credit(FIN, p.funding.accountId, amount),
    ...budget,
  ]);
}

/* --- income -------------------------------------------------------------- */

export interface IncomeParams extends EntryBase {
  amount: Minor;
  /** The INCOME account — salary, freelance, interest. */
  sourceId: AccountId;
  /** Where it landed. */
  depositAccountId: AccountId;
  /** Off-budget deposits (a pension contribution) raise net worth only. */
  countsAsBudgetableCash: boolean;
  payer: string;
  system: SystemAccounts;
}

export function income(p: IncomeParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'Money coming in');

  return buildEntry(p, 'INCOME', `Money in from ${p.payer}.`, [
    debit(FIN, p.depositAccountId, amount),
    credit(FIN, p.sourceId, amount),
    ...(p.countsAsBudgetableCash
      ? [debit(BUD, p.system.budgetableCash, amount), credit(BUD, p.system.readyToAssign, amount)]
      : []),
  ]);
}

/* --- moving money between your own accounts ------------------------------ */

export interface TransferParams extends EntryBase {
  amount: Minor;
  from: { accountId: AccountId; name: string; countsAsBudgetableCash: boolean };
  to: { accountId: AccountId; name: string; countsAsBudgetableCash: boolean };
  /**
   * Required when money leaves the budget — moving cash into an investment
   * account means it is no longer available to spend, so it has to come out
   * of an envelope that was set aside for it.
   */
  envelopeId?: AccountId;
  system: SystemAccounts;
}

/**
 * Money moved between accounts you own. Never spending, never income — your
 * net worth is exactly the same afterwards.
 */
export function transfer(p: TransferParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'A transfer');

  if (p.from.accountId === p.to.accountId) {
    throw new LedgerError('A transfer needs two different accounts.');
  }

  const leavesBudget = p.from.countsAsBudgetableCash && !p.to.countsAsBudgetableCash;
  const entersBudget = !p.from.countsAsBudgetableCash && p.to.countsAsBudgetableCash;

  if (leavesBudget && !p.envelopeId) {
    throw new LedgerError(
      `Moving money to ${p.to.name} takes it out of what you can spend, so it ` +
        `needs to come from a pot you set aside. Choose one.`,
    );
  }

  const budget = leavesBudget
    ? [debit(BUD, p.envelopeId as AccountId, amount), credit(BUD, p.system.budgetableCash, amount)]
    : entersBudget
      ? [debit(BUD, p.system.budgetableCash, amount), credit(BUD, p.system.readyToAssign, amount)]
      : // Both sides are on-budget: the cash total is unchanged, so the budget
        // book has nothing to say about it.
        [];

  return buildEntry(p, 'TRANSFER', `Moved money from ${p.from.name} to ${p.to.name}.`, [
    debit(FIN, p.to.accountId, amount),
    credit(FIN, p.from.accountId, amount),
    ...budget,
  ]);
}

/* --- paying a credit card bill ------------------------------------------- */

export interface CardPaymentParams extends EntryBase {
  amount: Minor;
  cardAccountId: AccountId;
  cardName: string;
  paymentEnvelopeId: AccountId;
  fromAccountId: AccountId;
  fromName: string;
  system: SystemAccounts;
}

/**
 * Paying off some or all of a card balance.
 *
 * This is not spending — the spending already happened when the card was used.
 * Cash goes down and the debt goes down by the same amount, so it touches no
 * expense account at all. That is what stops a card purchase being counted
 * twice.
 */
export function cardPayment(p: CardPaymentParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'A card payment');

  return buildEntry(p, 'CC_PAYMENT', `Paid your ${p.cardName} bill from ${p.fromName}.`, [
    debit(FIN, p.cardAccountId, amount),
    credit(FIN, p.fromAccountId, amount),
    debit(BUD, p.paymentEnvelopeId, amount),
    credit(BUD, p.system.budgetableCash, amount),
  ]);
}

/* --- money you fronted --------------------------------------------------- */

export interface ReimbursableParams extends EntryBase {
  amount: Minor;
  funding: Funding;
  /** Who will pay you back. */
  counterparty: string;
  system: SystemAccounts;
}

/**
 * Something you paid for that will be paid back to you.
 *
 * No expense is recorded, because it is not your spending. The money becomes
 * something you are owed, and it stays out of every spending figure until it
 * either comes back or is written off.
 */
export function reimbursable(p: ReimbursableParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'Money you fronted');

  const budget =
    p.funding.via === 'card'
      ? [
          debit(BUD, p.system.reimbursementsEnvelope, amount),
          credit(BUD, p.funding.paymentEnvelopeId, amount),
        ]
      : [
          debit(BUD, p.system.reimbursementsEnvelope, amount),
          credit(BUD, p.system.budgetableCash, amount),
        ];

  return buildEntry(
    p,
    'REIMBURSABLE',
    `Paid for something ${p.counterparty} will pay back.`,
    [
      debit(FIN, p.system.receivables, amount),
      credit(FIN, p.funding.accountId, amount),
      ...budget,
    ],
  );
}

export interface ReimbursementParams extends EntryBase {
  amount: Minor;
  depositAccountId: AccountId;
  counterparty: string;
  system: SystemAccounts;
}

/**
 * Being paid back. Not income — you are only getting your own money returned,
 * so counting it as earnings would overstate what you make.
 */
export function reimbursement(p: ReimbursementParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'A repayment');

  return buildEntry(p, 'REIMBURSEMENT', `${p.counterparty} paid you back.`, [
    debit(FIN, p.depositAccountId, amount),
    credit(FIN, p.system.receivables, amount),
    debit(BUD, p.system.budgetableCash, amount),
    credit(BUD, p.system.reimbursementsEnvelope, amount),
  ]);
}

/* --- refunds ------------------------------------------------------------- */

export interface RefundParams extends EntryBase {
  amount: Minor;
  /** The category the original purchase was in. */
  categoryId: AccountId;
  envelopeId: AccountId;
  /** Where the refund landed — back on the card, or into an account. */
  refundedTo: Funding;
  payee: string;
  system: SystemAccounts;
}

/**
 * Money given back by a shop.
 *
 * It reduces what you spent in that category rather than counting as income.
 * Treating a refund as earnings would inflate what you make and quietly
 * overstate your savings rate.
 */
export function refund(p: RefundParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'A refund');

  const budget =
    p.refundedTo.via === 'card'
      ? [debit(BUD, p.refundedTo.paymentEnvelopeId, amount), credit(BUD, p.envelopeId, amount)]
      : [debit(BUD, p.system.budgetableCash, amount), credit(BUD, p.envelopeId, amount)];

  return buildEntry(p, 'REFUND', `${p.payee} refunded you.`, [
    debit(FIN, p.refundedTo.accountId, amount),
    credit(FIN, p.categoryId, amount),
    ...budget,
  ]);
}
