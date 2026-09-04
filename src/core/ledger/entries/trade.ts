/* ===========================================================================
 * PUTTING MONEY IN, AND WHAT IT PAYS OUT
 * ---------------------------------------------------------------------------
 * Buying an index fund is not spending. It is the same money, in a different
 * shape — cash out of one pocket, holding into another, net worth unchanged to
 * the penny. Every budgeting app that gets this wrong tells the person who
 * saved £500 into a pension that they had their worst month of the year, and
 * teaches them that saving feels like failure.
 *
 * So a buy writes no EXPENSE posting, and it is filed under a kind that I6
 * covers, which means the rule is enforced by the invariant engine rather than
 * by this file remembering. A dividend is the opposite case and is treated as
 * the opposite: it is real income, and it says so.
 *
 * The budget book still has to move, though, and this is the part that is easy
 * to get wrong. Money going into a brokerage account leaves the pool of cash
 * that Safe-to-Spend is worked out from. Something has to give it up, or I5 —
 * every penny is either in a pot or waiting for a job — stops holding.
 * ======================================================================== */

import type { Minor } from '@/core/money';
import { minor } from '@/core/money';
import {
  LedgerError,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type SystemAccounts,
} from '../types';
import { buildEntry, credit, debit, requirePositiveAmount, type EntryBase } from './common';

const FIN = 'FINANCIAL' as const;
const BUD = 'BUDGET' as const;

/* --- buying ------------------------------------------------------------- */

export interface InvestmentBuyParams extends EntryBase {
  amount: Minor;
  /** The everyday account the money comes out of. */
  cashAccount: LedgerAccount;
  /** The brokerage or pension account it goes into. */
  brokerageAccount: LedgerAccount;
  /**
   * The pot the money was set aside in, if it was.
   *
   * Optional, and when it is absent the money comes out of what has not been
   * given a job yet. Both are honest; forcing somebody to create an "investing"
   * pot before they can record a purchase they have already made is not. If
   * that pushes Ready-to-Assign below zero, the budget grid will say so — and
   * it should, because it means the money was already promised elsewhere.
   */
  fromEnvelopeId?: AccountId;
  system: SystemAccounts;
}

/**
 * Money moved from cash into an investment account.
 *
 * Both books move; no income or expense account is touched on either side.
 */
export function investmentBuy(p: InvestmentBuyParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'An amount to invest');

  if (p.cashAccount.id === p.brokerageAccount.id) {
    throw new LedgerError('Money has to move between two different accounts.');
  }
  if (p.brokerageAccount.type !== 'ASSET') {
    throw new LedgerError(
      `${p.brokerageAccount.name} is not somewhere money can be invested into.`,
    );
  }
  if (p.brokerageAccount.onBudget) {
    throw new LedgerError(
      `${p.brokerageAccount.name} is part of your everyday money, so putting cash into ` +
        `it would not take it out of what is safe to spend. Record this as a transfer ` +
        `instead, or move the account to tracking-only first.`,
    );
  }

  // The cash side has to be on-budget for there to be anything to take out of
  // the budget. Investing from one tracking account into another moves nothing
  // a person can spend, so the budget book stays silent.
  const leavesBudget = p.cashAccount.onBudget && p.cashAccount.liquid;
  const source = p.fromEnvelopeId ?? p.system.readyToAssign;

  return buildEntry(
    p,
    'INVESTMENT_BUY',
    `Put money into ${p.brokerageAccount.name}.`,
    [
      debit(FIN, p.brokerageAccount.id, amount),
      credit(FIN, p.cashAccount.id, amount),
      ...(leavesBudget
        ? [debit(BUD, source, amount), credit(BUD, p.system.budgetableCash, amount)]
        : []),
    ],
  );
}

/* --- selling ------------------------------------------------------------ */

export interface InvestmentSellParams extends EntryBase {
  amount: Minor;
  cashAccount: LedgerAccount;
  brokerageAccount: LedgerAccount;
  system: SystemAccounts;
}

/**
 * Money taken back out of an investment account.
 *
 * The mirror of a buy, and just as much not-income: selling a fund does not
 * make somebody richer, it makes them more liquid. The proceeds arrive as
 * money waiting to be given a job, which is exactly what they are.
 */
export function investmentSell(p: InvestmentSellParams): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'An amount to take out');

  if (p.cashAccount.id === p.brokerageAccount.id) {
    throw new LedgerError('Money has to move between two different accounts.');
  }

  const entersBudget = p.cashAccount.onBudget && p.cashAccount.liquid;

  return buildEntry(p, 'INVESTMENT_BUY', `Took money out of ${p.brokerageAccount.name}.`, [
    debit(FIN, p.cashAccount.id, amount),
    credit(FIN, p.brokerageAccount.id, amount),
    ...(entersBudget
      ? [
          debit(BUD, p.system.budgetableCash, amount),
          credit(BUD, p.system.readyToAssign, amount),
        ]
      : []),
  ]);
}

/* --- being paid out ----------------------------------------------------- */

export interface InvestmentDividendParams extends EntryBase {
  /** What the holding declared, before anything was taken off it. */
  grossAmount: Minor;
  /** Tax deducted at source, which never reaches the account. */
  taxWithheld?: Minor;
  /** Where the money after tax actually landed. */
  cashAccount: LedgerAccount;
  /** What paid it, as the person would say it: "VWCE". */
  payer?: string;
  system: SystemAccounts;
}

/**
 * Money paid out by something you hold.
 *
 * Real income, unlike a valuation — this is cash that arrived, and treating it
 * as anything else would understate what somebody earned.
 *
 * Tax withheld is booked as an expense even though it never touched the
 * account. It is money that was earned and then taken, and hiding it by
 * recording only the net would show a lower income and a lower tax bill than
 * the person actually has. It is the one deduction they never get to choose,
 * which is exactly why it should be visible.
 */
export function investmentDividend(p: InvestmentDividendParams): JournalEntry {
  const gross = requirePositiveAmount(p.grossAmount, 'A dividend');
  const tax = minor(p.taxWithheld ?? 0);

  if (tax < 0) {
    throw new LedgerError('Tax taken off a dividend cannot be a negative amount.');
  }
  if (tax > gross) {
    throw new LedgerError(
      `More tax was taken off than the dividend was worth, which cannot be right. ` +
        `Check the gross figure.`,
    );
  }

  const net = minor(gross - tax);
  const landsOnBudget = p.cashAccount.onBudget && p.cashAccount.liquid;

  return buildEntry(
    p,
    'DIVIDEND',
    p.payer ? `${p.payer} paid out.` : 'One of your investments paid out.',
    [
      // The net is what actually arrived. A dividend fully taken by tax leaves
      // no cash line at all, because no cash moved.
      ...(net > 0 ? [debit(FIN, p.cashAccount.id, net)] : []),
      ...(tax > 0 ? [debit(FIN, p.system.taxExpense, tax)] : []),
      credit(FIN, p.system.dividendIncome, gross),
      ...(landsOnBudget && net > 0
        ? [debit(BUD, p.system.budgetableCash, net), credit(BUD, p.system.readyToAssign, net)]
        : []),
    ],
  );
}
