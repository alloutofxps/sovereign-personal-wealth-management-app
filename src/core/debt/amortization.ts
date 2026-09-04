/* ===========================================================================
 * WHAT A LOAN PAYMENT IS ACTUALLY DOING
 * ---------------------------------------------------------------------------
 * One number, two entirely different things. Part of a mortgage payment buys a
 * piece of the house; the rest is rent on the money and is gone. Early on the
 * ratio is brutal — on a €200,000 mortgage at 4%, the first payment is €666.67
 * of interest against €288.16 of principal — and it is the single fact most
 * likely to change what somebody does, because nobody is ever shown it.
 *
 * Everything here is integer arithmetic, and the reason is not neatness. A
 * schedule computed in floating point drifts by a few cents a month over three
 * hundred and sixty months, and the last payment ends up leaving a balance of
 * −€0.03 or €0.11. Nobody can pay off −3 cents. The final payment is snapped
 * explicitly instead, and the property tests assert that every principal
 * payment across the whole term adds back to exactly what was borrowed.
 *
 * The rate is an annual figure in basis points, divided by twelve. That is what
 * lenders actually do — it is not the true compounded monthly equivalent, and
 * using the mathematically purer figure would produce a schedule that disagrees
 * with the bank's own statement by a few euros a year. Agreeing with the
 * statement matters more than being elegant.
 * ======================================================================== */

import { minor, monthlyInterest, type BasisPoints, type Minor } from '@/core/money';

export class LoanError extends Error {
  override name = 'LoanError';
}

export interface LoanTerms {
  /** What is still owed today, in minor units. */
  currentBalance: Minor;
  /** Annual rate in basis points. 400 is 4.00% a year. */
  annualRateBp: BasisPoints;
  /** The contractual payment, principal and interest only. */
  monthlyPayment: Minor;
  /** Held by the lender for taxes and insurance. Not borrowing. */
  escrowMonthly?: Minor;
  /** 'YYYY-MM-DD' of the next payment. Used only to date the schedule. */
  nextPaymentDate?: string;
  /** How many payments have already been made. Drives the progress figure. */
  paymentsMade?: number;
  /** The contract length, when it is known. */
  termMonths?: number;
}

export interface ScheduleRow {
  paymentNumber: number;
  /** 'YYYY-MM-DD'. Absent when no start date was given. */
  date: string;
  /** What leaves the account, principal and interest. Excludes escrow. */
  payment: Minor;
  principal: Minor;
  interest: Minor;
  remainingBalance: Minor;
}

/** The most months a schedule will ever run to, so a bad rate cannot hang. */
const MAX_MONTHS = 1200;

/** Add whole months to an ISO date, clamping the day to the month's length. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const year = (y ?? 1970) + Math.floor(((m ?? 1) - 1 + months) / 12);
  const month = ((((m ?? 1) - 1 + months) % 12) + 12) % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d ?? 1, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Every remaining payment, until the balance is exactly nothing.
 *
 * The last row is snapped: whatever is left after the interest is added becomes
 * the payment, so the balance lands on zero rather than on a stray cent either
 * side. That is also what lenders do — the final instalment on a mortgage is
 * almost never the contractual figure.
 */
