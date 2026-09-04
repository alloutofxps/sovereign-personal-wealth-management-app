import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  BOOK_BY_TYPE,
  NORMAL_BY_TYPE,
  accountId,
  entryId,
  isoDate,
  presentedBalance,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type SystemAccounts,
} from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import {
  entryFromStatementLine,
  needsCardCreditChoice,
} from '@/core/ledger/entries/fromStatement';
import { detectDelimiter, findHeaderRow, guessColumns, parseDelimited } from './csv';
import { dedupeKey, detectDateFormat, parseAmount, parseDate } from './values';
import { buildCandidates, describeImport, inspectFile } from './import';

/* Shapes taken from what banks actually export. */

const UK_BANK = `Transaction Date,Transaction Description,Debit Amount,Credit Amount,Balance
03/09/2026,"TESCO STORES 3428",42.35,,1957.65
04/09/2026,SALARY ACME LTD,,2500.00,4457.65
15/09/2026,"AMAZON.CO.UK*MK1234",18.99,,4438.66`;

const EURO_BANK = `Datum;Omschrijving;Bedrag;Saldo
15-09-2026;ALBERT HEIJN 1234;-42,35;1.957,65
16-09-2026;SALARIS;2.500,00;4.457,65`;

const US_BANK = `Date,Description,Amount
09/15/2026,WHOLE FOODS,-42.35
12/25/2026,PAYROLL,2500.00`;

const WITH_PREAMBLE = `Account Statement
Account: 12345678
Period: 01/09/2026 to 30/09/2026

Date,Description,Amount
03/09/2026,COFFEE,-3.50`;

/* --- reading the grid ---------------------------------------------------- */

