import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import { convertCurrency, rate1e6, type Rate1e6 } from '@/core/money/fx';
import {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  accountId,
  entryId,
  isoDate,
  liquidCash,
  netWorth,
  reverseEntry,
  totalIncome,
  totalSpending,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerSnapshot,
  type SystemAccounts,
} from '../index';
// Deep import on purpose: see the note in the ledger barrel.
import { checkInvariant, checkInvariants } from '../invariants';
import { fxRevaluation, transferCrossCurrency } from './transferCrossCurrency';

/* ===========================================================================
 * A HOUSEHOLD THAT REPORTS IN EUROS AND HOLDS DOLLARS
 * ======================================================================== */

const A = {
  euro: accountId('acc-euro'),
  dollar: accountId('acc-dollar'),
  pension: accountId('acc-pension'),
  opening: accountId('acc-opening'),
  fxVariance: accountId('eq-fx-rounding'),
  fxFee: accountId('eq-fx-fee'),
  fxUnrealized: accountId('eq-fx-unrealized'),
  salary: accountId('inc-salary'),
  groceries: accountId('cat-groceries'),
  cash: accountId('bud-cash'),
  rta: accountId('bud-rta'),
  vTravel: accountId('env-travel'),
} as const;

const SYSTEM: SystemAccounts = {
  readyToAssign: A.rta,
  budgetableCash: A.cash,
  openingBalances: A.opening,
  receivables: accountId('acc-owed'),
  reimbursementsEnvelope: accountId('env-fronted'),
  unrealizedGain: accountId('eq-gain'),
  unrealizedLoss: accountId('eq-loss'),
  realizedGain: accountId('eq-realized-gain'),
  realizedLoss: accountId('eq-realized-loss'),
  investmentTaxWithheld: accountId('eq-tax'),
  dividendIncome: accountId('inc-dividends'),
  fxRoundingVariance: A.fxVariance,
  fxConversionFee: A.fxFee,
  unrealizedFxGainLoss: A.fxUnrealized,
  interestExpense: accountId('cat-loan-interest'),
  escrowExpense: accountId('cat-escrow'),
};

function account(
  id: AccountId,
  type: LedgerAccountType,
  name: string,
  extra: Partial<LedgerAccount> = {},
): LedgerAccount {
  return {
    id,
    book: BOOK_BY_TYPE[type],
    type,
    name,
    normal: NORMAL_BY_TYPE[type],
    parentId: null,
    status: 'active',
    onBudget: false,
    liquid: false,
    paymentEnvelopeId: null,
    envelopeRole: null,
    ...extra,
  };
}

const EURO = account(A.euro, 'ASSET', 'Everyday account', {
  onBudget: true,
  liquid: true,
  accountClass: 'checking',
  currency: 'EUR',
});
// Off-budget, because it is in another currency. Dollars are yours and they
// count towards what you are worth, but they are not money you can spend on
// this week's euro shopping without converting them first — and budgetable
// cash has to mirror what is spendable exactly (I4).
const DOLLAR = account(A.dollar, 'ASSET', 'US Dollar Checking', {
  accountClass: 'checking',
  currency: 'USD',
});
const PENSION = account(A.pension, 'ASSET', 'US pension', {
  accountClass: 'retirement',
  currency: 'USD',
});

const CHART: LedgerAccount[] = [
  EURO,
  DOLLAR,
  PENSION,
  account(A.opening, 'EQUITY', 'Starting balances'),
  account(A.fxVariance, 'EQUITY', 'Rounding on currency conversions'),
  account(A.fxFee, 'EQUITY', 'What converting currency cost'),
  account(A.fxUnrealized, 'EQUITY', 'Currency movements on what you hold'),
  account(A.salary, 'INCOME', 'Pay'),
  account(A.groceries, 'EXPENSE', 'Food shopping'),
  account(A.cash, 'BUDGETABLE_CASH', 'Money you can spend'),
  account(A.rta, 'READY_TO_ASSIGN', 'Not given a job yet'),
  account(A.vTravel, 'ENVELOPE', 'Travel pot', { envelopeRole: 'category' }),
];