export function generateAmortizationSchedule(
  terms: LoanTerms,
  options: { extraMonthlyPrincipal?: Minor; maxRows?: number } = {},
): ScheduleRow[] {
  const extra = minor(Math.max(0, options.extraMonthlyPrincipal ?? 0));

  if (terms.currentBalance <= 0) return [];
  if (terms.monthlyPayment <= 0) {
    throw new LoanError('A loan needs a monthly payment before it can be worked out.');
  }

  // A payment that does not cover the first month's interest never repays
  // anything — the balance grows every month forever. Saying so is far more
  // use than running to the thousand-month cap and showing a wall of rows.
  const firstInterest = monthlyInterest(terms.currentBalance, terms.annualRateBp);
  if (terms.monthlyPayment + extra <= firstInterest) {
    throw new LoanError(
      `A payment of this size does not cover the interest, so the debt would grow rather ` +
        `than shrink. The interest alone is more than the payment.`,
    );
  }

  const rows: ScheduleRow[] = [];
  const limit = Math.min(options.maxRows ?? MAX_MONTHS, MAX_MONTHS);
  const startDate = terms.nextPaymentDate ?? null;
  const madeAlready = terms.paymentsMade ?? 0;

  let balance: number = terms.currentBalance;

  for (let index = 0; index < limit && balance > 0; index++) {
    const interest = monthlyInterest(minor(balance), terms.annualRateBp);

    // Never more principal than is left, and never a payment larger than
    // clearing the debt requires. Both bounds are the same fact: you cannot
    // pay off more than you owe.
    const wanted = terms.monthlyPayment + extra - interest;
    const principal = Math.min(balance, Math.max(0, wanted));
    const payment = principal + interest;

    balance -= principal;

    rows.push({
      paymentNumber: madeAlready + index + 1,
      date: startDate ? addMonths(startDate, index) : '',
      payment: minor(payment),
      principal: minor(principal),
      interest,
      remainingBalance: minor(balance),
    });
  }

  return rows;
}

export interface ScheduleTotals {
  months: number;
  totalPaid: Minor;
  totalInterest: Minor;
  totalPrincipal: Minor;
  /** 'YYYY-MM-DD' of the last payment, when dates were supplied. */
  payoffDate: string | null;
}

/** What a schedule comes to in total. */
export function totalsOf(rows: readonly ScheduleRow[]): ScheduleTotals {
  let paid = 0;
  let interest = 0;
  let principal = 0;

  for (const row of rows) {
    paid += row.payment;
    interest += row.interest;
    principal += row.principal;
  }

  const last = rows[rows.length - 1];
  return {
    months: rows.length,
    totalPaid: minor(paid),
    totalInterest: minor(interest),
    totalPrincipal: minor(principal),
    payoffDate: last?.date || null,
  };
}

/* ===========================================================================
 * PAYING MORE THAN YOU HAVE TO
 * ======================================================================== */

export interface PayoffComparison {
  extraMonthly: Minor;
  /** Where the contract, followed to the letter, would end. */
  contract: ScheduleTotals;
  /** Where paying extra every month would end instead. */
  accelerated: ScheduleTotals;
  monthsSaved: number;
  interestSaved: Minor;
}

/**
 * What paying a bit more each month would do.
 *
 * Both schedules are generated in full and compared, rather than solved in
 * closed form. A formula would be faster and would disagree with the schedule
 * shown on the same screen by a few euros, because the schedule rounds every
 * month and the formula does not. Agreeing with what is on screen matters more
 * than the microseconds.
 */
export function calculateEarlyPayoff(
  terms: LoanTerms,
  extraMonthlyPrincipal: Minor,
): PayoffComparison {
  const contract = totalsOf(generateAmortizationSchedule(terms));
  const extra = minor(Math.max(0, extraMonthlyPrincipal));

  if (extra === 0) {
    return {
      extraMonthly: extra,
      contract,
      accelerated: contract,
      monthsSaved: 0,
      interestSaved: minor(0),
    };
  }

  const accelerated = totalsOf(
    generateAmortizationSchedule(terms, { extraMonthlyPrincipal: extra }),
  );

  return {
    extraMonthly: extra,
    contract,
    accelerated,
    monthsSaved: contract.months - accelerated.months,
    interestSaved: minor(contract.totalInterest - accelerated.totalInterest),
  };
}

/* ===========================================================================
 * THE NEXT PAYMENT
 * ======================================================================== */

export interface PaymentSplit {
  principal: Minor;
  interest: Minor;
  escrow: Minor;
  /** What leaves the account in total, escrow included. */
  totalPayment: Minor;
  /** What would be left owing afterwards. */
  remainingBalance: Minor;
  /** True when this payment clears the loan. */
  isFinal: boolean;
}

/**
 * What the next payment will be made of.
 *
 * The one figure this whole slice exists to show. Everything else — the
 * schedule, the simulator, the chart — is context for it.
 */
