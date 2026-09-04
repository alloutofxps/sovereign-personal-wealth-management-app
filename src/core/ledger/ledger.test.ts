import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  accountId,
  assign,
  cardPayment,
  checkInvariant,
  checkInvariants,
  entryId,
  income,
  isoDate,
  liquidCash,
  netWorth,
  openingBalance,
  presentedBalance,
  refund,
  reimbursable,
  reimbursement,
  reverseEntry,
  spend,
  totalIncome,
  totalSpending,
  transfer,
  type AccountId,
  fundingFor,
  assertFundingMatchesAccount,
  spendSplit,
  splitTotal,
  type Funding,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerSnapshot,
  type SystemAccounts,
} from './index';

/* ===========================================================================
 * A chart of accounts to test against
 * ======================================================================== */

const A = {
  checking: accountId('checking'),
  savings: accountId('savings'),
  brokerage: accountId('brokerage'),
  card: accountId('card'),
  receivables: accountId('receivables'),
  opening: accountId('opening'),
  salary: accountId('salary'),
  groceries: accountId('groceries'),
  transport: accountId('transport'),
  // budget book
  cash: accountId('budgetable-cash'),
  rta: accountId('ready-to-assign'),
  vGroceries: accountId('env-groceries'),
  vTransport: accountId('env-transport'),
  vCardPay: accountId('env-card-payment'),
  vReimb: accountId('env-reimbursements'),
  vInvesting: accountId('env-investing'),
} as const;

const SYSTEM: SystemAccounts = {
  readyToAssign: A.rta,
  budgetableCash: A.cash,
  openingBalances: A.opening,
  receivables: A.receivables,
  reimbursementsEnvelope: A.vReimb,
  unrealizedGain: accountId('eq-unrealized-gain'),
  unrealizedLoss: accountId('eq-unrealized-loss'),
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
  account(A.savings, 'ASSET', 'Savings', { onBudget: true, liquid: true }),
  account(A.brokerage, 'ASSET', 'Investments'),
  account(A.receivables, 'ASSET', 'Money you are owed'),
  account(A.card, 'LIABILITY', 'Credit card', { paymentEnvelopeId: A.vCardPay }),
  account(A.opening, 'EQUITY', 'Starting balances'),
  account(SYSTEM.unrealizedGain, 'EQUITY', 'Gains on things you own'),
  account(SYSTEM.unrealizedLoss, 'EQUITY', 'Falls in what things are worth'),
  account(A.salary, 'INCOME', 'Salary'),
  account(A.groceries, 'EXPENSE', 'Groceries'),
  account(A.transport, 'EXPENSE', 'Transport'),
  account(A.cash, 'BUDGETABLE_CASH', 'Money you can spend'),
  account(A.rta, 'READY_TO_ASSIGN', 'Waiting to be given a job'),
  account(A.vGroceries, 'ENVELOPE', 'Groceries pot', { envelopeRole: 'category' }),
  account(A.vTransport, 'ENVELOPE', 'Transport pot', { envelopeRole: 'category' }),
  account(A.vCardPay, 'ENVELOPE', 'Card bill pot', { envelopeRole: 'card_payment' }),
  account(A.vReimb, 'ENVELOPE', 'Money you fronted', { envelopeRole: 'reimbursements' }),
  account(A.vInvesting, 'ENVELOPE', 'Investing pot', { envelopeRole: 'goal' }),
];

const ACCOUNTS = new Map(CHART.map((a) => [a.id, a]));
const snapshot = (entries: JournalEntry[]): LedgerSnapshot => ({ accounts: ACCOUNTS, entries });

const DATE = isoDate('2026-09-02');
let seq = 0;
const nextId = () => entryId(`e${(seq += 1)}`);
const base = () => ({ id: nextId(), date: DATE });

// Derived from the accounts themselves, which is the only sanctioned way to
// build funding — `fundingFor` is what makes 'via' and the account type one
// fact rather than two that can drift apart.
const CASH: Funding = fundingFor(ACCOUNTS.get(A.checking)!);
const CARD: Funding = fundingFor(ACCOUNTS.get(A.card)!);

const m = (major: number): Minor => minor(Math.round(major * 100));

/** Presented (human-readable) balance for an account. */
const bal = (entries: JournalEntry[], id: AccountId): number =>
  presentedBalance(snapshot(entries), id);

/* ===========================================================================
 * Construction refuses to produce a broken entry
 * ======================================================================== */

