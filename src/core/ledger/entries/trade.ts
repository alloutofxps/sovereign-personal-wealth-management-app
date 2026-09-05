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
  cashAccount: LedgerAccount;
  brokerageAccount: LedgerAccount;
  /** What actually arrives in the bank, after any dealing fee. */
  proceeds: Minor;
  /** What the shares that went originally cost. From the tax lots. */
  costBasisRelieved: Minor;
  /** Proceeds less cost. Negative on a loss. */
  realizedGain: Minor;
  /** The pot the proceeds should land in. Defaults to money without a job. */
  toEnvelopeId?: AccountId;
  system: SystemAccounts;
}

/**
 * Shares sold, and the gain taken.
 *
 * Three things about the shape of this entry are load-bearing.
 *
 * The gain goes to EQUITY, never INCOME. Selling a fund does not make anybody
 * richer — a holding that was already theirs turned into cash that is also
 * theirs — and counting the gain as earnings would tell somebody who sold a
 * position that they had their best month in years, then quietly raise every
 * average the app computes from their income.
 *
 * The brokerage account is relieved at what the shares *cost*, not at what
 * they sold for. The difference is the gain, and it has to land somewhere
 * nameable rather than being absorbed into the asset. Whatever unrealised
 * gain was previously booked on those shares is then reversed by the next
 * reconciliation against the register, which is where it belongs.
 *
 * The budget book gains the proceeds. Money coming back out of an investment
 * genuinely is spendable again, so budgetable cash goes *up* and it arrives as
 * money waiting for a job. (The brief specified these two the other way round,
 * which would have reduced what is safe to spend by the amount just sold.)
 */
export function investmentSell(p: InvestmentSellParams): JournalEntry {
  const proceeds = requirePositiveAmount(p.proceeds, 'The money from a sale');

  if (p.costBasisRelieved < 0) {
    throw new LedgerError('What shares cost cannot be a negative amount.');
  }
  if (proceeds - p.costBasisRelieved !== p.realizedGain) {
    throw new LedgerError(
      'The gain on this sale does not match the difference between what the shares ' +
        'cost and what they sold for, so the record would not add up.',
    );
  }

  // Selling without taking the money out: the proceeds stay at the broker as
  // uninvested cash. This is the ordinary case — you sell, the cash sits there,
  // you buy something else next week — and refusing it used to make the most
  // common brokerage action unrecordable, while the rebalancer assumed it.
  //
  // Both legs land on the one account: relieved at what the shares cost,
  // credited with what they fetched. It nets to the gain, which is right,
  // because the account carries its holdings at cost until the register is
  // synced against it. Nothing leaves, so nothing about the budget moves.
  const inPlace = p.cashAccount.id === p.brokerageAccount.id;

  if (inPlace && p.brokerageAccount.onBudget) {
    throw new LedgerError(
      `${p.brokerageAccount.name} is part of your everyday money, so a sale inside it ` +
        `would change what is safe to spend without any money having moved.`,
    );
  }

  const entersBudget = !inPlace && p.cashAccount.onBudget && p.cashAccount.liquid;
  const gain = p.realizedGain;

  const description = inPlace
    ? `Sold part of ${p.brokerageAccount.name}, and the money stayed there.`
    : `Sold part of ${p.brokerageAccount.name}.`;

  return buildEntry(p, 'INVESTMENT_SELL', description, [
    debit(
      FIN,
      p.cashAccount.id,
      proceeds,
      inPlace ? 'What the shares fetched, left as cash in the account' : undefined,
    ),
    ...(p.costBasisRelieved > 0
      ? [
          credit(
            FIN,
            p.brokerageAccount.id,
            p.costBasisRelieved,
            inPlace ? 'What those shares had cost' : undefined,
          ),
        ]
      : []),
    ...(gain > 0 ? [credit(FIN, p.system.realizedGain, gain)] : []),
    ...(gain < 0 ? [debit(FIN, p.system.realizedLoss, minor(-gain))] : []),
    ...(entersBudget
      ? [
          debit(BUD, p.system.budgetableCash, proceeds),
          credit(BUD, p.toEnvelopeId ?? p.system.readyToAssign, proceeds),
        ]
      : []),
  ]);
}

