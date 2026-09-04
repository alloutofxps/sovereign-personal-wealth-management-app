import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { basisPoints, minor } from '@/core/money';
import {
  LoanError,
  calculateEarlyPayoff,
  calculateNextLoanSplit,
  describeMonths,
  describePayoff,
  describeProgress,
  describeSplit,
  generateAmortizationSchedule,
  totalsOf,
  type LoanTerms,
} from './amortization';

/** €200,000 over 30 years at 4.00%. The worked example in the brief. */
const MORTGAGE: LoanTerms = {
  currentBalance: minor(20_000_000),
  annualRateBp: basisPoints(400),
  monthlyPayment: minor(95_483),
  termMonths: 360,
  nextPaymentDate: '2026-10-01',
};

const euro = (amount: number) => `€${(amount / 100).toFixed(2)}`;

describe('the split of a single payment', () => {
  it('divides the first mortgage payment the way the lender does', () => {
    const split = calculateNextLoanSplit(MORTGAGE);

    // 200,000 × 4% ÷ 12 = 666.666… → 666.67, and the rest buys the house.
    expect(split.interest).toBe(66_667);
    expect(split.principal).toBe(28_816);
    expect(split.totalPayment).toBe(95_483);
    expect(split.remainingBalance).toBe(20_000_000 - 28_816);
    expect(split.isFinal).toBe(false);
  });

  it('adds escrow to what leaves the account without touching the debt', () => {
    const split = calculateNextLoanSplit({ ...MORTGAGE, escrowMonthly: minor(25_000) });

    expect(split.escrow).toBe(25_000);
    expect(split.totalPayment).toBe(95_483 + 25_000);
    // Escrow is not borrowing, so it repays nothing.
    expect(split.principal).toBe(28_816);
    expect(split.remainingBalance).toBe(20_000_000 - 28_816);
  });

  it('never repays more than is owed', () => {
    const split = calculateNextLoanSplit({
      ...MORTGAGE,
      currentBalance: minor(50_000),
    });

    expect(split.interest).toBe(167);
    expect(split.principal).toBe(50_000);
    expect(split.totalPayment).toBe(50_167);
    expect(split.remainingBalance).toBe(0);
    expect(split.isFinal).toBe(true);
  });

  it('puts extra money entirely against the debt', () => {
    const plain = calculateNextLoanSplit(MORTGAGE);
    const extra = calculateNextLoanSplit(MORTGAGE, minor(20_000));

    expect(extra.interest).toBe(plain.interest);
    expect(extra.principal).toBe(plain.principal + 20_000);
    expect(extra.totalPayment).toBe(plain.totalPayment + 20_000);
  });

  it('charges nothing on a loan that is already settled', () => {
    const split = calculateNextLoanSplit({ ...MORTGAGE, currentBalance: minor(0) });
    expect(split.totalPayment).toBe(0);
    expect(split.interest).toBe(0);
  });
});