describe('entries cannot be built unbalanced', () => {
  it('rejects a zero or negative amount', () => {
    expect(() =>
      spend({ ...base(), amount: minor(0), categoryId: A.groceries, envelopeId: A.vGroceries, funding: CASH, payee: 'Shop', system: SYSTEM }),
    ).toThrow(LedgerError);
    expect(() =>
      spend({ ...base(), amount: minor(-500), categoryId: A.groceries, envelopeId: A.vGroceries, funding: CASH, payee: 'Shop', system: SYSTEM }),
    ).toThrow(LedgerError);
  });

  it('rejects a transfer to the same account', () => {
    expect(() =>
      transfer({
        ...base(),
        amount: m(10),
        from: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true },
        to: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true },
        system: SYSTEM,
      }),
    ).toThrow(LedgerError);
  });

  it('refuses to move money off-budget without saying which pot it comes from', () => {
    expect(() =>
      transfer({
        ...base(),
        amount: m(500),
        from: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true },
        to: { accountId: A.brokerage, name: 'Investments', countsAsBudgetableCash: false },
        system: SYSTEM,
      }),
    ).toThrow(/pot you set aside/);
  });

  it('every builder produces an entry that balances in both books', () => {
    const entries = [
      openingBalance({ ...base(), accountId: A.checking, amount: m(2000), countsAsBudgetableCash: true, accountName: 'Everyday', system: SYSTEM }),
      assign({ ...base(), envelopeId: A.vGroceries, envelopeName: 'Groceries', amount: m(500), system: SYSTEM }),
      spend({ ...base(), amount: m(120), categoryId: A.groceries, envelopeId: A.vGroceries, funding: CARD, payee: 'Albert Heijn', system: SYSTEM }),
      income({ ...base(), amount: m(3000), sourceId: A.salary, depositAccountId: A.checking, countsAsBudgetableCash: true, payer: 'work', system: SYSTEM }),
      transfer({ ...base(), amount: m(500), from: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true }, to: { accountId: A.savings, name: 'Savings', countsAsBudgetableCash: true }, system: SYSTEM }),
      cardPayment({ ...base(), amount: m(120), cardAccountId: A.card, cardName: 'credit card', paymentEnvelopeId: A.vCardPay, fromAccountId: A.checking, fromName: 'Everyday', system: SYSTEM }),
      reimbursable({ ...base(), amount: m(500), funding: CARD, counterparty: 'work', system: SYSTEM }),
      reimbursement({ ...base(), amount: m(500), depositAccountId: A.checking, counterparty: 'Work', system: SYSTEM }),
      refund({ ...base(), amount: m(40), categoryId: A.groceries, envelopeId: A.vGroceries, refundedTo: CARD, payee: 'Albert Heijn', system: SYSTEM }),
    ];

    for (const entry of entries) {
      for (const book of ['FINANCIAL', 'BUDGET'] as const) {
        const lines = entry.postings.filter((p) => p.book === book);
        if (lines.length === 0) continue;
        expect(lines.reduce((s, p) => s + p.amount, 0), `${entry.kind} in ${book}`).toBe(0);
      }
    }
    expect(checkInvariants(snapshot(entries))).toEqual([]);
  });
});

/* ===========================================================================
 * The worked example from the specification
 * ======================================================================== */

describe('120 of groceries on a credit card', () => {
  const entry = spend({
    ...base(),
    amount: m(120),
    categoryId: A.groceries,
    envelopeId: A.vGroceries,
    funding: CARD,
    payee: 'Albert Heijn',
    system: SYSTEM,
  });

  it('records the spending exactly once and raises the debt', () => {
    const fin = entry.postings.filter((p) => p.book === 'FINANCIAL');
    expect(fin).toHaveLength(2);
    expect(fin.find((p) => p.accountId === A.groceries)?.amount).toBe(12_000);
    expect(fin.find((p) => p.accountId === A.card)?.amount).toBe(-12_000);
  });

  it('takes it out of the pot and sets the cash aside for the bill', () => {
    const bud = entry.postings.filter((p) => p.book === 'BUDGET');
    expect(bud).toHaveLength(2);
    expect(bud.find((p) => p.accountId === A.vGroceries)?.amount).toBe(12_000);
    expect(bud.find((p) => p.accountId === A.vCardPay)?.amount).toBe(-12_000);
  });

  it('does not touch spendable cash, because no cash moved', () => {
    expect(entry.postings.some((p) => p.accountId === A.cash)).toBe(false);
    expect(entry.postings.some((p) => p.accountId === A.checking)).toBe(false);
  });

  it('describes itself in a sentence a person would recognise', () => {
    expect(entry.description).toBe('Paid Albert Heijn.');
  });
});

