/* ===========================================================================
 * MOVING MONEY BETWEEN CURRENCIES
 * ---------------------------------------------------------------------------
 * €1,000 leaves a euro account and $1,080 arrives in a dollar one. Nothing was
 * earned and nothing was spent, but the two figures are not the same number
 * and never will be — which is why the single-currency ledger could not
 * express this at all, and why the balance check now runs on what the lines
 * are worth rather than on what they say.
 *
 * Three things can make the two sides differ once both are in the reporting
 * currency, and telling them apart is the point of this file:
 *
 *   · Nothing. The bank gave the mid-market rate and both sides come to the
 *     same euros. The commonest case, and the entry is two lines.
 *
 *   · A spread. The bank's rate was worse than the one on record, so fewer
 *     euros arrived than left. That is a real cost and it goes to a named
 *     account — as equity, not as spending, because nobody chose to buy
 *     anything and a burn-rate curve must not show that they did.
 *
 *   · A cent. Two lines converted at two rates round independently and can
 *     land a unit apart. That is not a cost, it is arithmetic, and it goes to
 *     the rounding-variance account where it can be pointed at rather than
 *     absorbed into whichever line was largest.
 *
 * Conflating the second and third is the mistake worth avoiding: a fee is
 * something a person could shop around for, and a rounding cent is not.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
// Deep import on purpose: see the note in the money barrel.
import { convertCurrency, rate1e6, type Rate1e6 } from '@/core/money/fx';
import {
  LedgerError,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type SystemAccounts,
} from '../types';
import { buildEntry, credit, debit, type EntryBase, type PostingSpec } from './common';

const FIN = 'FINANCIAL' as const;
const BUD = 'BUDGET' as const;

export interface TransferCrossCurrencyParams extends EntryBase {
  fromAccount: LedgerAccount;
  toAccount: LedgerAccount;
  /** What left, in the sending account's own currency. */
  fromAmount: Minor;
  /** What arrived, in the receiving account's own currency. */
  toAmount: Minor;
  /** Quote-per-base rate for the sending currency, at 1e6. */
  fromRateScaled: Rate1e6;
  /** Quote-per-base rate for the receiving currency, at 1e6. */
  toRateScaled: Rate1e6;
  /**
   * The pot the money was set aside in, when it is leaving the budget.
   * Defaults to money that has not been given a job yet.
   */
  fromEnvelopeId?: AccountId;
  system: SystemAccounts;
}

/**
 * Money moved between two accounts you own, in different currencies.
 *
 * Never income, never spending — this is the same money in a different shape,
 * exactly as an ordinary transfer is. It carries the kind `TRANSFER` so that
 * invariant I6, which already asserts transfers add nothing to either, keeps
 * covering it without needing to be told about currencies.
 */
export function transferCrossCurrency(p: TransferCrossCurrencyParams): JournalEntry {
  if (p.fromAmount <= 0 || p.toAmount <= 0) {
    throw new LedgerError('A transfer needs an amount on both sides.');
  }
  if (p.fromAccount.id === p.toAccount.id) {
    throw new LedgerError('A transfer needs two different accounts.');
  }

  // A foreign-currency account cannot be part of the budget, and this is where
  // that rule bites. Budgetable cash mirrors on-budget liquid assets exactly
  // (invariant I4), so an account whose worth moves when a rate moves would
  // break the mirror every time the rate changed — and, worse, would tell
  // somebody they can spend dollars on their euro groceries without
  // converting them first.
  if (p.fromAccount.onBudget && p.toAccount.onBudget && p.fromRateScaled !== p.toRateScaled) {
    throw new LedgerError(
      `${p.fromAccount.name} and ${p.toAccount.name} cannot both be part of your budget ` +
        `while they are in different currencies. Money you would have to convert before ` +
        `spending is not money you can spend today.`,
    );
  }

  // What each side is worth in the currency the household reports in. This is
  // the only footing on which the two can be compared at all.
  const fromBase = convertCurrency(p.fromAmount, p.fromRateScaled, 'quoteToBase');
  const toBase = convertCurrency(p.toAmount, p.toRateScaled, 'quoteToBase');

  // Less arrived than left: the bank's rate was worse than the one on record.
  // More arrived than left would mean the rate on record is stale rather than
  // that the bank was generous, so it is recorded the same way with the sign
  // reversed rather than being treated as a windfall.
  const spread = minor(fromBase - toBase);

  const financial: PostingSpec[] = [
    {
      ...credit(FIN, p.fromAccount.id, p.fromAmount),
      baseAmount: minor(-fromBase),
      fxRateScaled: p.fromRateScaled,
    },
    {
      ...debit(FIN, p.toAccount.id, p.toAmount),
      baseAmount: toBase,
      fxRateScaled: p.toRateScaled,
    },
  ];

  if (spread !== 0) {
    financial.push({
      book: FIN,
      accountId: p.system.fxConversionFee,
      // The fee account is denominated in the reporting currency, so its own
      // amount and its base amount are the same figure.
      amount: spread,
      baseAmount: spread,
      memo:
        spread > 0
          ? 'What the bank kept on the conversion.'
          : 'What the conversion came out ahead by, against the rate on record.',
    });
  }

  // --- the budget side ---------------------------------------------------
  //
  // Only on-budget liquid money is spendable, so only movement across that
  // boundary means anything here. Two on-budget accounts in different
  // currencies still change what is spendable, by the spread — the euros went
  // out and slightly fewer euros' worth came back.
  const leaves = p.fromAccount.onBudget && p.fromAccount.liquid;
  const enters = p.toAccount.onBudget && p.toAccount.liquid;

  const budget: PostingSpec[] = [];

  if (leaves && !enters) {
    // Out of the budget entirely: it has to come from a pot, or from what has
    // not been given a job yet.
    budget.push(
      { ...debit(BUD, p.fromEnvelopeId ?? p.system.readyToAssign, fromBase), baseAmount: fromBase },
      { ...credit(BUD, p.system.budgetableCash, fromBase), baseAmount: minor(-fromBase) },
    );
  } else if (enters && !leaves) {
    budget.push(
      { ...debit(BUD, p.system.budgetableCash, toBase), baseAmount: toBase },
      { ...credit(BUD, p.system.readyToAssign, toBase), baseAmount: minor(-toBase) },
    );
  }
  // Both on-budget is not reachable across currencies — the guard above
  // refuses it — and both off-budget moves nothing spendable, so in either
  // case the budget book has nothing to say.

  return buildEntry(
    p,
    'TRANSFER',
    `Moved money from ${p.fromAccount.name} to ${p.toAccount.name}.`,
    [...financial, ...budget],
  );
}