describe('the schedule', () => {
  it('lands on exactly nothing, never on a stray cent', () => {
    const rows = generateAmortizationSchedule(MORTGAGE);
    const last = rows[rows.length - 1]!;

    expect(last.remainingBalance).toBe(0);
    expect(rows.every((r) => r.remainingBalance >= 0)).toBe(true);
    // The final instalment is snapped, so it is not the contractual figure.
    expect(last.payment).toBeLessThanOrEqual(MORTGAGE.monthlyPayment);
  });

  it('runs to roughly the contracted term', () => {
    const rows = generateAmortizationSchedule(MORTGAGE);
    // €954.83 is the annuity payment for 360 months; rounding to the cent every
    // month moves the finish line by at most a payment either way.
    expect(rows.length).toBeGreaterThanOrEqual(359);
    expect(rows.length).toBeLessThanOrEqual(361);
  });

  it('numbers payments on from the ones already made', () => {
    const rows = generateAmortizationSchedule({ ...MORTGAGE, paymentsMade: 24 });
    expect(rows[0]!.paymentNumber).toBe(25);
    expect(rows[1]!.paymentNumber).toBe(26);
  });

  it('dates each payment a month apart, clamping short months', () => {
    const rows = generateAmortizationSchedule({ ...MORTGAGE, nextPaymentDate: '2026-01-31' });
    expect(rows[0]!.date).toBe('2026-01-31');
    expect(rows[1]!.date).toBe('2026-02-28');
    expect(rows[2]!.date).toBe('2026-03-31');
  });

  it('shifts from mostly interest to mostly principal', () => {
    const rows = generateAmortizationSchedule(MORTGAGE);
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;

    expect(first.interest).toBeGreaterThan(first.principal);
    expect(last.principal).toBeGreaterThan(last.interest);
  });

  it('says so plainly when the payment cannot cover the interest', () => {
    expect(() =>
      generateAmortizationSchedule({ ...MORTGAGE, monthlyPayment: minor(50_000) }),
    ).toThrow(LoanError);
    expect(() =>
      generateAmortizationSchedule({ ...MORTGAGE, monthlyPayment: minor(50_000) }),
    ).toThrow(/does not cover the interest/);
  });

  it('has nothing to show for a loan that is paid off', () => {
    expect(generateAmortizationSchedule({ ...MORTGAGE, currentBalance: minor(0) })).toEqual([]);
  });

  it('repays an interest-free loan in equal instalments', () => {
    const rows = generateAmortizationSchedule({
      currentBalance: minor(120_000),
      annualRateBp: basisPoints(0),
      monthlyPayment: minor(10_000),
    });

    expect(rows.length).toBe(12);
    expect(rows.every((r) => r.interest === 0)).toBe(true);
    expect(totalsOf(rows).totalPrincipal).toBe(120_000);
  });
});

describe('paying more than the contract asks', () => {
  it('shortens the loan and saves interest', () => {
    const comparison = calculateEarlyPayoff(MORTGAGE, minor(20_000));

    expect(comparison.monthsSaved).toBeGreaterThan(0);
    expect(comparison.interestSaved).toBeGreaterThan(0);
    expect(comparison.accelerated.months).toBeLessThan(comparison.contract.months);
    // Both routes repay the same debt; only the interest differs.
    expect(comparison.accelerated.totalPrincipal).toBe(comparison.contract.totalPrincipal);
  });

  it('changes nothing when nothing extra is paid', () => {
    const comparison = calculateEarlyPayoff(MORTGAGE, minor(0));
    expect(comparison.monthsSaved).toBe(0);
    expect(comparison.interestSaved).toBe(0);
  });

  it('saves more the more is paid', () => {
    const small = calculateEarlyPayoff(MORTGAGE, minor(10_000));
    const large = calculateEarlyPayoff(MORTGAGE, minor(50_000));

    expect(large.interestSaved).toBeGreaterThan(small.interestSaved);
    expect(large.monthsSaved).toBeGreaterThan(small.monthsSaved);
  });
});