/* ===========================================================================
 * Every edge case from the research, end to end
 * ======================================================================== */

describe('the six consumer edge cases', () => {
  const entries: JournalEntry[] = [
    openingBalance({ ...base(), accountId: A.checking, amount: m(200), countsAsBudgetableCash: true, accountName: 'Everyday', system: SYSTEM }),
    income({ ...base(), amount: m(3000), sourceId: A.salary, depositAccountId: A.checking, countsAsBudgetableCash: true, payer: 'work', system: SYSTEM }),
    assign({ ...base(), envelopeId: A.vGroceries, envelopeName: 'Groceries', amount: m(500), system: SYSTEM }),
    // Groceries on the card, then groceries in cash.
    spend({ ...base(), amount: m(120), categoryId: A.groceries, envelopeId: A.vGroceries, funding: CARD, payee: 'Albert Heijn', system: SYSTEM }),
    spend({ ...base(), amount: m(80), categoryId: A.groceries, envelopeId: A.vGroceries, funding: CASH, payee: 'Albert Heijn', system: SYSTEM }),
    // Transport on the card, never budgeted — the pot goes negative.
    spend({ ...base(), amount: m(100), categoryId: A.transport, envelopeId: A.vTransport, funding: CARD, payee: 'NS', system: SYSTEM }),
    // Pay part of the card bill.
    cardPayment({ ...base(), amount: m(120), cardAccountId: A.card, cardName: 'credit card', paymentEnvelopeId: A.vCardPay, fromAccountId: A.checking, fromName: 'Everyday', system: SYSTEM }),
    // Move money to savings — both on-budget.
    transfer({ ...base(), amount: m(500), from: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true }, to: { accountId: A.savings, name: 'Savings', countsAsBudgetableCash: true }, system: SYSTEM }),
    // Front 500 for work on the card, then get paid back.
    reimbursable({ ...base(), amount: m(500), funding: CARD, counterparty: 'work', system: SYSTEM }),
    reimbursement({ ...base(), amount: m(500), depositAccountId: A.checking, counterparty: 'Work', system: SYSTEM }),
    // A refund back onto the card.
    refund({ ...base(), amount: m(40), categoryId: A.transport, envelopeId: A.vTransport, refundedTo: CARD, payee: 'NS', system: SYSTEM }),
  ];

  const snap = snapshot(entries);

  it('holds every invariant', () => {
    expect(checkInvariants(snap)).toEqual([]);
  });

  it('counts spending once, and only real spending', () => {
    // 120 + 80 groceries, 100 - 40 transport. Not the 500 fronted for work,
    // not the 500 transfer, not the 120 card payment.
    expect(totalSpending(snap)).toBe(m(260));
    expect(bal(entries, A.groceries)).toBe(m(200));
    expect(bal(entries, A.transport)).toBe(m(60));
  });

  it('counts income once, and does not count being paid back or refunded', () => {
    expect(totalIncome(snap)).toBe(m(3000));
  });

  it('sets aside exactly what the card bill will be', () => {
    // 120 + 100 + 500 fronted, less 120 paid and 40 refunded.
    expect(bal(entries, A.card)).toBe(m(560));
    expect(bal(entries, A.vCardPay)).toBe(m(560));
  });

  it('clears the money fronted for work back to nothing', () => {
    expect(bal(entries, A.receivables)).toBe(0);
    expect(bal(entries, A.vReimb)).toBe(0);
  });

  it('lets a pot go negative rather than refusing the spend', () => {
    // Transport was never funded: 100 spent, 40 refunded.
    expect(bal(entries, A.vTransport)).toBe(m(-60));
  });

  it('keeps budgeted money in step with real money', () => {
    expect(bal(entries, A.cash)).toBe(liquidCash(snap));
    expect(bal(entries, A.cash)).toBe(m(3500));
  });

  it('reports net worth as assets less debts', () => {
    expect(netWorth(snap)).toBe(m(2940));
  });
});

/* ===========================================================================
 * The invariant engine actually catches things
 * ---------------------------------------------------------------------------
 * A checker that has never been seen to fail is a checker nobody should trust,
 * so each rule is shown rejecting a hand-built broken entry.
 * ======================================================================== */

