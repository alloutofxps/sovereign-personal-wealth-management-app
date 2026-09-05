import { describe, expect, it } from 'vitest';
import { minor } from '@/core/money';
import {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  accountId,
  entryId,
  isoDate,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerSnapshot,
  type SystemAccounts,
} from '../index';
// Deep import on purpose: see the note in the ledger barrel.
import { checkInvariants } from '../invariants';
import { loanPayment } from './loanPayment';

const A = {
  checking: accountId('acc-checking'),
  offBudget: accountId('acc-offshore-savings'),
  mortgage: accountId('acc-mortgage'),
  card: accountId('acc-card'),
  house: accountId('acc-house'),
  cash: accountId('bud-cash'),
  rta: accountId('bud-rta'),
  potHousing: accountId('pot-housing'),
  interest: accountId('cat-loan-interest'),
  escrow: accountId('cat-escrow'),
  groceries: accountId('cat-groceries'),
  opening: accountId('eq-opening'),
};

const SYSTEM: SystemAccounts = {
  readyToAssign: A.rta,
  budgetableCash: A.cash,
  openingBalances: A.opening,
  receivables: accountId('acc-owed'),
  reimbursementsEnvelope: accountId('pot-fronted'),
  unrealizedGain: accountId('eq-ug'),
  unrealizedLoss: accountId('eq-ul'),
  realizedGain: accountId('eq-rg'),
  realizedLoss: accountId('eq-rl'),
  fxRoundingVariance: accountId('eq-fx-round'),
  fxConversionFee: accountId('eq-fx-fee'),
  unrealizedFxGainLoss: accountId('eq-fx-unrealized'),
  dividendIncome: accountId('inc-dividends'),
  investmentTaxWithheld: accountId('eq-tax'),
  interestExpense: A.interest,
  escrowExpense: A.escrow,
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

const CHART: LedgerAccount[] = [
  account(A.checking, 'ASSET', 'Everyday account', { onBudget: true, liquid: true }),
  account(A.offBudget, 'ASSET', 'Savings held elsewhere'),
  account(A.house, 'ASSET', 'The house'),
  account(A.mortgage, 'LIABILITY', 'Mortgage'),
  account(A.card, 'LIABILITY', 'Credit card'),
  account(A.opening, 'EQUITY', 'Starting balances'),
  account(A.interest, 'EXPENSE', 'Interest on what you owe'),
  account(A.escrow, 'EXPENSE', 'Property tax and insurance'),
  account(A.groceries, 'EXPENSE', 'Food shopping'),
  account(A.cash, 'BUDGETABLE_CASH', 'Money you can spend'),
  account(A.rta, 'READY_TO_ASSIGN', 'Not given a job yet'),
  account(A.potHousing, 'ENVELOPE', 'Housing', { envelopeRole: 'category' }),
];

const ACCOUNTS = new Map(CHART.map((a) => [a.id, a]));
const snapshot = (entries: JournalEntry[]): LedgerSnapshot => ({ accounts: ACCOUNTS, entries });

const CHECKING = ACCOUNTS.get(A.checking)!;
const MORTGAGE = ACCOUNTS.get(A.mortgage)!;
const DATE = isoDate('2026-10-01');

let seq = 0;
const base = () => ({ id: entryId(`e-${++seq}`), date: DATE });

/** The worked example: €954.83 contractual, €250.00 escrow. */
const payment = (over: Partial<Parameters<typeof loanPayment>[0]> = {}) =>
  loanPayment({
    ...base(),
    fundingAccount: CHECKING,
    loanAccount: MORTGAGE,
    principal: minor(28_816),
    interest: minor(66_667),
    envelopeId: A.potHousing,
    system: SYSTEM,
    ...over,
  });

const linesFor = (entry: JournalEntry, id: AccountId) =>
  entry.postings.filter((p) => p.accountId === id);

const amountIn = (entry: JournalEntry, id: AccountId) =>
  linesFor(entry, id).reduce((total, p) => total + p.amount, 0);

describe('what a loan payment records', () => {
  it('takes the whole payment out of cash and only the principal off the debt', () => {
    const entry = payment();

    expect(amountIn(entry, A.checking)).toBe(-95_483);
    expect(amountIn(entry, A.mortgage)).toBe(28_816);
    expect(amountIn(entry, A.interest)).toBe(66_667);
  });

  it('leaves net worth down by the interest alone', () => {
    const entry = payment();
    // Cash out, debt down: the principal moved columns and cost nothing.
    const netWorthChange = amountIn(entry, A.checking) + amountIn(entry, A.mortgage);
    expect(netWorthChange).toBe(-66_667);
  });

  it('takes the whole payment out of the envelope, principal included', () => {
    const entry = payment();

    // Spendable money does not care that some of it bought equity.
    expect(amountIn(entry, A.potHousing)).toBe(95_483);
    expect(amountIn(entry, A.cash)).toBe(-95_483);
  });

  it('adds escrow to the cash out and to the envelope, but not to the debt', () => {
    const entry = payment({ escrow: minor(25_000) });

    expect(amountIn(entry, A.checking)).toBe(-120_483);
    expect(amountIn(entry, A.escrow)).toBe(25_000);
    expect(amountIn(entry, A.mortgage)).toBe(28_816);
    expect(amountIn(entry, A.potHousing)).toBe(120_483);
  });

  it('puts extra money entirely against the debt', () => {
    const entry = payment({ extraPrincipal: minor(50_000) });

    expect(amountIn(entry, A.mortgage)).toBe(78_816);
    expect(amountIn(entry, A.interest)).toBe(66_667);
    expect(amountIn(entry, A.checking)).toBe(-145_483);
  });

  it('writes no escrow line when there is no escrow', () => {
    expect(linesFor(payment(), A.escrow)).toHaveLength(0);
  });

  it('says what happened in a complete sentence', () => {
    expect(payment().description).toBe('Paid Mortgage, and part of it came off what you owe.');
  });

  it('names the loan on the interest line', () => {
    const line = linesFor(payment(), A.interest)[0]!;
    expect(line.memo).toBe('Interest on Mortgage');
  });
});

describe('paying from an account that is not part of the budget', () => {
  const offBudget = ACCOUNTS.get(A.offBudget)!;

  it('touches the financial book only', () => {
    const entry = loanPayment({
      ...base(),
      fundingAccount: offBudget,
      loanAccount: MORTGAGE,
      principal: minor(28_816),
      interest: minor(66_667),
      system: SYSTEM,
    });

    expect(entry.postings.every((p) => p.book === 'FINANCIAL')).toBe(true);
    expect(amountIn(entry, A.offBudget)).toBe(-95_483);
  });
});

describe('what it refuses to record', () => {
  it('will not pay a loan from budgeted money without a pot', () => {
    const withoutPot = () =>
      loanPayment({
        ...base(),
        fundingAccount: CHECKING,
        loanAccount: MORTGAGE,
        principal: minor(28_816),
        interest: minor(66_667),
        system: SYSTEM,
      });

    expect(withoutPot).toThrow(LedgerError);
    expect(withoutPot).toThrow(/has to come out of a pot/);
  });

  it('will not record a payment against something that is not a debt', () => {
    expect(() => payment({ loanAccount: ACCOUNTS.get(A.house)! })).toThrow(
      /is not something you owe/,
    );
  });

  it('will not guess a rate when the debt is in another currency', () => {
    const dollarLoan = account(A.mortgage, 'LIABILITY', 'US mortgage', { currency: 'USD' });
    expect(() => payment({ loanAccount: dollarLoan })).toThrow(/different currencies/);
  });

  it('will not take a negative amount', () => {
    expect(() => payment({ interest: minor(-1) })).toThrow(/cannot be a negative amount/);
  });

  it('will not record a payment of nothing', () => {
    expect(() => payment({ principal: minor(0), interest: minor(0) })).toThrow(
      /has to be for some amount of money/,
    );
  });
});

/* ===========================================================================
 * THE INVARIANTS
 * ---------------------------------------------------------------------------
 * A loan payment is the first entry that is partly spending and partly not, so
 * every rule about what counts has to be checked against it rather than
 * assumed.
 * ======================================================================== */

describe('the invariants', () => {
  /** A starting position with money in the account and a debt against it. */
  const opening = (): JournalEntry[] => [
    {
      id: entryId('e-open'),
      kind: 'OPENING_BALANCE',
      date: isoDate('2026-01-01'),
      description: 'Starting balances.',
      sourceTransactionId: null,
      reversesEntryId: null,
      sealed: false,
      postings: [
        posting('e-open', 0, 'FINANCIAL', A.checking, 500_000),
        posting('e-open', 1, 'FINANCIAL', A.opening, -500_000),
        posting('e-open', 2, 'BUDGET', A.cash, 500_000),
        posting('e-open', 3, 'BUDGET', A.rta, -500_000),
      ],
    },
    {
      id: entryId('e-assign'),
      kind: 'ASSIGN',
      date: isoDate('2026-01-01'),
      description: 'Set aside for housing.',
      sourceTransactionId: null,
      reversesEntryId: null,
      sealed: false,
      postings: [
        posting('e-assign', 0, 'BUDGET', A.rta, 200_000),
        posting('e-assign', 1, 'BUDGET', A.potHousing, -200_000),
      ],
    },
  ];

  it('balances both books (I1) and keeps every other rule (I4, I5)', () => {
    const violations = checkInvariants(snapshot([...opening(), payment({ escrow: minor(25_000) })]));
    expect(violations).toEqual([]);
  });

  it('counts the interest and the escrow as spending, and nothing else (I6)', () => {
    const entry = payment({ escrow: minor(25_000) });
    const spending = entry.postings
      .filter((p) => ACCOUNTS.get(p.accountId)?.type === 'EXPENSE')
      .reduce((total, p) => total + p.amount, 0);

    // €666.67 of interest and €250.00 of escrow. Not the €288.16 of principal,
    // which bought something that is still there.
    expect(spending).toBe(91_667);
  });

  it('keeps budgeted money matching real money (I4)', () => {
    const violations = checkInvariants(snapshot([...opening(), payment()]));
    expect(violations.filter((v) => v.code === 'I4')).toEqual([]);
  });

  it('stays balanced when the money came from outside the budget', () => {
    const offBudget = ACCOUNTS.get(A.offBudget)!;
    const entry = loanPayment({
      ...base(),
      fundingAccount: offBudget,
      loanAccount: MORTGAGE,
      principal: minor(28_816),
      interest: minor(66_667),
      system: SYSTEM,
    });

    // Budgetable cash did not move, so the budget book must not have either.
    const violations = checkInvariants(snapshot([...opening(), entry]));
    expect(violations).toEqual([]);
  });
});

function posting(
  entry: string,
  index: number,
  book: 'FINANCIAL' | 'BUDGET',
  accountId: AccountId,
  amount: number,
) {
  return {
    id: `${entry}:${index}` as never,
    entryId: entry as never,
    book,
    accountId,
    amount: minor(amount),
    baseAmount: minor(amount),
    fxRateScaled: 1_000_000,
    clearance: 'cleared' as const,
    reconciledAt: null,
    memo: null,
    sequence: index,
  };
}
