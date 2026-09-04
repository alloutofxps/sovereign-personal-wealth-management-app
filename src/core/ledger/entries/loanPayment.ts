/* ===========================================================================
 * A LOAN PAYMENT, RECORDED HONESTLY
 * ---------------------------------------------------------------------------
 * The entry this whole slice exists for. One payment leaves the account, and
 * it has to land in three or four places at once:
 *
 *   · cash goes down by the whole amount, because that is what happened;
 *   · the debt goes down by the principal only;
 *   · the interest is booked as the cost it is;
 *   · anything the lender holds for tax and insurance is booked too.
 *
 * The two books then disagree on purpose, and that disagreement is the point.
 * On the FINANCIAL side, net worth falls by only the interest and the escrow —
 * the principal moved from one column to another and made nobody poorer. On
 * the BUDGET side, the entire payment comes out of an envelope, because
 * spendable money does not care that some of it bought equity. Somebody who
 * has just paid a mortgage has less to spend this month by the full amount,
 * and Safe-to-Spend must say so.
 *
 * Getting this wrong in either direction is the ordinary failure of consumer
 * finance software. Book it all as spending and twenty years of building
 * equity looks like twenty years of pouring money away. Book it all against
 * the debt and the interest disappears, and net worth climbs by the whole
 * payment every month — a lie in the flattering direction.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import {
  LedgerError,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type SystemAccounts,
} from '../types';
import { buildEntry, credit, debit, type EntryBase } from './common';

const FIN = 'FINANCIAL' as const;
const BUD = 'BUDGET' as const;

export interface LoanPaymentParams extends EntryBase {
  /** Where the money came from. */
  fundingAccount: LedgerAccount;
  /** The loan being paid. */
  loanAccount: LedgerAccount;
  /** The part that reduces the debt, before anything extra. */
  principal: Minor;
  /** The part that is the cost of the money. */
  interest: Minor;
  /** Held by the lender for tax and insurance. Zero for most loans. */
  escrow?: Minor;
  /** Anything paid over the contractual amount. All of it repays the debt. */
  extraPrincipal?: Minor;
  /**
   * Which envelope this comes out of.
   *
   * Required whenever the money leaves an on-budget account, because the full
   * payment has to come out of somewhere that was set aside for it. Ignored
   * when it does not.
   */
  envelopeId?: AccountId;
  system: SystemAccounts;
}

export function loanPayment(p: LoanPaymentParams): JournalEntry {
  const principal = requireNonNegative(p.principal, 'The part that repays the loan');
  const interest = requireNonNegative(p.interest, 'The interest');
  const escrow = requireNonNegative(p.escrow ?? minor(0), 'The amount held for tax and insurance');
  const extra = requireNonNegative(p.extraPrincipal ?? minor(0), 'The extra payment');

  const towardsDebt = minor(principal + extra);
  const total = minor(towardsDebt + interest + escrow);

  if (total <= 0) {
    throw new LedgerError('A loan payment has to be for some amount of money.');
  }

  if (p.loanAccount.type !== 'LIABILITY') {
    throw new LedgerError(
      `${p.loanAccount.name} is not something you owe, so a loan payment cannot be ` +
        `recorded against it.`,
    );
  }

  // A euro payment cannot reduce a dollar debt by a euro. Converting it would
  // mean guessing the rate the lender used, which is knowable only from the
  // statement, so this says so instead of inventing a figure.
  const fundingCurrency = p.fundingAccount.currency ?? null;
  const loanCurrency = p.loanAccount.currency ?? null;
  if (fundingCurrency !== loanCurrency && (fundingCurrency ?? loanCurrency) !== null) {
    throw new LedgerError(
      `${p.fundingAccount.name} and ${p.loanAccount.name} are in different currencies. ` +
        `Convert the money first, then record the payment from the account it left.`,
    );
  }

  // The whole payment leaves the budget, principal included. Money that has
  // gone into a house is not money available for groceries.
  const onBudget = p.fundingAccount.onBudget && p.fundingAccount.liquid;
  if (onBudget && !p.envelopeId) {
    throw new LedgerError(
      `A payment from ${p.fundingAccount.name} has to come out of a pot, because the ` +
        `money is no longer there to spend.`,
    );
  }

  const budget =
    onBudget && p.envelopeId
      ? [debit(BUD, p.envelopeId, total), credit(BUD, p.system.budgetableCash, total)]
      : [];

  return buildEntry(p, 'LOAN_PAYMENT', describeLoanPayment(p.loanAccount.name, towardsDebt), [
    // Debits first, in the order somebody would read them: what it repaid,
    // what it cost, what the lender is holding.
    ...(towardsDebt > 0 ? [debit(FIN, p.loanAccount.id, towardsDebt)] : []),
    ...(interest > 0
      ? [debit(FIN, p.system.interestExpense, interest, `Interest on ${p.loanAccount.name}`)]
      : []),
    ...(escrow > 0
      ? [debit(FIN, p.system.escrowExpense, escrow, 'Held by the lender for tax and insurance')]
      : []),
    credit(FIN, p.fundingAccount.id, total),
    ...budget,
  ]);
}

function requireNonNegative(amount: Minor, what: string): Minor {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new LedgerError(`${what} cannot be a negative amount.`);
  }
  return amount;
}

/**
 * What this entry says in the list.
 *
 * Names the part that stayed yours, because that is the fact nobody is ever
 * shown and the reason this entry is not a plain payment.
 */
export function describeLoanPayment(loanName: string, towardsDebt: Minor): string {
  if (towardsDebt <= 0) return `Paid the interest on ${loanName}.`;
  return `Paid ${loanName}, and part of it came off what you owe.`;
}