describe('each invariant rejects a violation', () => {
  const good = spend({
    ...base(),
    amount: m(120),
    categoryId: A.groceries,
    envelopeId: A.vGroceries,
    funding: CARD,
    payee: 'Albert Heijn',
    system: SYSTEM,
  });

  /** Bypass the builders to forge a broken entry. */
  const forge = (mutate: (e: JournalEntry) => JournalEntry): LedgerSnapshot =>
    snapshot([mutate(structuredClone(good))]);

  it('I1 catches an entry that does not add up', () => {
    const broken = forge((e) => {
      e.postings[0]!.amount = m(999);
      return e;
    });
    expect(checkInvariant('I1', broken)[0]?.code).toBe('I1');
    expect(checkInvariant('I1', broken)[0]?.message).toMatch(/does not add up/);
  });

  it('I2 catches a fractional amount', () => {
    const broken = forge((e) => {
      e.postings[0]!.amount = 12_000.5 as Minor;
      e.postings[1]!.amount = -12_000.5 as Minor;
      return e;
    });
    expect(checkInvariant('I2', broken).map((v) => v.code)).toContain('I2');
  });

  it('I3 catches a line pointing at an account that does not exist', () => {
    const broken = forge((e) => {
      e.postings[0]!.accountId = accountId('ghost');
      return e;
    });
    expect(checkInvariant('I3', broken)[0]?.message).toMatch(/no longer exists/);
  });

  it('I3 catches a line filed under the wrong book', () => {
    const broken = forge((e) => {
      e.postings[2]!.book = 'FINANCIAL';
      e.postings[3]!.book = 'FINANCIAL';
      return e;
    });
    expect(checkInvariant('I3', broken).some((v) => /wrong set of books/.test(v.message))).toBe(true);
  });

  it('I4 catches budgeted money drifting from real money', () => {
    const entries = [
      openingBalance({ ...base(), accountId: A.checking, amount: m(100), countsAsBudgetableCash: true, accountName: 'Everyday', system: SYSTEM }),
    ];
    // Forge extra budgetable cash that no real account backs.
    const forged = structuredClone(entries[0]!);
    forged.postings = forged.postings.map((p) =>
      p.accountId === A.cash ? { ...p, amount: m(999) } : p,
    );
    // Rebalance the budget book so only I4 fires, not I1.
    forged.postings = forged.postings.map((p) =>
      p.accountId === A.rta ? { ...p, amount: m(-999) } : p,
    );
    expect(checkInvariant('I4', snapshot([forged]))[0]?.message).toMatch(/does not match/);
  });

  it('I5 catches money that is not in a pot and not waiting either', () => {
    const entry = structuredClone(
      openingBalance({ ...base(), accountId: A.checking, amount: m(100), countsAsBudgetableCash: true, accountName: 'Everyday', system: SYSTEM }),
    );
    entry.postings = entry.postings.filter((p) => p.accountId !== A.rta);
    expect(checkInvariant('I5', snapshot([entry]))[0]?.message).toMatch(/unaccounted for/);
  });

  it('I6 catches a card payment counted as spending', () => {
    const bad = structuredClone(
      cardPayment({ ...base(), amount: m(120), cardAccountId: A.card, cardName: 'credit card', paymentEnvelopeId: A.vCardPay, fromAccountId: A.checking, fromName: 'Everyday', system: SYSTEM }),
    );
    bad.postings[0]!.accountId = A.groceries; // debit an expense instead of the card
    expect(checkInvariant('I6', snapshot([bad]))[0]?.message).toMatch(/counted as spending/);
  });

  it('I7 catches money fronted for work counted as spending', () => {
    const bad = structuredClone(
      reimbursable({ ...base(), amount: m(500), funding: CARD, counterparty: 'work', system: SYSTEM }),
    );
    bad.postings[0]!.accountId = A.groceries; // expense instead of receivable
    expect(checkInvariant('I7', snapshot([bad]))[0]?.message).toMatch(/your own spending/);
  });

  it('I8 catches a refund counted as income', () => {
    const bad = structuredClone(
      refund({ ...base(), amount: m(40), categoryId: A.groceries, envelopeId: A.vGroceries, refundedTo: CARD, payee: 'Albert Heijn', system: SYSTEM }),
    );
    bad.postings[1]!.accountId = A.salary; // credit income instead of the category
    expect(checkInvariant('I8', snapshot([bad]))[0]?.message).toMatch(/not income|money you earned/);
  });

  it('I9 catches the same record being cancelled twice', () => {
    const first = reverseEntry(good, entryId('r1'), DATE, 'Cancelled.');
    const second = reverseEntry(good, entryId('r2'), DATE, 'Cancelled again.');
    expect(checkInvariant('I9', snapshot([good, first, second]))[0]?.message).toMatch(
      /more than once/,
    );
  });

  it('I10 catches a cancellation that does not fully undo the original', () => {
    const partial = structuredClone(reverseEntry(good, entryId('r1'), DATE, 'Cancelled.'));
    partial.postings[0]!.amount = m(-100);
    partial.postings[1]!.amount = m(100);
    expect(checkInvariant('I10', snapshot([good, partial]))[0]?.message).toMatch(/left .* behind/);
  });
});

