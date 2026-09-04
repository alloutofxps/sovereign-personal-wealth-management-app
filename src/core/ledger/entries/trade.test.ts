import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  accountId,
  assign,
  checkInvariant,
  checkInvariants,
  entryId,
  income,
  isoDate,
  liquidCash,
  netWorth,
  spend,
  totalIncome,
  totalSpending,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerSnapshot,
  type SystemAccounts,
} from '../index';
import { investmentBuy, investmentDividend, investmentSell } from './trade';

/* ===========================================================================
 * A CHART WITH SOMEWHERE TO INVEST
 * ======================================================================== */

const A = {
  checking: accountId('checking'),
  brokerage: accountId('brokerage'),
  pension: accountId('pension'),
  opening: accountId('opening'),
  salary: accountId('salary'),
  dividends: accountId('inc-dividends'),
  tax: accountId('cat-tax'),
  groceries: accountId('groceries'),
  gain: accountId('eq-gain'),
  loss: accountId('eq-loss'),
  cash: accountId('budgetable-cash'),
  rta: accountId('ready-to-assign'),
  vGroceries: accountId('env-groceries'),
  vInvesting: accountId('env-investing'),
  vReimb: accountId('env-reimbursements'),
} as const;

const SYSTEM: SystemAccounts = {
  readyToAssign: A.rta,
  budgetableCash: A.cash,
  openingBalances: A.opening,
  receivables: accountId('receivables'),
  reimbursementsEnvelope: A.vReimb,
  unrealizedGain: A.gain,
  unrealizedLoss: A.loss,
  dividendIncome: A.dividends,
  taxExpense: A.tax,
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

const CHECKING = account(A.checking, 'ASSET', 'Everyday account', {
  onBudget: true,
  liquid: true,
  accountClass: 'checking',
});
const BROKERAGE = account(A.brokerage, 'ASSET', 'Degiro Portfolio', {
  accountClass: 'brokerage',
});
const PENSION = account(A.pension, 'ASSET', 'Pension', { accountClass: 'retirement' });

const CHART: LedgerAccount[] = [
  CHECKING,
  BROKERAGE,
  PENSION,
  account(A.opening, 'EQUITY', 'Starting balances'),
  account(A.gain, 'EQUITY', 'Gains on things you own'),
  account(A.loss, 'EQUITY', 'Falls in what things are worth'),
  account(A.salary, 'INCOME', 'Pay'),
  account(A.dividends, 'INCOME', 'Money your investments paid out'),
  account(A.tax, 'EXPENSE', 'Tax taken at source'),
  account(A.groceries, 'EXPENSE', 'Food shopping'),
  account(A.cash, 'BUDGETABLE_CASH', 'Money you can spend'),
  account(A.rta, 'READY_TO_ASSIGN', 'Not given a job yet'),
  account(A.vGroceries, 'ENVELOPE', 'Food shopping pot', { envelopeRole: 'category' }),
  account(A.vInvesting, 'ENVELOPE', 'Investing pot', { envelopeRole: 'goal' }),
  account(A.vReimb, 'ENVELOPE', 'Money you fronted', { envelopeRole: 'reimbursements' }),
];

const ACCOUNTS = new Map(CHART.map((a) => [a.id, a]));
const snapshot = (entries: JournalEntry[]): LedgerSnapshot => ({ accounts: ACCOUNTS, entries });

const DATE = isoDate('2026-09-04');
let seq = 0;
const base = () => ({ id: entryId(`t${++seq}`), date: DATE });

/** Wages in, so there is something to invest. */
const paid = (amount: number) =>
  income({
    ...base(),
    amount: minor(amount),
    sourceId: A.salary,
    depositAccountId: A.checking,
    countsAsBudgetableCash: true,
    payer: 'work',
    system: SYSTEM,
  });

/* ===========================================================================
 * BUYING IS NOT SPENDING
 * ---------------------------------------------------------------------------
 * The failure this prevents: somebody puts £500 into a pension and the app
 * tells them they had their worst month of the year.
 * ======================================================================== */

describe('putting money into an investment account', () => {
  it('moves it between two accounts you own and touches nothing else', () => {
    const entry = investmentBuy({
      ...base(),
      amount: minor(50_000),
      cashAccount: CHECKING,
      brokerageAccount: BROKERAGE,
      system: SYSTEM,
    });

    expect(entry.kind).toBe('INVESTMENT_BUY');
    expect(entry.description).toBe('Put money into Degiro Portfolio.');

    const financial = entry.postings.filter((p) => p.book === 'FINANCIAL');
    expect(financial.find((p) => p.accountId === A.brokerage)!.amount).toBe(50_000);
    expect(financial.find((p) => p.accountId === A.checking)!.amount).toBe(-50_000);
    expect(financial).toHaveLength(2);
  });

  it('takes the cash out of the budget, so safe-to-spend follows it', () => {
    const entry = investmentBuy({
      ...base(),
      amount: minor(50_000),
      cashAccount: CHECKING,
      brokerageAccount: BROKERAGE,
      system: SYSTEM,
    });

    const budget = entry.postings.filter((p) => p.book === 'BUDGET');
    // Money you can spend goes down; what has not been given a job goes down
    // with it, so every penny is still accounted for.
    expect(budget.find((p) => p.accountId === A.cash)!.amount).toBe(-50_000);
    expect(budget.find((p) => p.accountId === A.rta)!.amount).toBe(50_000);
  });

  it('takes it from a pot when the money was set aside in one', () => {
    const entry = investmentBuy({
      ...base(),
      amount: minor(50_000),
      cashAccount: CHECKING,
      brokerageAccount: BROKERAGE,
      fromEnvelopeId: A.vInvesting,
      system: SYSTEM,
    });

    const budget = entry.postings.filter((p) => p.book === 'BUDGET');
    expect(budget.find((p) => p.accountId === A.vInvesting)!.amount).toBe(50_000);
    expect(budget.find((p) => p.accountId === A.rta)).toBeUndefined();
  });

  it('writes no expense posting, and I6 is what enforces that', () => {
    const entries = [paid(300_000)];
    const before = totalSpending(snapshot(entries));

    entries.push(
      investmentBuy({
        ...base(),
        amount: minor(50_000),
        cashAccount: CHECKING,
        brokerageAccount: BROKERAGE,
        system: SYSTEM,
      }),
    );

    expect(totalSpending(snapshot(entries))).toBe(before);
    expect(checkInvariant('I6', snapshot(entries))).toEqual([]);
  });

  it('leaves what you are worth exactly where it was', () => {
    const entries = [paid(300_000)];
    const before = netWorth(snapshot(entries));

    entries.push(
      investmentBuy({
        ...base(),
        amount: minor(50_000),
        cashAccount: CHECKING,
        brokerageAccount: BROKERAGE,
        system: SYSTEM,
      }),
    );

    // The same money in a different shape.
    expect(netWorth(snapshot(entries))).toBe(before);
    expect(liquidCash(snapshot(entries))).toBe(before - 50_000);
  });

  it('says nothing about the budget when the cash was already off it', () => {
    // Moving from a pension into a brokerage changes nothing spendable.
    const entry = investmentBuy({
      ...base(),
      amount: minor(50_000),
      cashAccount: PENSION,
      brokerageAccount: BROKERAGE,
      system: SYSTEM,
    });
    expect(entry.postings.filter((p) => p.book === 'BUDGET')).toHaveLength(0);
  });

  it('refuses to invest into an everyday account, and says what to do instead', () => {
    expect(() =>
      investmentBuy({
        ...base(),
        amount: minor(50_000),
        cashAccount: BROKERAGE,
        brokerageAccount: CHECKING,
        system: SYSTEM,
      }),
    ).toThrow(/Record this as a transfer instead/);
  });

  it('refuses to move money to the account it came from', () => {
    expect(() =>
      investmentBuy({
        ...base(),
        amount: minor(50_000),
        cashAccount: CHECKING,
        brokerageAccount: CHECKING,
        system: SYSTEM,
      }),
    ).toThrow(LedgerError);
  });
});

describe('taking money back out', () => {
  it('brings it back as money waiting to be given a job', () => {
    const entry = investmentSell({
      ...base(),
      amount: minor(50_000),
      cashAccount: CHECKING,
      brokerageAccount: BROKERAGE,
      system: SYSTEM,
    });

    expect(entry.postings.find((p) => p.accountId === A.checking)!.amount).toBe(50_000);
    expect(entry.postings.find((p) => p.accountId === A.brokerage)!.amount).toBe(-50_000);

    const budget = entry.postings.filter((p) => p.book === 'BUDGET');
    expect(budget.find((p) => p.accountId === A.cash)!.amount).toBe(50_000);
    expect(budget.find((p) => p.accountId === A.rta)!.amount).toBe(-50_000);
  });

  it('is not income, however much the position had grown', () => {
    const entries = [
      paid(300_000),
      investmentBuy({
        ...base(),
        amount: minor(50_000),
        cashAccount: CHECKING,
        brokerageAccount: BROKERAGE,
        system: SYSTEM,
      }),
    ];
    const before = totalIncome(snapshot(entries));

    entries.push(
      investmentSell({
        ...base(),
        amount: minor(50_000),
        cashAccount: CHECKING,
        brokerageAccount: BROKERAGE,
        system: SYSTEM,
      }),
    );

    expect(totalIncome(snapshot(entries))).toBe(before);
  });
});

/* ===========================================================================
 * A DIVIDEND IS THE OTHER CASE
 * ======================================================================== */

describe('being paid out by something you hold', () => {
  it('counts the whole declared amount as income, not just what arrived', () => {
    const entry = investmentDividend({
      ...base(),
      grossAmount: minor(10_000),
      taxWithheld: minor(1_500),
      cashAccount: CHECKING,
      payer: 'VWCE',
      system: SYSTEM,
    });

    expect(entry.kind).toBe('DIVIDEND');
    expect(entry.description).toBe('VWCE paid out.');
    expect(entry.postings.find((p) => p.accountId === A.dividends)!.amount).toBe(-10_000);
    expect(entry.postings.find((p) => p.accountId === A.checking)!.amount).toBe(8_500);
    // The tax is visible rather than netted away, because it is the one
    // deduction nobody gets to choose.
    expect(entry.postings.find((p) => p.accountId === A.tax)!.amount).toBe(1_500);
  });

  it('adds only what actually arrived to what you can spend', () => {
    const entry = investmentDividend({
      ...base(),
      grossAmount: minor(10_000),
      taxWithheld: minor(1_500),
      cashAccount: CHECKING,
      system: SYSTEM,
    });

    const budget = entry.postings.filter((p) => p.book === 'BUDGET');
    expect(budget.find((p) => p.accountId === A.cash)!.amount).toBe(8_500);
    expect(budget.find((p) => p.accountId === A.rta)!.amount).toBe(-8_500);
  });

  it('handles a dividend with nothing taken off it', () => {
    const entry = investmentDividend({
      ...base(),
      grossAmount: minor(10_000),
      cashAccount: CHECKING,
      system: SYSTEM,
    });

    expect(entry.postings.find((p) => p.accountId === A.tax)).toBeUndefined();
    expect(entry.postings.find((p) => p.accountId === A.checking)!.amount).toBe(10_000);
  });

  it('refuses more tax than the dividend was worth', () => {
    expect(() =>
      investmentDividend({
        ...base(),
        grossAmount: minor(10_000),
        taxWithheld: minor(12_000),
        cashAccount: CHECKING,
        system: SYSTEM,
      }),
    ).toThrow(/More tax was taken off/);
  });
});

/* ===========================================================================
 * THE PROPERTY THAT MATTERS
 * ---------------------------------------------------------------------------
 * However much somebody invests, and however often, the figures that describe
 * how they live do not move.
 * ======================================================================== */

describe('what a year of investing does to the rest of the books', () => {
  it('never moves spending, and every rule keeps holding', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 10_000_000 }),
        fc.array(fc.integer({ min: 100, max: 200_000 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 100, max: 50_000 }), { minLength: 0, maxLength: 6 }),
        (wages, buys, groceries) => {
          const entries: JournalEntry[] = [paid(wages)];

          // Give the food shopping a job, so there is something real to spend.
          const assigned = groceries.reduce((sum, g) => sum + g, 0);
          if (assigned > 0) {
            entries.push(
              assign({
                ...base(),
                envelopeId: A.vGroceries,
                envelopeName: 'Food shopping',
                amount: minor(assigned),
                system: SYSTEM,
              }),
            );
          }

          for (const amount of groceries) {
            entries.push(
              spend({
                ...base(),
                amount: minor(amount),
                categoryId: A.groceries,
                envelopeId: A.vGroceries,
                funding: { via: 'cash', account: CHECKING },
                categoryName: 'Food shopping',
                system: SYSTEM,
              }),
            );
          }

          const spendingBefore = totalSpending(snapshot(entries));
          const incomeBefore = totalIncome(snapshot(entries));
          const worthBefore = netWorth(snapshot(entries));

          let invested = 0;
          for (const amount of buys) {
            entries.push(
              investmentBuy({
                ...base(),
                amount: minor(amount),
                cashAccount: CHECKING,
                brokerageAccount: BROKERAGE,
                system: SYSTEM,
              }),
            );
            invested += amount;
          }

          const after = snapshot(entries);

          // Not a penny of it is spending, and none of it is income.
          expect(totalSpending(after)).toBe(spendingBefore);
          expect(totalIncome(after)).toBe(incomeBefore);
          // Net worth is untouched: the money changed shape, not size.
          expect(netWorth(after)).toBe(worthBefore);
          // What is left to spend fell by exactly what went in.
          expect(liquidCash(after)).toBe(
            liquidCash({ ...after, entries: entries.slice(0, entries.length - buys.length) }) -
              invested,
          );

          // And the whole journal is still sound, including I5 — every penny
          // is either in a pot or waiting to be given a job.
          expect(checkInvariants(after)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