export function calculateNextLoanSplit(
  terms: LoanTerms,
  extraPrincipal: Minor = minor(0),
): PaymentSplit {
  const escrow = minor(Math.max(0, terms.escrowMonthly ?? 0));
  const extra = minor(Math.max(0, extraPrincipal));

  if (terms.currentBalance <= 0) {
    return {
      principal: minor(0),
      interest: minor(0),
      escrow,
      totalPayment: escrow,
      remainingBalance: minor(0),
      isFinal: false,
    };
  }

  const interest = monthlyInterest(terms.currentBalance, terms.annualRateBp);
  const wanted = terms.monthlyPayment + extra - interest;
  const principal = minor(Math.min(terms.currentBalance, Math.max(0, wanted)));
  const remaining = minor(terms.currentBalance - principal);

  return {
    principal,
    interest,
    escrow,
    totalPayment: minor(principal + interest + escrow),
    remainingBalance: remaining,
    isFinal: remaining === 0,
  };
}

/* ===========================================================================
 * SAYING IT IN WORDS
 * ======================================================================== */

/** `40` → `3 years and 4 months`. */
export function describeMonths(months: number): string {
  if (months <= 0) return 'no time at all';
  const years = Math.floor(months / 12);
  const rest = months % 12;

  const yearPart = years > 0 ? `${years} ${years === 1 ? 'year' : 'years'}` : '';
  const monthPart = rest > 0 ? `${rest} ${rest === 1 ? 'month' : 'months'}` : '';

  if (yearPart && monthPart) return `${yearPart} and ${monthPart}`;
  return yearPart || monthPart;
}

/**
 * What the next payment does, in the words somebody would use.
 *
 * "Builds your equity" rather than "reduces principal": the point is not the
 * accounting, it is that part of this payment is still theirs afterwards and
 * part of it is not.
 */
export function describeSplit(
  split: PaymentSplit,
  format: (amount: Minor) => string,
): string {
  if (split.isFinal) {
    return (
      `${format(split.totalPayment)} clears the loan completely. ` +
      `${format(split.interest)} of it is the last of the interest.`
    );
  }

  const escrowPart =
    split.escrow > 0
      ? ` Another ${format(split.escrow)} goes to the lender to pay your tax and insurance ` +
        `bills when they come.`
      : '';

  return (
    `${format(split.principal)} of this payment builds your equity — it reduces what you ` +
    `owe, so it stays yours. ${format(split.interest)} is interest, which is the cost of ` +
    `the money and does not come back.${escrowPart}`
  );
}

/**
 * What paying extra would achieve.
 *
 * States the trade and stops. Whether somebody should overpay a 4% mortgage or
 * invest the difference depends on their tax position, their other debts and
 * how they sleep, none of which this app knows.
 */
export function describePayoff(
  comparison: PayoffComparison,
  format: (amount: Minor) => string,
): string {
  if (comparison.extraMonthly === 0) {
    return (
      `Following the contract, this is paid off in ${describeMonths(comparison.contract.months)}, ` +
      `having cost ${format(comparison.contract.totalInterest)} in interest along the way.`
    );
  }

  if (comparison.monthsSaved <= 0) {
    return (
      `${format(comparison.extraMonthly)} a month extra is not quite enough to shorten this ` +
      `by a whole month, though it still saves ${format(comparison.interestSaved)} in interest.`
    );
  }

  return (
    `Paying ${format(comparison.extraMonthly)} extra each month shaves ` +
    `${describeMonths(comparison.monthsSaved)} off this loan and saves ` +
    `${format(comparison.interestSaved)} in interest you would otherwise pay the lender.`
  );
}

/** How far through the contract this loan is. */
export function describeProgress(input: {
  paymentsMade: number;
  termMonths: number | null;
}): string {
  if (!input.termMonths || input.termMonths <= 0) {
    return input.paymentsMade > 0
      ? `${input.paymentsMade} ${input.paymentsMade === 1 ? 'payment' : 'payments'} made so far.`
      : 'No payments recorded yet.';
  }

  const share = Math.round((input.paymentsMade / input.termMonths) * 1000) / 10;
  return `Paid off ${input.paymentsMade} of ${input.termMonths} months (${share.toFixed(1)}%).`;
}