describe('reading a delimited file', () => {
  it('finds the separator each bank chose', () => {
    expect(detectDelimiter(UK_BANK)).toBe(',');
    expect(detectDelimiter(EURO_BANK)).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('keeps a quoted separator inside its field', () => {
    const rows = parseDelimited('a,"one, two",c', ',');
    expect(rows[0]).toEqual(['a', 'one, two', 'c']);
  });

  it('handles a doubled quote inside a quoted field', () => {
    const rows = parseDelimited('a,"say ""hi""",c', ',');
    expect(rows[0]).toEqual(['a', 'say "hi"', 'c']);
  });

  it('strips a byte-order mark, which otherwise breaks the first header', () => {
    const rows = parseDelimited('﻿Date,Amount\n01/01/2026,5', ',');
    expect(rows[0]?.[0]).toBe('Date');
  });

  it('skips the preamble banks put above the header', () => {
    const rows = parseDelimited(WITH_PREAMBLE, ',').filter((r) => r.some((c) => c !== ''));
    expect(findHeaderRow(rows)).toBe(3);
    expect(rows[findHeaderRow(rows)]).toEqual(['Date', 'Description', 'Amount']);
  });
});

describe('working out what each column is', () => {
  it('reads the headers where they are clear', () => {
    const file = inspectFile(UK_BANK);
    expect(file.headers[file.suggested.date]).toBe('Transaction Date');
    expect(file.headers[file.suggested.description]).toBe('Transaction Description');
    expect(file.suggested.debit).toBe(2);
    expect(file.suggested.credit).toBe(3);
  });

  it('reads a foreign-language header', () => {
    const file = inspectFile(EURO_BANK);
    expect(file.headers[file.suggested.date]).toBe('Datum');
    expect(file.suggested.amount).toBe(2);
  });

  it('falls back to what is in the column when the header says nothing', () => {
    const guesses = guessColumns(
      ['col1', 'col2', 'col3'],
      [
        ['01/09/2026', 'A LONG MERCHANT NAME', '-12.50'],
        ['02/09/2026', 'ANOTHER LONG NAME HERE', '-8.00'],
      ],
    );
    expect(guesses[0]?.role).toBe('date');
    expect(guesses[2]?.role).toBe('amount');
  });

  it('never gives two columns the same job', () => {
    const guesses = guessColumns(['Date', 'Booking Date', 'Amount'], []);
    expect(guesses.filter((g) => g.role === 'date')).toHaveLength(1);
  });
});

/* --- dates --------------------------------------------------------------- */

describe('dates', () => {
  it('proves day-first from a day above twelve', () => {
    const format = detectDateFormat(['03/09/2026', '15/09/2026', '28/09/2026']);
    expect(format.order).toBe('dmy');
    expect(format.proven).toBe(true);
  });

  it('proves month-first from a day above twelve in second place', () => {
    const format = detectDateFormat(['09/15/2026', '12/25/2026']);
    expect(format.order).toBe('mdy');
    expect(format.proven).toBe(true);
  });

  it('recognises a year-first column', () => {
    expect(detectDateFormat(['2026-09-15', '2026-09-16']).order).toBe('ymd');
  });

  it('admits when the order genuinely cannot be told', () => {
    // Every value works either way. Guessing here scatters a statement
    // across two months, so this must be surfaced, not assumed.
    const format = detectDateFormat(['01/02/2026', '03/04/2026']);
    expect(format.proven).toBe(false);
    expect(format.confidence).toBeLessThan(1);
  });

  it('reads a date in whichever order it is told', () => {
    expect(parseDate('03/09/2026', 'dmy')).toBe('2026-09-03');
    expect(parseDate('03/09/2026', 'mdy')).toBe('2026-03-09');
    expect(parseDate('2026-09-03', 'ymd')).toBe('2026-09-03');
    expect(parseDate('03.09.26', 'dmy')).toBe('2026-09-03');
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    expect(parseDate('31/09/2026', 'dmy')).toBeNull();
    expect(parseDate('30/02/2026', 'dmy')).toBeNull();
    expect(parseDate('not a date', 'dmy')).toBeNull();
  });
});

/* --- amounts ------------------------------------------------------------- */

describe('amounts', () => {
  it('reads both separator conventions', () => {
    expect(parseAmount('1,234.56', 2)).toBe(123_456);
    expect(parseAmount('1.234,56', 2)).toBe(123_456);
    expect(parseAmount('42.35', 2)).toBe(4235);
    expect(parseAmount('-42,35', 2)).toBe(-4235);
  });

  it('reads the ways a file writes a negative', () => {
    expect(parseAmount('(42.35)', 2)).toBe(-4235);
    expect(parseAmount('42.35-', 2)).toBe(-4235);
    expect(parseAmount('-42.35', 2)).toBe(-4235);
  });

  it('tells grouping apart from a decimal point', () => {
    // 1,234 is a thousand-odd, not one pound twenty-three.
    expect(parseAmount('1,234', 2)).toBe(123_400);
    expect(parseAmount('12,34', 2)).toBe(1234);
  });

  it('ignores a currency symbol without choking on it', () => {
    expect(parseAmount('€42.35', 2)).toBe(4235);
    expect(parseAmount('USD 42.35', 2)).toBe(4235);
  });

  it('returns nothing for a blank or unreadable cell', () => {
    expect(parseAmount('', 2)).toBeNull();
    expect(parseAmount('n/a', 2)).toBeNull();
  });

  it('always produces a whole number of minor units', () => {
    fc.assert(
      fc.property(fc.integer({ min: -99_999_999, max: 99_999_999 }), (cents) => {
        const text = (cents / 100).toFixed(2);
        expect(parseAmount(text, 2)).toBe(cents);
      }),
    );
  });
});

/* --- the whole import ---------------------------------------------------- */

describe('importing a statement', () => {
  it('reads a debit and credit pair into signed amounts', () => {
    const file = inspectFile(UK_BANK);
    const result = buildCandidates(file, file.suggested, 'acc', 2);

    expect(result.rejected).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.amount).toBe(-4235);
    expect(result.rows[1]?.amount).toBe(2500_00);
    expect(result.rows[0]?.date).toBe('2026-09-03');
    expect(result.rows[0]?.description).toBe('TESCO STORES 3428');
  });

  it('reads a single signed column without flipping its sign', () => {
    const file = inspectFile(EURO_BANK);
    const result = buildCandidates(file, { ...file.suggested, outflowIsPositive: false }, 'acc', 2);
    expect(result.rows[0]?.amount).toBe(-4235);
    expect(result.rows[1]?.amount).toBe(2500_00);
  });

  it('gets an American file right once the order is settled', () => {
    const file = inspectFile(US_BANK);
    expect(file.suggested.dateOrder).toBe('mdy');
    const result = buildCandidates(file, { ...file.suggested, outflowIsPositive: false }, 'acc', 2);
    expect(result.rows[0]?.date).toBe('2026-09-15');
    expect(result.rows[1]?.date).toBe('2026-12-25');
  });

  it('reports the lines it could not read instead of dropping them', () => {
    const broken = `Date,Description,Amount
03/09/2026,GOOD ROW,-10.00
notadate,BAD DATE,-5.00
05/09/2026,NO AMOUNT,
06/09/2026,ZERO,0.00`;
    const file = inspectFile(broken);
    const result = buildCandidates(file, { ...file.suggested, outflowIsPositive: false }, 'acc', 2);

    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toHaveLength(3);
    // Every reason is a sentence a person could act on.
    for (const row of result.rejected) {
      expect(row.reason).toMatch(/[.]$/);
      expect(row.lineNumber).toBeGreaterThan(0);
    }
  });

  it('keeps two genuine coffees on the same day as two rows', () => {
    const twice = `Date,Description,Amount
03/09/2026,COFFEE,-3.50
03/09/2026,COFFEE,-3.50`;
    const file = inspectFile(twice);
    const result = buildCandidates(file, { ...file.suggested, outflowIsPositive: false }, 'acc', 2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.dedupeKey).not.toBe(result.rows[1]?.dedupeKey);
  });
});

describe('recognising the same payment twice', () => {
  it('matches through changed reference numbers and punctuation', () => {
    const a = dedupeKey({
      accountId: 'acc',
      date: '2026-09-03',
      amount: minor(-4235),
      description: 'TESCO STORES 3428 REF 998877665544',
    });
    const b = dedupeKey({
      accountId: 'acc',
      date: '2026-09-03',
      amount: minor(-4235),
      description: 'Tesco  Stores 3428  ref  112233445566',
    });
    expect(a).toBe(b);
  });

  it('does not match a different amount or a different day', () => {
    const base = { accountId: 'acc', date: '2026-09-03', description: 'SHOP' };
    expect(dedupeKey({ ...base, amount: minor(-100) })).not.toBe(
      dedupeKey({ ...base, amount: minor(-200) }),
    );
    expect(dedupeKey({ ...base, amount: minor(-100) })).not.toBe(
      dedupeKey({ ...base, date: '2026-09-04', amount: minor(-100) }),
    );
  });
});

describe('what the person is told afterwards', () => {
  it('says what came in, what was already there, and what failed', () => {
    const result = {
      rows: [1, 2, 3].map(() => ({}) as never),
      rejected: [{ lineNumber: 4, raw: '', reason: 'x' }],
    };
    const message = describeImport(result, 1);
    expect(message).toMatch(/2 payments ready/);
    expect(message).toMatch(/already in Sovereign/);
    expect(message).toMatch(/could not be read/);
    expect(message).toMatch(/[.]$/);
  });

  it('says so plainly when there is nothing new', () => {
    expect(describeImport({ rows: [], rejected: [] }, 0)).toMatch(/Nothing new/);
  });
});

/* ===========================================================================
 * THE CARD-IMPORT REGRESSION
 * ---------------------------------------------------------------------------
 * A statement row says nothing about what kind of account it came from, and
 * for a long time the confirm step did not ask: every imported row was filed
 * as cash leaving. On a credit card that is wrong twice over — it takes money
 * out of what you can spend, when nothing left your account, and it leaves the
 * bill with nothing set aside for it.
 *
 * Both books balanced either way, so no invariant caught it and no test failed.
 * This one drives the whole path — CSV text through to postings — and asserts
 * the thing that actually matters: which pot the money lands in.
 * ======================================================================== */

const CARD_STATEMENT = `Date,Description,Amount
03/09/2026,CARD SHOP,-50.00`;

const ID = {
  card: accountId('acc-card'),
  everyday: accountId('acc-everyday'),
  cardPot: accountId('pot-card-bill'),
  groceries: accountId('cat-groceries'),
  potGroceries: accountId('pot-groceries'),
  spendable: accountId('bud-spendable'),
  rta: accountId('bud-ready-to-assign'),
  opening: accountId('acc-opening'),
  owed: accountId('acc-owed'),
  fronted: accountId('pot-fronted'),
  otherIncome: accountId('inc-other'),
};

const SYS: SystemAccounts = {
  readyToAssign: ID.rta,
  budgetableCash: ID.spendable,
  openingBalances: ID.opening,
  receivables: ID.owed,
  reimbursementsEnvelope: ID.fronted,
  unrealizedGain: accountId('eq-unrealized-gain'),
  unrealizedLoss: accountId('eq-unrealized-loss'),
  realizedGain: accountId('eq-realized-gain'),
  realizedLoss: accountId('eq-realized-loss'),
  fxRoundingVariance: accountId('eq-fx-rounding'),
  fxConversionFee: accountId('eq-fx-fee'),
  unrealizedFxGainLoss: accountId('eq-fx-unrealized'),
  interestExpense: accountId('cat-loan-interest'),
  escrowExpense: accountId('cat-escrow'),
  dividendIncome: accountId('inc-dividends'),
  investmentTaxWithheld: accountId('cat-tax'),
};

function acct(
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

const CARD_ACCOUNT = acct(ID.card, 'LIABILITY', 'Credit card', {
  paymentEnvelopeId: ID.cardPot,
});
const EVERYDAY_ACCOUNT = acct(ID.everyday, 'ASSET', 'Everyday account', {
  onBudget: true,
  liquid: true,
});

const CHART = new Map<AccountId, LedgerAccount>(
  [
    CARD_ACCOUNT,
    EVERYDAY_ACCOUNT,
    acct(ID.groceries, 'EXPENSE', 'Food shopping'),
    acct(ID.potGroceries, 'ENVELOPE', 'Food shopping', { envelopeRole: 'category' }),
    acct(ID.cardPot, 'ENVELOPE', 'Set aside for your card bill', { envelopeRole: 'card_payment' }),
    acct(ID.spendable, 'BUDGETABLE_CASH', 'Money you can spend'),
    acct(ID.rta, 'READY_TO_ASSIGN', 'Not given a job yet'),
    acct(ID.opening, 'EQUITY', 'Starting balances'),
    acct(ID.owed, 'ASSET', 'Money you are owed'),
    acct(ID.fronted, 'ENVELOPE', 'Money you fronted', { envelopeRole: 'reimbursements' }),
    acct(ID.otherIncome, 'INCOME', 'Other money in'),
  ].map((a) => [a.id, a]),
);

/** Parse the statement and file its one row against the given account. */
function fileOneRow(account: LedgerAccount): JournalEntry {
  const parsed = inspectFile(CARD_STATEMENT);
  const result = buildCandidates(
    parsed,
    { ...parsed.suggested, dateOrder: 'dmy', outflowIsPositive: false },
    account.id,
    2,
  );
  expect(result.rejected).toEqual([]);
  expect(result.rows).toHaveLength(1);

  const row = result.rows[0]!;
  return entryFromStatementLine({
    id: entryId('e-import'),
    line: { date: isoDate(row.date), amount: row.amount, description: row.description },
    account,
    category: {
      categoryId: ID.groceries,
      envelopeId: ID.potGroceries,
      categoryName: 'Food shopping',
    },
    incomeAccountId: ID.otherIncome,
    system: SYS,
  });
}

const shown = (entry: JournalEntry, id: AccountId): number =>
  presentedBalance({ accounts: CHART, entries: [entry] }, id);

describe('importing a credit card statement', () => {
  it('adds to what the card owes and sets the money aside for the bill', () => {
    const entry = fileOneRow(CARD_ACCOUNT);

    // What you owe on the card goes up by the purchase.
    expect(shown(entry, ID.card)).toBe(5000);
    // And the same amount is reserved against the bill that will arrive.
    expect(shown(entry, ID.cardPot)).toBe(5000);
    // The spending itself is counted exactly once.
    expect(shown(entry, ID.groceries)).toBe(5000);
  });

  it('does not touch the money you can spend, because no cash moved', () => {
    // This is the assertion the defect would fail: it used to take €50 out of
    // spendable cash for a purchase that removed nothing from any account.
    const entry = fileOneRow(CARD_ACCOUNT);
    expect(shown(entry, ID.spendable)).toBe(0);
  });

  it('still spends cash when the statement is from an account you hold', () => {
    // The other half of the pair: the fix must not turn every import into a
    // card purchase.
    const entry = fileOneRow(EVERYDAY_ACCOUNT);

    expect(shown(entry, ID.everyday)).toBe(-5000);
    expect(shown(entry, ID.spendable)).toBe(-5000);
    // Nothing is reserved, because there is no bill coming.
    expect(shown(entry, ID.cardPot)).toBe(0);
  });

  it('balances both books whichever account it came from', () => {
    for (const account of [CARD_ACCOUNT, EVERYDAY_ACCOUNT]) {
      const entry = fileOneRow(account);
      for (const book of ['FINANCIAL', 'BUDGET'] as const) {
        const lines = entry.postings.filter((p) => p.book === book);
        expect(lines.reduce((sum, p) => sum + p.amount, 0)).toBe(0);
      }
    }
  });
});

/* ===========================================================================
 * MONEY ARRIVING ON A CREDIT CARD
 * ---------------------------------------------------------------------------
 * A positive row on a card statement is one of two completely different
 * things: you paying the bill, or a shop giving something back. Until now both
 * were filed as income, which inflates what somebody appears to earn and — for
 * a bill payment — counts money that only moved between their own accounts.
 *
 * The file cannot tell them apart. Only the person can, so the queue asks.
 * ======================================================================== */

const CARD_CREDIT_STATEMENT = `Date,Description,Amount
03/09/2026,PAYMENT THANK YOU,150.00`;

function fileCardCredit(cardCredit?: Parameters<typeof entryFromStatementLine>[0]['cardCredit']) {
  const parsed = inspectFile(CARD_CREDIT_STATEMENT);
  const result = buildCandidates(
    parsed,
    { ...parsed.suggested, dateOrder: 'dmy', outflowIsPositive: false },
    CARD_ACCOUNT.id,
    2,
  );
  const row = result.rows[0]!;
  return entryFromStatementLine({
    id: entryId('e-card-credit'),
    line: { date: isoDate(row.date), amount: row.amount, description: row.description },
    account: CARD_ACCOUNT,
    category: {
      categoryId: ID.groceries,
      envelopeId: ID.potGroceries,
      categoryName: 'Food shopping',
    },
    incomeAccountId: ID.otherIncome,
    ...(cardCredit ? { cardCredit } : {}),
    system: SYS,
  });
}

describe('a positive row on a card statement', () => {
  it('is recognised as needing the person to say what it was', () => {
    expect(needsCardCreditChoice(CARD_ACCOUNT, minor(15000))).toBe(true);
    // Money into an ordinary account is just income, and needs no question.
    expect(needsCardCreditChoice(EVERYDAY_ACCOUNT, minor(15000))).toBe(false);
    // Money going out of a card is a purchase, and needs no question either.
    expect(needsCardCreditChoice(CARD_ACCOUNT, minor(-15000))).toBe(false);
  });

  it('refuses to guess, and says why in a sentence', () => {
    expect(() => fileCardCredit()).toThrow(/either you paying the bill or a shop/i);
  });

  it('filed as a bill payment, reduces the debt without creating income', () => {
    const entry = fileCardCredit({
      kind: 'bill_payment',
      paidFromAccountId: ID.everyday,
      paidFromName: 'your everyday account',
    });

    expect(entry.kind).toBe('CC_PAYMENT');
    // Debt down, cash down, nothing invented.
    expect(shown(entry, ID.card)).toBe(-15000);
    expect(shown(entry, ID.everyday)).toBe(-15000);
    // Not a penny of income, and no category was touched.
    expect(shown(entry, ID.otherIncome)).toBe(0);
    expect(shown(entry, ID.groceries)).toBe(0);
    // The reserve is released, because the bill it was held for is paid.
    expect(shown(entry, ID.cardPot)).toBe(-15000);
  });

  it('filed as a refund, reduces what was spent in that category', () => {
    const entry = fileCardCredit({ kind: 'refund' });

    expect(entry.kind).toBe('REFUND');
    // Spending in the category goes down rather than income going up.
    expect(shown(entry, ID.groceries)).toBe(-15000);
    expect(shown(entry, ID.otherIncome)).toBe(0);
    // What you owe on the card goes down too.
    expect(shown(entry, ID.card)).toBe(-15000);
    // And the envelope gets its money back to spend again.
    expect(shown(entry, ID.potGroceries)).toBe(15000);
  });

  it('balances both books whichever the person chooses', () => {
    const entries = [
      fileCardCredit({ kind: 'refund' }),
      fileCardCredit({
        kind: 'bill_payment',
        paidFromAccountId: ID.everyday,
        paidFromName: 'your everyday account',
      }),
    ];
    for (const entry of entries) {
      for (const book of ['FINANCIAL', 'BUDGET'] as const) {
        const lines = entry.postings.filter((p) => p.book === book);
        expect(lines.reduce((sum, p) => sum + p.amount, 0)).toBe(0);
      }
    }
  });
});