const ACCOUNTS = new Map(CHART.map((a) => [a.id, a]));
const snapshot = (entries: JournalEntry[]): LedgerSnapshot => ({
  accounts: ACCOUNTS,
  entries,
  baseCurrency: 'EUR',
});

const DATE = isoDate('2026-09-04');
let seq = 0;
const base = () => ({ id: entryId(`fx${++seq}`), date: DATE });

/** 1.080000 dollars to the euro. */
const USD = rate1e6(1_080_000);
const EUR = rate1e6(1_000_000);

/* ===========================================================================
 * A TRANSFER WHOSE TWO SIDES ARE DIFFERENT NUMBERS
 * ======================================================================== */

describe('moving euros into a dollar account', () => {
  const clean = () =>
    transferCrossCurrency({
      ...base(),
      fromAccount: EURO,
      toAccount: DOLLAR,
      fromAmount: minor(100_000), // €1,000.00
      toAmount: minor(108_000), // $1,080.00
      fromRateScaled: EUR,
      toRateScaled: USD,
      system: SYSTEM,
    });

  it('keeps each side exact in its own currency', () => {
    const entry = clean();
    const euro = entry.postings.find((p) => p.accountId === A.euro)!;
    const dollar = entry.postings.find((p) => p.accountId === A.dollar)!;

    // The statements say €1,000 and $1,080, and so does the ledger.
    expect(euro.amount).toBe(-100_000);
    expect(dollar.amount).toBe(108_000);
    // Both come to a thousand euros, which is the only footing they can be
    // compared on.
    expect(euro.baseAmount).toBe(-100_000);
    expect(dollar.baseAmount).toBe(100_000);
  });

  it('balances on what the lines are worth, not on what they say', () => {
    const entry = clean();
    const financial = entry.postings.filter((p) => p.book === 'FINANCIAL');

    // The native amounts do not sum to zero, and never could: €1,000 and
    // $1,080 are different numbers. This is exactly why balance moved to the
    // reporting currency.
    expect(financial.reduce((sum, p) => sum + p.amount, 0)).toBe(8_000);
    expect(financial.reduce((sum, p) => sum + p.baseAmount, 0)).toBe(0);
  });

  it('is neither income nor spending, and I6 is what says so', () => {
    const entries = [clean()];
    expect(totalSpending(snapshot(entries))).toBe(0);
    expect(totalIncome(snapshot(entries))).toBe(0);
    expect(checkInvariant('I6', snapshot(entries))).toEqual([]);
  });

  it('leaves what you are worth exactly where it was', () => {
    expect(netWorth(snapshot([clean()]))).toBe(0);
  });

  it('records a bank spread as a cost, but never as spending', () => {
    // The bank gave 1.07 when the rate on record was 1.08: $1,070 arrived
    // where $1,080 was expected, so about €9.26 went to the bank.
    const entry = transferCrossCurrency({
      ...base(),
      fromAccount: EURO,
      toAccount: DOLLAR,
      fromAmount: minor(100_000),
      toAmount: minor(107_000),
      fromRateScaled: EUR,
      toRateScaled: USD,
      system: SYSTEM,
    });

    const fee = entry.postings.find((p) => p.accountId === A.fxFee)!;
    expect(fee.amount).toBe(100_000 - convertCurrency(minor(107_000), USD, 'quoteToBase'));
    expect(fee.amount).toBeGreaterThan(0);

    // A cost, and still not spending: nobody chose to buy anything.
    const after = snapshot([entry]);
    expect(totalSpending(after)).toBe(0);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('refuses a transfer to the account it came from', () => {
    expect(() =>
      transferCrossCurrency({
        ...base(),
        fromAccount: EURO,
        toAccount: EURO,
        fromAmount: minor(100_000),
        toAmount: minor(100_000),
        fromRateScaled: EUR,
        toRateScaled: EUR,
        system: SYSTEM,
      }),
    ).toThrow(LedgerError);
  });

  it('takes the money out of the budget when it leaves spendable accounts', () => {
    const entry = transferCrossCurrency({
      ...base(),
      fromAccount: EURO,
      toAccount: PENSION,
      fromAmount: minor(100_000),
      toAmount: minor(108_000),
      fromRateScaled: EUR,
      toRateScaled: USD,
      fromEnvelopeId: A.vTravel,
      system: SYSTEM,
    });

    const budget = entry.postings.filter((p) => p.book === 'BUDGET');
    expect(budget.find((p) => p.accountId === A.vTravel)!.baseAmount).toBe(100_000);
    expect(budget.find((p) => p.accountId === A.cash)!.baseAmount).toBe(-100_000);
  });

  it('refuses to hold a foreign account inside the budget', () => {
    const wrong = { ...DOLLAR, onBudget: true, liquid: true };
    expect(() =>
      transferCrossCurrency({
        ...base(),
        fromAccount: EURO,
        toAccount: wrong,
        fromAmount: minor(100_000),
        toAmount: minor(108_000),
        fromRateScaled: EUR,
        toRateScaled: USD,
        system: SYSTEM,
      }),
    ).toThrow(/not money you can spend today/);
  });
});

/* ===========================================================================
 * I2 — THE CENT THAT CONVERTING CANNOT PLACE
 * ---------------------------------------------------------------------------
 * Restored to its Phase 1 form: a residual has to be posted where it can be
 * pointed at, never absorbed into whichever line happened to be largest.
 * ======================================================================== */

describe('invariant I2, across two hundred random conversions', () => {
  it('balances every entry in the reporting currency, with nothing absorbed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 500_000, max: 5_000_000 }),
        (fromAmount, toAmount, rateScaled) => {
          const entry = transferCrossCurrency({
            ...base(),
            fromAccount: EURO,
            toAccount: DOLLAR,
            fromAmount: minor(fromAmount),
            toAmount: minor(toAmount),
            fromRateScaled: EUR,
            toRateScaled: rate1e6(rateScaled) as Rate1e6,
            system: SYSTEM,
          });

          const after = snapshot([entry]);

          // Every book sums to zero in the reporting currency.
          for (const book of ['FINANCIAL', 'BUDGET'] as const) {
            const lines = entry.postings.filter((p) => p.book === book);
            if (lines.length === 0) continue;
            expect(lines.reduce((sum, p) => sum + p.baseAmount, 0)).toBe(0);
          }

          // And every line is its own amount at its own rate — which is what
          // makes "nothing was absorbed" checkable rather than asserted.
          expect(checkInvariant('I2', after)).toEqual([]);
          expect(checkInvariants(after)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('catches a line that was quietly adjusted to force a balance', () => {
    const entry = transferCrossCurrency({
      ...base(),
      fromAccount: EURO,
      toAccount: DOLLAR,
      fromAmount: minor(100_000),
      toAmount: minor(108_000),
      fromRateScaled: EUR,
      toRateScaled: USD,
      system: SYSTEM,
    });

    // Nudge one line's base amount and its opposite, so the entry still
    // balances but neither line matches the rate it claims. This is exactly
    // the failure a naive implementation produces, and it is invisible to a
    // balance check on its own.
    const forged = structuredClone(entry);
    forged.postings[0]!.baseAmount = minor(forged.postings[0]!.baseAmount - 1);
    forged.postings[1]!.baseAmount = minor(forged.postings[1]!.baseAmount + 1);

    const violations = checkInvariant('I2', snapshot([forged]));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.message).toMatch(/absorbed into it instead of being/);
  });
});

/* ===========================================================================
 * I10 — A REVERSAL LEAVES NOTHING BEHIND, IN EITHER CURRENCY
 * ======================================================================== */

describe('invariant I10, on a multi-currency entry', () => {
  it('cancels both the native amounts and what they were worth', () => {
    const original = transferCrossCurrency({
      ...base(),
      fromAccount: EURO,
      toAccount: DOLLAR,
      fromAmount: minor(100_000),
      toAmount: minor(107_000),
      fromRateScaled: EUR,
      toRateScaled: USD,
      system: SYSTEM,
    });

    const undone = reverseEntry(original, entryId('rev1'), DATE, 'Cancelled.');
    const after = snapshot([original, undone]);

    const native = new Map<string, number>();
    const reported = new Map<string, number>();
    for (const p of [...original.postings, ...undone.postings]) {
      native.set(p.accountId, (native.get(p.accountId) ?? 0) + p.amount);
      reported.set(p.accountId, (reported.get(p.accountId) ?? 0) + p.baseAmount);
    }

    for (const value of native.values()) expect(value).toBe(0);
    for (const value of reported.values()) expect(value).toBe(0);

    // And nothing is left stranded in the variance account.
    expect(reported.get(A.fxVariance) ?? 0).toBe(0);
    expect(checkInvariant('I10', after)).toEqual([]);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('catches a reversal that undid only the native side', () => {
    const original = transferCrossCurrency({
      ...base(),
      fromAccount: EURO,
      toAccount: DOLLAR,
      fromAmount: minor(100_000),
      toAmount: minor(108_000),
      fromRateScaled: EUR,
      toRateScaled: USD,
      system: SYSTEM,
    });

    const undone = reverseEntry(original, entryId('rev2'), DATE, 'Cancelled.');
    // The bug this guards against: negating what the statement says while
    // leaving what you are worth exactly where it was.
    const halfDone = structuredClone(undone);
    for (const p of halfDone.postings) p.baseAmount = minor(-p.baseAmount);

    const violations = checkInvariant('I10', snapshot([original, halfDone]));
    expect(violations.length).toBeGreaterThan(0);
  });

  it('cancels exactly across two hundred random pairs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 500_000, max: 5_000_000 }),
        (fromAmount, toAmount, rateScaled) => {
          const original = transferCrossCurrency({
            ...base(),
            fromAccount: EURO,
            toAccount: DOLLAR,
            fromAmount: minor(fromAmount),
            toAmount: minor(toAmount),
            fromRateScaled: EUR,
            toRateScaled: rate1e6(rateScaled) as Rate1e6,
            system: SYSTEM,
          });

          const undone = reverseEntry(original, entryId(`r${seq}`), DATE, 'Cancelled.');
          const after = snapshot([original, undone]);

          expect(netWorth(after)).toBe(0);
          expect(liquidCash(after)).toBe(0);
          expect(checkInvariants(after)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* ===========================================================================
 * A BALANCE RESTATED AT TODAY'S RATE
 * ======================================================================== */

describe('revaluing a foreign balance', () => {
  it('moves what you are worth without anything having been earned or spent', () => {
    // $5,000 recorded at 1.10 is €4,545.45. At 1.05 it is €4,761.90.
    const entry = fxRevaluation({
      ...base(),
      account: DOLLAR,
      nativeBalance: minor(500_000),
      currentBaseValue: minor(454_545),
      newBaseValue: minor(476_190),
      newRateScaled: rate1e6(1_050_000),
      system: SYSTEM,
    });

    expect(entry.kind).toBe('FX_REVALUATION');
    expect(entry.postings.find((p) => p.accountId === A.dollar)!.baseAmount).toBe(21_645);
    expect(entry.postings.find((p) => p.accountId === A.fxUnrealized)!.baseAmount).toBe(-21_645);

    const after = snapshot([entry]);
    expect(totalSpending(after)).toBe(0);
    expect(totalIncome(after)).toBe(0);
    expect(netWorth(after)).toBe(21_645);
    expect(checkInvariants(after)).toEqual([]);
  });

  it('refuses to restate an account that is part of the budget', () => {
    expect(() =>
      fxRevaluation({
        ...base(),
        account: { ...DOLLAR, onBudget: true, liquid: true },
        nativeBalance: minor(500_000),
        currentBaseValue: minor(454_545),
        newBaseValue: minor(476_190),
        newRateScaled: rate1e6(1_050_000),
        system: SYSTEM,
      }),
    ).toThrow(/Move it to tracking-only first/);
  });

  it('refuses to restate a balance that is already at today’s rate', () => {
    expect(() =>
      fxRevaluation({
        ...base(),
        account: DOLLAR,
        nativeBalance: minor(500_000),
        currentBaseValue: minor(454_545),
        newBaseValue: minor(454_545),
        newRateScaled: rate1e6(1_100_000),
        system: SYSTEM,
      }),
    ).toThrow(/already recorded at today/);
  });
});