describe('reversal', () => {
  it('leaves nothing behind on any account', () => {
    const original = spend({
      ...base(),
      amount: m(120),
      categoryId: A.groceries,
      envelopeId: A.vGroceries,
      funding: CARD,
      payee: 'Albert Heijn',
      system: SYSTEM,
    });
    const undo = reverseEntry(original, nextId(), DATE, 'You said this was not yours.');
    const snap = snapshot([original, undo]);

    expect(checkInvariants(snap)).toEqual([]);
    expect(totalSpending(snap)).toBe(0);
    expect(bal([original, undo], A.card)).toBe(0);
    expect(bal([original, undo], A.vCardPay)).toBe(0);
  });
});

/* ===========================================================================
 * Property tests over random sequences
 * ======================================================================== */

type Op =
  | { t: 'assign'; amount: number; envelope: 0 | 1 }
  | { t: 'spendCash'; amount: number; envelope: 0 | 1 }
  | { t: 'spendCard'; amount: number; envelope: 0 | 1 }
  | { t: 'income'; amount: number }
  | { t: 'transferOnBudget'; amount: number }
  | { t: 'transferOffBudget'; amount: number }
  | { t: 'cardPayment'; amount: number }
  | { t: 'reimbursableCard'; amount: number }
  | { t: 'reimbursableCash'; amount: number }
  | { t: 'reimbursement'; amount: number }
  | { t: 'refundCard'; amount: number }
  | { t: 'refundCash'; amount: number };

const amount = fc.integer({ min: 1, max: 500_000 });
const envelope = fc.constantFrom(0 as const, 1 as const);

const anyOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('assign' as const), amount, envelope }),
  fc.record({ t: fc.constant('spendCash' as const), amount, envelope }),
  fc.record({ t: fc.constant('spendCard' as const), amount, envelope }),
  fc.record({ t: fc.constant('income' as const), amount }),
  fc.record({ t: fc.constant('transferOnBudget' as const), amount }),
  fc.record({ t: fc.constant('transferOffBudget' as const), amount }),
  fc.record({ t: fc.constant('cardPayment' as const), amount }),
  fc.record({ t: fc.constant('reimbursableCard' as const), amount }),
  fc.record({ t: fc.constant('reimbursableCash' as const), amount }),
  fc.record({ t: fc.constant('reimbursement' as const), amount }),
  fc.record({ t: fc.constant('refundCard' as const), amount }),
  fc.record({ t: fc.constant('refundCash' as const), amount }),
);

const CATEGORY = [A.groceries, A.transport] as const;
const ENVELOPE = [A.vGroceries, A.vTransport] as const;

function replay(ops: readonly Op[]): JournalEntry[] {
  let n = 0;
  const id = () => entryId(`p${(n += 1)}`);
  const b = () => ({ id: id(), date: DATE });

  // Seed with a real opening balance so there is money to move around.
  const entries: JournalEntry[] = [
    openingBalance({ ...b(), accountId: A.checking, amount: m(5000), countsAsBudgetableCash: true, accountName: 'Everyday', system: SYSTEM }),
  ];

  for (const op of ops) {
    const a = minor(op.amount);
    switch (op.t) {
      case 'assign':
        entries.push(assign({ ...b(), envelopeId: ENVELOPE[op.envelope], envelopeName: 'pot', amount: a, system: SYSTEM }));
        break;
      case 'spendCash':
        entries.push(spend({ ...b(), amount: a, categoryId: CATEGORY[op.envelope], envelopeId: ENVELOPE[op.envelope], funding: CASH, payee: 'a shop', system: SYSTEM }));
        break;
      case 'spendCard':
        entries.push(spend({ ...b(), amount: a, categoryId: CATEGORY[op.envelope], envelopeId: ENVELOPE[op.envelope], funding: CARD, payee: 'a shop', system: SYSTEM }));
        break;
      case 'income':
        entries.push(income({ ...b(), amount: a, sourceId: A.salary, depositAccountId: A.checking, countsAsBudgetableCash: true, payer: 'work', system: SYSTEM }));
        break;
      case 'transferOnBudget':
        entries.push(transfer({ ...b(), amount: a, from: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true }, to: { accountId: A.savings, name: 'Savings', countsAsBudgetableCash: true }, system: SYSTEM }));
        break;
      case 'transferOffBudget':
        entries.push(transfer({ ...b(), amount: a, from: { accountId: A.checking, name: 'Everyday', countsAsBudgetableCash: true }, to: { accountId: A.brokerage, name: 'Investments', countsAsBudgetableCash: false }, envelopeId: A.vInvesting, system: SYSTEM }));
        break;
      case 'cardPayment':
        entries.push(cardPayment({ ...b(), amount: a, cardAccountId: A.card, cardName: 'credit card', paymentEnvelopeId: A.vCardPay, fromAccountId: A.checking, fromName: 'Everyday', system: SYSTEM }));
        break;
      case 'reimbursableCard':
        entries.push(reimbursable({ ...b(), amount: a, funding: CARD, counterparty: 'work', system: SYSTEM }));
        break;
      case 'reimbursableCash':
        entries.push(reimbursable({ ...b(), amount: a, funding: CASH, counterparty: 'work', system: SYSTEM }));
        break;
      case 'reimbursement':
        entries.push(reimbursement({ ...b(), amount: a, depositAccountId: A.checking, counterparty: 'Work', system: SYSTEM }));
        break;
      case 'refundCard':
        entries.push(refund({ ...b(), amount: a, categoryId: A.groceries, envelopeId: A.vGroceries, refundedTo: CARD, payee: 'a shop', system: SYSTEM }));
        break;
      case 'refundCash':
        entries.push(refund({ ...b(), amount: a, categoryId: A.groceries, envelopeId: A.vGroceries, refundedTo: CASH, payee: 'a shop', system: SYSTEM }));
        break;
    }
  }
  return entries;
}

