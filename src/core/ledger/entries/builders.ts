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
import {
  LedgerError,
  type AccountId,
  type Funding,
  type JournalEntry,
  type Normal,
  type SystemAccounts,
} from '../types';
import { assertFundingMatchesAccount } from '../funding';
import {
  buildEntry,
  credit,
  debit,
  requirePositiveAmount,
  type EntryBase,
} from './common';

const FIN = 'FINANCIAL' as const;
const BUD = 'BUDGET' as const;

/* --- opening balance ----------------------------------------------------- */

export interface OpeningBalanceParams extends EntryBase {
  accountId: AccountId;
  amount: Minor;
  /** Only on-budget, spendable accounts add to the money you can assign. */
  countsAsBudgetableCash: boolean;
  accountName: string;
  /**
   * Which way the starting figure runs.
   *
   * DEBIT is something you have; CREDIT is something you owe. It defaults to
   * DEBIT because that is what every caller meant before mortgages and second
   * cards existed, and because getting it wrong on a debt would record a
   * £200,000 mortgage as £200,000 of wealth.
   */
  normal?: Normal;
  system: SystemAccounts;
}

export function openingBalance(p: OpeningBalanceParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'An opening balance');
  const owed = p.normal === 'CREDIT';

  if (owed && p.countsAsBudgetableCash) {
    throw new LedgerError(
      `${p.accountName} is something you owe, so it cannot also be money you can spend.`,
    );
  }

  return buildEntry(
    p,
    'OPENING_BALANCE',
    owed
      ? `What was already owed on ${p.accountName}.`
      : `Starting balance for ${p.accountName}.`,
    owed
      ? [credit(FIN, p.accountId, amount), debit(FIN, p.system.openingBalances, amount)]
      : [
          debit(FIN, p.accountId, amount),
          credit(FIN, p.system.openingBalances, amount),
          ...(p.countsAsBudgetableCash
            ? [
                debit(BUD, p.system.budgetableCash, amount),
                credit(BUD, p.system.readyToAssign, amount),
              ]
            : []),
        ],
  );
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
  payee?: string;
  /** Used to describe the entry when there is no payee to name. */
  categoryName?: string;
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
  assertFundingMatchesAccount(p.funding.account, p.funding);

  const budget =
    p.funding.via === 'card'
      ? [debit(BUD, p.envelopeId, amount), credit(BUD, p.funding.paymentEnvelopeId, amount)]
      : [debit(BUD, p.envelopeId, amount), credit(BUD, p.system.budgetableCash, amount)];

  const description = p.payee
    ? `Paid ${p.payee}.`
    : p.categoryName
      ? `Spent on ${p.categoryName.toLowerCase()}.`
      : 'Money spent.';

  return buildEntry(p, 'SPEND', description, [
    debit(FIN, p.categoryId, amount),
    credit(FIN, p.funding.account.id, amount),
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
  assertFundingMatchesAccount(p.funding.account, p.funding);

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
      credit(FIN, p.funding.account.id, amount),
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

export interface WriteOffParams extends EntryBase {
  amount: Minor;
  /** Where the cost finally lands, now that it is yours after all. */
  categoryId: AccountId;
  categoryName: string;
  envelopeId: AccountId;
  counterparty: string;
  system: SystemAccounts;
}

/**
 * Giving up on money somebody owed you.
 *
 * Up to this point it was not your spending, because you expected it back.
 * Once you accept it is not coming, it becomes your spending — in the month
 * you accept it, not the month you paid it. Backdating it would rewrite a
 * month that has already been reviewed and closed.
 */
export function writeOff(p: WriteOffParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'A write-off');

  return buildEntry(
    p,
    'WRITE_OFF',
    `Wrote off what ${p.counterparty} owed you as your own spending.`,
    [
      debit(FIN, p.categoryId, amount),
      credit(FIN, p.system.receivables, amount),
      debit(BUD, p.envelopeId, amount),
      credit(BUD, p.system.reimbursementsEnvelope, amount),
    ],
  );
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
  assertFundingMatchesAccount(p.refundedTo.account, p.refundedTo);

  const budget =
    p.refundedTo.via === 'card'
      ? [debit(BUD, p.refundedTo.paymentEnvelopeId, amount), credit(BUD, p.envelopeId, amount)]
      : [debit(BUD, p.system.budgetableCash, amount), credit(BUD, p.envelopeId, amount)];

  return buildEntry(p, 'REFUND', `${p.payee} refunded you.`, [
    debit(FIN, p.refundedTo.account.id, amount),
    credit(FIN, p.categoryId, amount),
    ...budget,
  ]);
}