describe('what it says out loud', () => {
  it('names both halves of the payment without giving advice', () => {
    const sentence = describeSplit(calculateNextLoanSplit(MORTGAGE), (a) => euro(a));

    expect(sentence).toContain('€288.16');
    expect(sentence).toContain('€666.67');
    expect(sentence).toContain('builds your equity');
    expect(sentence).not.toMatch(/should|ought|consider|recommend/i);
  });

  it('mentions escrow only when there is escrow', () => {
    const without = describeSplit(calculateNextLoanSplit(MORTGAGE), euro);
    const withEscrow = describeSplit(
      calculateNextLoanSplit({ ...MORTGAGE, escrowMonthly: minor(25_000) }),
      euro,
    );

    expect(without).not.toContain('insurance');
    expect(withEscrow).toContain('€250.00');
  });

  it('says when a payment finishes the loan', () => {
    const sentence = describeSplit(
      calculateNextLoanSplit({ ...MORTGAGE, currentBalance: minor(50_000) }),
      euro,
    );
    expect(sentence).toContain('clears the loan');
  });

  it('counts months in years and months', () => {
    expect(describeMonths(0)).toBe('no time at all');
    expect(describeMonths(1)).toBe('1 month');
    expect(describeMonths(12)).toBe('1 year');
    expect(describeMonths(40)).toBe('3 years and 4 months');
  });

  it('states the trade without telling anyone what to do', () => {
    const sentence = describePayoff(calculateEarlyPayoff(MORTGAGE, minor(20_000)), euro);
    expect(sentence).toMatch(/shaves/);
    expect(sentence).not.toMatch(/should|worth doing|better off/i);
  });

  it('handles an overpayment too small to save a whole month', () => {
    const sentence = describePayoff(calculateEarlyPayoff(MORTGAGE, minor(1)), euro);
    expect(sentence).toMatch(/not quite enough|shaves/);
  });

  it('reports progress against the term, or the count when there is none', () => {
    expect(describeProgress({ paymentsMade: 24, termMonths: 360 })).toBe(
      'Paid off 24 of 360 months (6.7%).',
    );
    expect(describeProgress({ paymentsMade: 1, termMonths: null })).toBe('1 payment made so far.');
    expect(describeProgress({ paymentsMade: 0, termMonths: null })).toBe(
      'No payments recorded yet.',
    );
  });
});

/* ===========================================================================
 * THE CONSERVATION PROPERTY
 * ---------------------------------------------------------------------------
 * The one that matters. Over three hundred and sixty rounding operations, the
 * principal repaid has to add back to exactly what was borrowed — not within a
 * cent, exactly — or the schedule and the balance sheet tell different stories.
 * ======================================================================== */

describe('conservation', () => {
  it('repays exactly the principal over a 30-year term', () => {
    const rows = generateAmortizationSchedule(MORTGAGE);
    expect(totalsOf(rows).totalPrincipal).toBe(20_000_000);
  });

  it('repays exactly the principal for any loan that can be repaid', () => {
    fc.assert(
      fc.property(
        // €100 to €2,000,000, 0% to 25%, over a plausible range of payments.
        fc.integer({ min: 10_000, max: 200_000_000 }),
        fc.integer({ min: 0, max: 2500 }),
        fc.integer({ min: 12, max: 480 }),
        (balance, rateBp, months) => {
          // A payment generous enough to always clear the interest: the
          // straight-line repayment plus a full month's interest on the whole
          // balance, which is more than any single month can ever accrue.
          const interestFloor = Math.ceil((balance * rateBp) / (10_000 * 12));
          const payment = Math.ceil(balance / months) + interestFloor + 1;

          const rows = generateAmortizationSchedule({
            currentBalance: minor(balance),
            annualRateBp: basisPoints(rateBp),
            monthlyPayment: minor(payment),
          });

          const totals = totalsOf(rows);
          expect(totals.totalPrincipal).toBe(balance);
          expect(rows[rows.length - 1]!.remainingBalance).toBe(0);
          // Every payment is principal plus interest, to the cent.
          expect(totals.totalPaid).toBe(totals.totalPrincipal + totals.totalInterest);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never lets the balance go negative or a payment go backwards', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10_000, max: 50_000_000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (balance, rateBp, extra) => {
          const payment = Math.ceil(balance / 60) + Math.ceil((balance * rateBp) / 120_000) + 1;

          const rows = generateAmortizationSchedule(
            {
              currentBalance: minor(balance),
              annualRateBp: basisPoints(rateBp),
              monthlyPayment: minor(payment),
            },
            { extraMonthlyPrincipal: minor(extra) },
          );

          let running = balance;
          for (const row of rows) {
            expect(row.principal).toBeGreaterThanOrEqual(0);
            expect(row.interest).toBeGreaterThanOrEqual(0);
            expect(row.payment).toBe(row.principal + row.interest);
            running -= row.principal;
            expect(row.remainingBalance).toBe(running);
            expect(row.remainingBalance).toBeGreaterThanOrEqual(0);
          }
          expect(running).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