const anySequence = fc.array(anyOp, { minLength: 0, maxLength: 40 });

describe('property: any sequence of real-world events keeps the books sound', () => {
  it('holds all ten invariants', () => {
    fc.assert(
      fc.property(anySequence, (ops) => {
        const violations = checkInvariants(snapshot(replay(ops)));
        expect(violations.map((v) => `${v.code}: ${v.message}`)).toEqual([]);
      }),
      { numRuns: 600 },
    );
  });

  it('sets aside exactly the card balance, whatever happens to the card', () => {
    // Nothing computes this reserve. It is the sum of the credits, and it
    // tracks the debt for free — which is the whole point of the second book.
    fc.assert(
      fc.property(anySequence, (ops) => {
        const entries = replay(ops);
        expect(bal(entries, A.vCardPay)).toBe(bal(entries, A.card));
      }),
      { numRuns: 600 },
    );
  });

  it('never counts a transfer, card payment, repayment or refund as income', () => {
    fc.assert(
      fc.property(anySequence, (ops) => {
        const entries = replay(ops);
        const snap = snapshot(entries);
        const earned = ops
          .filter((o) => o.t === 'income')
          .reduce((s, o) => s + o.amount, 0);
        expect(totalIncome(snap)).toBe(minor(earned));
      }),
      { numRuns: 400 },
    );
  });

  it('counts spending as purchases less refunds, and nothing else', () => {
    fc.assert(
      fc.property(anySequence, (ops) => {
        const entries = replay(ops);
        const expected = ops.reduce((s, o) => {
          if (o.t === 'spendCash' || o.t === 'spendCard') return s + o.amount;
          if (o.t === 'refundCard' || o.t === 'refundCash') return s - o.amount;
          return s;
        }, 0);
        expect(totalSpending(snapshot(entries))).toBe(minor(expected));
      }),
      { numRuns: 400 },
    );
  });

  it('keeps budgeted money equal to money actually in everyday accounts', () => {
    fc.assert(
      fc.property(anySequence, (ops) => {
        const entries = replay(ops);
        const snap = snapshot(entries);
        expect(bal(entries, A.cash)).toBe(liquidCash(snap));
      }),
      { numRuns: 400 },
    );
  });

  it('leaves net worth unchanged by transfers and card payments alone', () => {
    const neutralOnly = fc.array(
      fc.oneof(
        fc.record({ t: fc.constant('transferOnBudget' as const), amount }),
        fc.record({ t: fc.constant('transferOffBudget' as const), amount }),
        fc.record({ t: fc.constant('cardPayment' as const), amount }),
      ),
      { maxLength: 25 },
    );

    fc.assert(
      fc.property(neutralOnly, (ops) => {
        const start = netWorth(snapshot(replay([])));
        expect(netWorth(snapshot(replay(ops)))).toBe(start);
      }),
      { numRuns: 300 },
    );
  });

  it('can always be undone: reversing everything returns every account to zero', () => {
    fc.assert(
      fc.property(anySequence, (ops) => {
        const entries = replay(ops);
        const undos = entries.map((e, i) =>
          reverseEntry(e, entryId(`u${i}`), DATE, 'Cancelled.'),
        );
        const snap = snapshot([...entries, ...undos]);
        expect(totalSpending(snap)).toBe(0);
        expect(totalIncome(snap)).toBe(0);
        expect(netWorth(snap)).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});

/* ===========================================================================
 * FUNDING MUST MATCH THE ACCOUNT IT CAME FROM
 * ---------------------------------------------------------------------------
 * Spending on a card and spending cash produce identical FINANCIAL postings
 * and completely different BUDGET ones. Both balance, so no invariant can tell
 * them apart — which is how statement import spent cash that never moved for
 * a year's worth of card purchases. These are the checks that make the mistake
 * throw instead of post.
 * ======================================================================== */

describe('funding has to agree with the account', () => {
  const checking = ACCOUNTS.get(A.checking)!;
  const card = ACCOUNTS.get(A.card)!;

  it('derives cash funding from an account you hold', () => {
    const funding = fundingFor(checking);
    expect(funding.via).toBe('cash');
    expect(funding.account.id).toBe(A.checking);
  });

  it('derives card funding, and the pot to reserve into, from a card', () => {
    const funding = fundingFor(card);
    expect(funding.via).toBe('card');
    expect(funding.via === 'card' && funding.paymentEnvelopeId).toBe(A.vCardPay);
  });

  it('refuses to treat spending on a card as cash leaving', () => {
    // The defect, stated as a test: this is what import used to build.
    expect(() =>
      assertFundingMatchesAccount(card, { via: 'cash', account: card }),
    ).toThrow(/card or loan/i);
  });

  it('refuses to reserve against an account that is not a card', () => {
    expect(() =>
      assertFundingMatchesAccount(checking, {
        via: 'card',
        account: checking,
        paymentEnvelopeId: A.vCardPay,
      }),
    ).toThrow(/money you have, not money you owe/i);
  });

  it('refuses a card whose reserve would go into the wrong pot', () => {
    expect(() =>
      assertFundingMatchesAccount(card, {
        via: 'card',
        account: card,
        paymentEnvelopeId: A.vGroceries,
      }),
    ).toThrow(/wrong pot/i);
  });

  it('refuses funding that names a different account than it is recorded against', () => {
    expect(() => assertFundingMatchesAccount(card, fundingFor(checking))).toThrow(
      /need to be the same account/i,
    );
  });

  it('refuses to pay out of somewhere money cannot come from', () => {
    expect(() => fundingFor(ACCOUNTS.get(A.salary)!)).toThrow(/not somewhere money can be paid/i);
  });

  it('stops a mismatched payment at the builder, not just at the helper', () => {
    // The guard runs inside spend(), so nothing hand-assembled can slip past.
    expect(() =>
      spend({
        ...base(),
        amount: m(50),
        categoryId: A.groceries,
        envelopeId: A.vGroceries,
        funding: { via: 'cash', account: card },
        payee: 'a shop',
        system: SYSTEM,
      }),
    ).toThrow(/card or loan/i);
  });

  it('carries a note onto the entry it belongs to', () => {
    const entry = spend({
      ...base(),
      amount: m(50),
      categoryId: A.groceries,
      envelopeId: A.vGroceries,
      funding: CASH,
      payee: 'a shop',
      memo: "Sam's half",
      system: SYSTEM,
    });
    expect(entry.postings[0]?.memo).toBe("Sam's half");
  });
});

/* ===========================================================================
 * SPLITTING ONE PAYMENT ACROSS SEVERAL CATEGORIES
 * ---------------------------------------------------------------------------
 * The storage could always hold this; there was simply no builder that laid
 * the lines down in both books at once. The interesting property is not that
 * a split balances — I1 would catch that — but that the two books carry the
 * *same* allocation. A split of 80/40 financially and 60/60 in the budget
 * balances perfectly and means nothing.
 * ======================================================================== */

describe('splitting a payment', () => {
  const twoWays = [
    { categoryId: A.groceries, envelopeId: A.vGroceries, amount: m(100) },
    { categoryId: A.transport, envelopeId: A.vTransport, amount: m(50) },
  ];

  it('adds up to the whole payment', () => {
    expect(splitTotal(twoWays)).toBe(m(150));
  });

  it('debits each category and credits the card once, for the total', () => {
    const entry = spendSplit({ ...base(), funding: CARD, lines: twoWays, payee: 'Costco', system: SYSTEM });

    expect(bal([entry], A.groceries)).toBe(m(100));
    expect(bal([entry], A.transport)).toBe(m(50));
    // What you owe on the card goes up once, by the whole amount.
    expect(bal([entry], A.card)).toBe(m(150));
    // And the reserve for the bill matches it exactly.
    expect(bal([entry], A.vCardPay)).toBe(m(150));
  });

  it('takes cash out once when it was not a card', () => {
    const entry = spendSplit({ ...base(), funding: CASH, lines: twoWays, payee: 'Costco', system: SYSTEM });
    expect(bal([entry], A.checking)).toBe(-m(150));
    expect(bal([entry], A.cash)).toBe(-m(150));
    expect(bal([entry], A.vCardPay)).toBe(0);
  });

  it('moves each envelope down by its own share', () => {
    const entry = spendSplit({ ...base(), funding: CASH, lines: twoWays, payee: 'Costco', system: SYSTEM });
    expect(bal([entry], A.vGroceries)).toBe(-m(100));
    expect(bal([entry], A.vTransport)).toBe(-m(50));
  });

  it('keeps a note against the line it belongs to', () => {
    const entry = spendSplit({
      ...base(),
      funding: CASH,
      payee: 'Costco',
      lines: [
        { ...twoWays[0]!, memo: 'the weekly shop' },
        { ...twoWays[1]!, memo: 'petrol' },
      ],
      system: SYSTEM,
    });
    const memos = entry.postings.filter((p) => p.memo).map((p) => p.memo);
    expect(memos).toContain('the weekly shop');
    expect(memos).toContain('petrol');
  });

  it('refuses a split of one, which is just a payment', () => {
    expect(() =>
      spendSplit({ ...base(), funding: CASH, lines: [twoWays[0]!], system: SYSTEM }),
    ).toThrow(/at least two categories/i);
  });

  it('refuses a line worth nothing', () => {
    expect(() =>
      spendSplit({
        ...base(),
        funding: CASH,
        lines: [twoWays[0]!, { ...twoWays[1]!, amount: minor(0) }],
        system: SYSTEM,
      }),
    ).toThrow(/more than zero/i);
  });

  it('refuses a card split funded as cash, like every other builder', () => {
    expect(() =>
      spendSplit({ ...base(), funding: { via: 'cash', account: ACCOUNTS.get(A.card)! }, lines: twoWays, system: SYSTEM }),
    ).toThrow(/card or loan/i);
  });

  it('balances both books for any split at all', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 500_000 }), { minLength: 2, maxLength: 8 }),
        fc.boolean(),
        (amounts, byCard) => {
          const pots = [
            { categoryId: A.groceries, envelopeId: A.vGroceries },
            { categoryId: A.transport, envelopeId: A.vTransport },
          ];
          const lines = amounts.map((amount, index) => ({
            ...pots[index % pots.length]!,
            amount: minor(amount),
          }));

          const entry = spendSplit({
            ...base(),
            funding: byCard ? CARD : CASH,
            lines,
            system: SYSTEM,
          });

          for (const book of ['FINANCIAL', 'BUDGET'] as const) {
            const total = entry.postings
              .filter((p) => p.book === book)
              .reduce((sum, p) => sum + p.amount, 0);
            expect(total).toBe(0);
          }

          // I3 restored: the same allocation, whichever book you read it in.
          const debitedFin = entry.postings
            .filter((p) => p.book === 'FINANCIAL' && p.amount > 0)
            .reduce((sum, p) => sum + p.amount, 0);
          const debitedBud = entry.postings
            .filter((p) => p.book === 'BUDGET' && p.amount > 0)
            .reduce((sum, p) => sum + p.amount, 0);
          expect(debitedFin).toBe(debitedBud);
          expect(debitedFin).toBe(splitTotal(lines));
        },
      ),
      { numRuns: 500 },
    );
  });

  it('I3 catches a split whose two books disagree', () => {
    // Hand-built damage of exactly the kind the builder prevents.
    const good = spendSplit({ ...base(), funding: CASH, lines: twoWays, payee: 'Costco', system: SYSTEM });
    const tampered: JournalEntry = {
      ...good,
      postings: good.postings.map((p) =>
        p.book === 'BUDGET' && p.accountId === A.vGroceries
          ? { ...p, amount: m(90) }
          : p.book === 'BUDGET' && p.accountId === A.vTransport
            ? { ...p, amount: m(60) }
            : p,
      ),
    };

    const violations = checkInvariant('I3', snapshot([tampered]));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.message).toMatch(/shares have to match|add up to the same total/i);
  });
});