/**
 * Money taken out of an investment account without selling anything.
 *
 * The plain withdrawal: uninvested cash sitting in a broker moving back to the
 * bank. Nothing is realised because nothing was disposed of.
 */
export function investmentWithdraw(p: {
  amount: Minor;
  cashAccount: LedgerAccount;
  brokerageAccount: LedgerAccount;
  system: SystemAccounts;
} & EntryBase): JournalEntry {
  const amount = requirePositiveAmount(p.amount, 'An amount to take out');

  if (p.cashAccount.id === p.brokerageAccount.id) {
    throw new LedgerError('Money has to move between two different accounts.');
  }

  const entersBudget = p.cashAccount.onBudget && p.cashAccount.liquid;

  return buildEntry(p, 'INVESTMENT_SELL', `Took money out of ${p.brokerageAccount.name}.`, [
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
  /** Where the money after tax lands, when it is taken as cash. */
  cashAccount: LedgerAccount;
  /** Where it stays, when it buys more shares instead. */
  brokerageAccount?: LedgerAccount;
  /** True when the payout bought more of the same thing rather than arriving. */
  isReinvested?: boolean;
  /** What paid it, as the person would say it: "VWCE". */
  payer?: string;
  system: SystemAccounts;
}

/**
 * Money paid out by something you hold.
 *
 * Real income, unlike a valuation or a sale — this is a return *on* the money
 * rather than a return *of* it, and treating it as anything else would
 * understate what somebody earned.
 *
 * Tax withheld is recorded even though it never touched the account: the gross
 * is what was earned, and showing only the net would understate both the
 * income and what was taken from it. It is the one deduction nobody gets to
 * choose, which is exactly why it should be visible.
 *
 * It lands in equity rather than in an expense account. EXPENSE in this ledger
 * means "money you chose to spend" — the daily burn rate, the pacing curve and
 * Safe-to-Spend are all built on that meaning — and tax deducted before the
 * money reached you was never money you could have kept. Booking it as
 * spending would show a month of purchases nobody made, and on a large enough
 * portfolio would tip a month into a deficit warning over it.
 *
 * Reinvested is the case people get wrong. A dividend that buys more shares is
 * still income — it was paid, it was taxable, it simply never stopped moving.
 * Skipping it because no cash appeared in the bank understates a year's income
 * by everything a growth portfolio produced. So the income is recorded either
 * way; what changes is where the money lands, and whether the budget hears
 * about it at all.
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
  const reinvested = p.isReinvested === true;

  if (reinvested && !p.brokerageAccount) {
    throw new LedgerError(
      'A reinvested dividend needs to say which account bought the extra shares.',
    );
  }

  // Where the money after tax ends up. Reinvested, it never leaves the
  // investment account; taken as cash, it arrives in the bank.
  const destination = reinvested ? p.brokerageAccount! : p.cashAccount;

  // The budget only hears about money that becomes spendable. A reinvested
  // dividend is income that was never available to spend for a moment, so
  // Safe-to-Spend must not move — saying otherwise would offer somebody money
  // that is sitting in a fund.
  const landsOnBudget = !reinvested && p.cashAccount.onBudget && p.cashAccount.liquid;

  return buildEntry(
    p,
    'DIVIDEND',
    p.payer
      ? reinvested
        ? `${p.payer} paid out, and it bought more shares.`
        : `${p.payer} paid out.`
      : reinvested
        ? 'One of your investments paid out, and it bought more shares.'
        : 'One of your investments paid out.',
    [
      // A dividend fully taken by tax leaves no line here, because nothing
      // moved anywhere.
      ...(net > 0 ? [debit(FIN, destination.id, net)] : []),
      ...(tax > 0 ? [debit(FIN, p.system.investmentTaxWithheld, tax)] : []),
      credit(FIN, p.system.dividendIncome, gross),
      ...(landsOnBudget && net > 0
        ? [debit(BUD, p.system.budgetableCash, net), credit(BUD, p.system.readyToAssign, net)]
        : []),
    ],
  );
}