/**
 * What a foreign balance is worth now that the rate has moved.
 *
 * Nothing moved. The dollars in the account are the same dollars; what changed
 * is what they are worth in the currency the household reports in. So the
 * native side of every line is zero movement and only the base side shifts —
 * which is why this entry, alone among all of them, is written directly rather
 * than through the ordinary debit/credit helpers.
 *
 * It goes to equity for the same reason a house being revalued does: net worth
 * moved without anybody earning or spending anything.
 */
export function fxRevaluation(
  p: EntryBase & {
    account: LedgerAccount;
    /** The account's balance in its own currency. Unchanged by this. */
    nativeBalance: Minor;
    /** What the books currently say it is worth in the reporting currency. */
    currentBaseValue: Minor;
    /** What it is worth at today's rate. */
    newBaseValue: Minor;
    newRateScaled: Rate1e6;
    system: SystemAccounts;
  },
): JournalEntry {
  if (p.account.onBudget) {
    throw new LedgerError(
      `${p.account.name} is part of your budget, and what you can spend has to match what ` +
        `is in your everyday accounts exactly. An account whose worth moves with an ` +
        `exchange rate cannot do that. Move it to tracking-only first.`,
    );
  }

  const delta = minor(p.newBaseValue - p.currentBaseValue);

  if (delta === 0) {
    throw new LedgerError(
      `${p.account.name} is already recorded at today's rate, so there is nothing to change.`,
    );
  }

  const worthMore = delta > 0;

  return buildEntry(
    p,
    'FX_REVALUATION',
    worthMore
      ? `${p.account.name} is worth more now the exchange rate has moved.`
      : `${p.account.name} is worth less now the exchange rate has moved.`,
    [
      {
        book: FIN,
        accountId: p.account.id,
        // The native side does not move — not a cent of it. Only the account's
        // worth in the reporting currency has changed, so the amount recorded
        // here is the base movement carried on the account's own line.
        amount: delta,
        baseAmount: delta,
        fxRateScaled: rate1e6(1_000_000),
        memo: 'The exchange rate moved; the balance did not.',
      },
      {
        book: FIN,
        accountId: p.system.unrealizedFxGainLoss,
        amount: minor(-delta),
        baseAmount: minor(-delta),
        memo: worthMore ? 'A currency moved your way.' : 'A currency moved against you.',
      },
    ],
  );
}

/** How a cross-currency transfer reads, for the entry's note. */
export function describeConversion(input: {
  fromAmount: Minor;
  toAmount: Minor;
  fromCurrency: string;
  toCurrency: string;
  formatNative: (amount: Minor, currency: string) => string;
}): string {
  return (
    `${input.formatNative(input.fromAmount, input.fromCurrency)} became ` +
    `${input.formatNative(input.toAmount, input.toCurrency)}.`
  );
}
