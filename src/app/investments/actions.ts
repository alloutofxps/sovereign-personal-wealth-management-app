/* ===========================================================================
 * RECORDING MONEY GOING INTO INVESTMENTS
 * ---------------------------------------------------------------------------
 * Kept apart from `@/app/ledger/actions` on purpose. That module is loaded on
 * the first paint — the dashboard needs it — and pulling the trade builders in
 * beside it would put the buy, sell and dividend entries in front of everybody
 * who opens the app, including the great many people who hold no investments
 * at all. Only the investments screen reaches for this, and the investments
 * screen is lazily loaded.
 * ======================================================================== */

import type { Minor } from '@/core/money';
import { entryId, isoDate, type AccountId, type IsoDate } from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import {
  investmentBuy,
  investmentDividend,
  investmentWithdraw,
} from '@/core/ledger/entries/trade';
import { transferCrossCurrency } from '@/core/ledger/entries/transferCrossCurrency';
import { getRateAsOf } from '@/data/repositories/fxRepo';
import { useAppConfig } from '@/app/config/store';
import { toIsoDate } from '@/core/liquidity';
import { accountsById, saveEntry } from '@/data/repositories/ledgerRepo';
import { SYSTEM_ACCOUNTS } from '@/data/seed';

function newEntry(date?: IsoDate) {
  return { id: entryId(crypto.randomUUID()), date: date ?? isoDate(toIsoDate(new Date())) };
}

async function twoAccounts(cashId: AccountId, otherId: AccountId) {
  const accounts = await accountsById();
  const cashAccount = accounts.get(cashId);
  const otherAccount = accounts.get(otherId);
  if (!cashAccount || !otherAccount) {
    throw new Error('One of those accounts could not be found, so nothing has been recorded.');
  }
  return { cashAccount, otherAccount };
}

export interface RecordInvestmentBuyInput {
  amount: Minor;
  cashAccountId: AccountId;
  brokerageAccountId: AccountId;
  /** The pot it was set aside in, when it was. */
  fromEnvelopeId?: AccountId;
  date?: IsoDate;
}

/**
 * Money moved from cash into an investment account.
 *
 * The accounts are looked up rather than described by the caller: whether this
 * is allowed at all depends on what they are, and a caller passing ids plus
 * its own opinion of the rules is exactly how the two come to disagree.
 */
export async function recordInvestmentBuy(input: RecordInvestmentBuyInput): Promise<void> {
  const { cashAccount, otherAccount } = await twoAccounts(
    input.cashAccountId,
    input.brokerageAccountId,
  );

  await saveEntry(
    investmentBuy({
      ...newEntry(input.date),
      amount: input.amount,
      cashAccount,
      brokerageAccount: otherAccount,
      ...(input.fromEnvelopeId ? { fromEnvelopeId: input.fromEnvelopeId } : {}),
      system: SYSTEM_ACCOUNTS,
    }),
  );
}

/**
 * Uninvested cash taken back out of an investment account.
 *
 * Not a sale — nothing was disposed of, so nothing is realised. Selling shares
 * goes through the register, in `investmentsRepo.executeSell`, because it has
 * to relieve tax lots in the same transaction as the journal entry.
 */
export async function recordInvestmentWithdrawal(
  input: RecordInvestmentBuyInput,
): Promise<void> {
  const { cashAccount, otherAccount } = await twoAccounts(
    input.cashAccountId,
    input.brokerageAccountId,
  );

  await saveEntry(
    investmentWithdraw({
      ...newEntry(input.date),
      amount: input.amount,
      cashAccount,
      brokerageAccount: otherAccount,
      system: SYSTEM_ACCOUNTS,
    }),
  );
}

export interface RecordDividendInput {
  grossAmount: Minor;
  taxWithheld?: Minor;
  cashAccountId: AccountId;
  payer?: string;
  date?: IsoDate;
}

/** Money paid out by something you hold. Real income, unlike a valuation. */
export async function recordDividend(input: RecordDividendInput): Promise<void> {
  const accounts = await accountsById();
  const cashAccount = accounts.get(input.cashAccountId);
  if (!cashAccount) {
    throw new Error('That account could not be found, so nothing has been recorded.');
  }

  await saveEntry(
    investmentDividend({
      ...newEntry(input.date),
      grossAmount: input.grossAmount,
      ...(input.taxWithheld ? { taxWithheld: input.taxWithheld } : {}),
      cashAccount,
      ...(input.payer ? { payer: input.payer } : {}),
      system: SYSTEM_ACCOUNTS,
    }),
  );
}

/* ===========================================================================
 * MOVING MONEY BETWEEN CURRENCIES
 * ======================================================================== */

export interface RecordCrossCurrencyTransferInput {
  fromAccountId: AccountId;
  toAccountId: AccountId;
  /** What left, in the sending account's own currency. */
  fromAmount: Minor;
  /** What arrived, in the receiving account's own currency. */
  toAmount: Minor;
  fromEnvelopeId?: AccountId;
  date?: IsoDate;
}

/**
 * A transfer between two accounts in different currencies.
 *
 * The rates are looked up as of the transfer's date rather than taken from the
 * caller: a rate is only true on a day, and letting a screen pass one in is how
 * a figure from today ends up attached to last January's transfer.
 */
export async function recordCrossCurrencyTransfer(
  input: RecordCrossCurrencyTransferInput,
): Promise<void> {
  const accounts = await accountsById();
  const fromAccount = accounts.get(input.fromAccountId);
  const toAccount = accounts.get(input.toAccountId);

  if (!fromAccount || !toAccount) {
    throw new Error('One of those accounts could not be found, so nothing has been recorded.');
  }

  const entry = newEntry(input.date);
  const baseCurrency = useAppConfig.getState().currencyCode;

  const from = await getRateAsOf(fromAccount.currency ?? baseCurrency, entry.date, baseCurrency);
  const to = await getRateAsOf(toAccount.currency ?? baseCurrency, entry.date, baseCurrency);

  await saveEntry(
    transferCrossCurrency({
      ...entry,
      fromAccount,
      toAccount,
      fromAmount: input.fromAmount,
      toAmount: input.toAmount,
      fromRateScaled: from.rate,
      toRateScaled: to.rate,
      ...(input.fromEnvelopeId ? { fromEnvelopeId: input.fromEnvelopeId } : {}),
      system: SYSTEM_ACCOUNTS,
    }),
  );
}
