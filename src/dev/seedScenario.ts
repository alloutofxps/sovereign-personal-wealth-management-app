/* ===========================================================================
 * A LIVED-IN HOUSEHOLD, JUNE TO SEPTEMBER 2026
 * ---------------------------------------------------------------------------
 * Development scaffolding. Nothing in the app imports this, so it never
 * reaches a production bundle; it is loaded by hand from the console when
 * somebody wants a database that looks like a real person has been using it
 * for four months.
 *
 * Every mutation goes through the same builders and repositories the interface
 * uses. Not one row is written straight to a table, apart from renaming the
 * three starter accounts — which the app has no way to do, and which is itself
 * worth noticing. That rule is the point of the exercise: a seeder that writes
 * its own SQL proves nothing, because the paths it skips are exactly the ones
 * that break. If this file runs clean and the invariants hold afterwards, the
 * builders genuinely compose.
 *
 * The household: two incomes, a mortgage, a car losing value, some money in
 * dollars, a brokerage account with three positions and a dividend history,
 * four months of envelope budgeting including one overspend that was covered
 * and one that was not, and two months of bank statements checked and locked.
 * ======================================================================== */

import { eq, sql } from 'drizzle-orm';
import { basisPoints, minor, type Minor } from '@/core/money';
// Deep import on purpose: see the note in the money barrel.
import { rateFromDecimal } from '@/core/money/fxReturns';
import {
  entryId as toEntryId,
  income,
  isoDate,
  type AccountId,
  type IsoDate,
} from '@/core/ledger';
import { db } from '@/data/client';
import { accounts } from '@/data/schema/tables';
import { ACCOUNT_IDS, SYSTEM_ACCOUNTS, ensureStarterChart } from '@/data/seed';
import { listAccounts, saveEntry, saveDebtTerms } from '@/data/repositories/ledgerRepo';
import { createAccount, recordValuation } from '@/data/repositories/accountsRepo';
import { createCategory } from '@/data/repositories/categoriesRepo';
import { savePot } from '@/data/repositories/potsRepo';
import { saveScheduled } from '@/data/repositories/scheduleRepo';
import { saveFxRate } from '@/data/repositories/fxRepo';
import { addHolding, executeSell, recordDividend } from '@/data/repositories/investmentsRepo';
import { saveLoanTerms, recordLoanPayment } from '@/data/repositories/loansRepo';
import {
  commitReconciliation,
  getReconciliationState,
  linesFor,
  togglePostingClearance,
} from '@/data/repositories/reconciliationRepo';
import {
  assignOnDate,
  moveBetweenEnvelopes,
  recordCardPayment,
  recordFronted,
  recordPayback,
  recordSpend,
  recordSplitSpend,
} from '@/app/ledger/actions';
import { recordCrossCurrencyTransfer } from '@/app/investments/actions';
import { listOpenClaims } from '@/data/repositories/claimsRepo';

/* --- small helpers -------------------------------------------------------- */

const eur = (major: number): Minor => minor(Math.round(major * 100));
const shares = (n: number): number => Math.round(n * 1e8);
const on = (d: string): IsoDate => isoDate(d);
/** 1.085 dollars to the euro, as the scaled integer the ledger stores. */
const rate = (decimal: number) => rateFromDecimal(decimal);

/** Rename an account. The app has no way to do this, which is a finding. */
async function rename(id: AccountId, name: string): Promise<void> {
  await db.update(accounts).set({ name }).where(eq(accounts.id, id));
}

/** Money arriving. There is no action for this either — another finding. */
async function recordIncome(input: {
  date: string;
  amount: Minor;
  payer: string;
  into: AccountId;
  sourceId?: AccountId;
  onBudget?: boolean;
}): Promise<void> {
  const entry = income({
    id: toEntryId(crypto.randomUUID()),
    date: on(input.date),
    amount: input.amount,
    sourceId: input.sourceId ?? ACCOUNT_IDS.salary,
    depositAccountId: input.into,
    countsAsBudgetableCash: input.onBudget ?? true,
    payer: input.payer,
    system: SYSTEM_ACCOUNTS,
  });
  await saveEntry(entry);
}

export interface SeedSummary {
  accounts: number;
  entries: number;
  months: string[];
  notes: string[];
}

/* ===========================================================================
 * THE SCENARIO
 * ======================================================================== */

export async function seedScenario(): Promise<SeedSummary> {
  const notes: string[] = [];

  await ensureStarterChart();

  /* --- 1. exchange rates, before anything foreign exists ------------------ */
  //
  // Deliberately first. `createAccount` converts a foreign opening balance
  // using the rate on that day, and when no rate exists it quietly books the
  // amount one-for-one instead — $4,334 recorded as €4,334. Getting the order
  // wrong here is what surfaced that, and it is written up in the audit.
  //
  // Quote-per-base: one euro buys this many dollars.
  await saveFxRate({
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    rateScaled: rate(1.085),
    date: on('2026-06-01'),
    source: 'manual',
  });
  await saveFxRate({
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    rateScaled: rate(1.072),
    date: on('2026-09-01'),
    source: 'manual',
  });

  /* --- 1. the balance sheet ---------------------------------------------- */

  // The three starter accounts become the household's real ones.
  await rename(ACCOUNT_IDS.everyday, 'Everyday Checking');
  await rename(ACCOUNT_IDS.savings, 'Emergency Cushion');
  await rename(ACCOUNT_IDS.card, 'Main Visa');
  await rename(ACCOUNT_IDS.potCardBill, 'Set aside for the Visa');

  const CHECKING = ACCOUNT_IDS.everyday;
  const CUSHION = ACCOUNT_IDS.savings;
  const VISA = ACCOUNT_IDS.card;

  // Opening positions, dated to the day before the story starts so nothing
  // reads as income earned in June.
  await recordIncome({
    date: '2026-05-31',
    amount: eur(4_280),
    payer: 'what was already in the current account',
    into: CHECKING,
    sourceId: SYSTEM_ACCOUNTS.openingBalances,
  });
  await recordIncome({
    date: '2026-05-31',
    amount: eur(10_000),
    payer: 'what was already in savings',
    into: CUSHION,
    sourceId: SYSTEM_ACCOUNTS.openingBalances,
  });

  const amex = await createAccount({
    name: 'Amex Gold',
    accountClass: 'credit_card',
    startingBalance: eur(1_240),
    institution: 'American Express',
    aprBp: 2199,
    asOf: on('2026-05-31'),
  });
  const AMEX = amex.account.id;
  const AMEX_POT = amex.paymentEnvelopeId!;

  const home = await createAccount({
    name: 'Family Home',
    accountClass: 'real_estate',
    startingBalance: eur(385_000),
    asOf: on('2026-06-01'),
  });
  void home;

  const mortgage = await createAccount({
    name: 'Primary Mortgage',
    accountClass: 'mortgage',
    startingBalance: eur(240_000),
    institution: 'Rabobank',
    aprBp: 385,
    asOf: on('2026-06-01'),
  });
  const MORTGAGE = mortgage.account.id;

  const car = await createAccount({
    name: '2023 Electric Vehicle',
    accountClass: 'vehicle',
    startingBalance: eur(32_000),
    depreciationModel: 'straight_line',
    depreciationRateBp: 1500,
    asOf: on('2026-06-01'),
  });
  const CAR = car.account.id;

  const usd = await createAccount({
    name: 'US Dollar Savings',
    accountClass: 'savings',
    currency: 'USD',
    baseCurrency: 'EUR',
    startingBalance: minor(433_400), // $4,334.00 — the transfer below tops it up.
    institution: 'Wise',
    asOf: on('2026-06-01'),
  });
  const USD_SAVINGS = usd.account.id;

  const broker = await createAccount({
    name: 'Degiro Portfolio',
    accountClass: 'brokerage',
    startingBalance: eur(1_500),
    institution: 'Degiro',
    asOf: on('2026-06-01'),
  });
  const BROKER = broker.account.id;

  notes.push('Eight accounts, opened 31 May / 1 June 2026.');

  // €2,000 out, $2,166 in — the bank's rate, not the published one.
  await recordCrossCurrencyTransfer({
    fromAccountId: CHECKING,
    toAccountId: USD_SAVINGS,
    fromAmount: eur(2_000),
    toAmount: minor(216_600),
    date: on('2026-06-05'),
  });
  notes.push('USD savings funded by a cross-currency transfer, spread booked as a cost.');

  /* --- 3. loan terms ------------------------------------------------------ */

  await saveLoanTerms({
    accountId: MORTGAGE,
    aprBp: basisPoints(385),
    monthlyPayment: eur(1_125.8),
    escrowMonthly: eur(150),
    originalPrincipal: eur(240_000),
    termMonths: 360,
    startDate: '2026-06-01',
    interestType: 'fixed',
  });

  await saveDebtTerms(AMEX, { aprBp: 2199, minPayment: eur(35), creditLimit: eur(8_000), dueDay: 18 });
  await saveDebtTerms(VISA, { aprBp: 1899, minPayment: eur(25), creditLimit: eur(5_000), dueDay: 4 });

  /* --- 4. categories and pots -------------------------------------------- */

  const homeSupplies = await createCategory({ name: 'Home supplies', groupId: null });
  const personalCare = await createCategory({ name: 'Personal care', groupId: null });

  const CAR_INSURANCE = 'pot-car-insurance' as AccountId;
  const HOLIDAY = 'pot-holiday' as AccountId;
  const EMERGENCY = 'pot-emergency' as AccountId;
  await savePot({
    id: EMERGENCY,
    name: 'Emergency Fund',
    role: 'goal',
    kind: 'open',
    targetAmount: eur(15_000),
    targetDate: null,
    recurring: false,
  });
  await savePot({
    id: CAR_INSURANCE,
    name: 'Annual Car Insurance',
    role: 'sinking_fund',
    kind: 'by_date',
    targetAmount: eur(1_020),
    targetDate: '2027-05-01',
    recurring: true,
  });
  await savePot({
    id: HOLIDAY,
    name: 'Holiday Travel',
    role: 'goal',
    kind: 'by_date',
    targetAmount: eur(1_800),
    targetDate: '2027-07-01',
    recurring: false,
  });

  /* --- 5. subscriptions and regular bills --------------------------------- */

  await saveScheduled({
    id: 'sch-mortgage',
    kind: 'bill',
    name: 'Mortgage',
    amount: eur(1_275.8),
    nextDue: '2026-10-01',
    cadence: 'monthly',
    accountId: CHECKING,
    categoryId: ACCOUNT_IDS.home,
    active: true,
    expectedAmount: eur(1_275.8),
    lastAmount: eur(1_275.8),
    lastBilledDate: '2026-09-01',
    dormantAlertDismissedAt: null,
  });

  // Price creep: the expectation says €13.99, the last bill said €16.99.
  await saveScheduled({
    id: 'sch-netflix',
    kind: 'bill',
    name: 'Netflix',
    amount: eur(16.99),
    nextDue: '2026-09-22',
    cadence: 'monthly',
    accountId: VISA,
    categoryId: ACCOUNT_IDS.fun,
    active: true,
    expectedAmount: eur(13.99),
    lastAmount: eur(16.99),
    lastBilledDate: '2026-08-22',
    dormantAlertDismissedAt: null,
  });

  await saveScheduled({
    id: 'sch-spotify',
    kind: 'bill',
    name: 'Spotify',
    amount: eur(11.99),
    nextDue: '2026-09-14',
    cadence: 'monthly',
    accountId: VISA,
    categoryId: ACCOUNT_IDS.fun,
    active: true,
    expectedAmount: eur(11.99),
    lastAmount: eur(11.99),
    lastBilledDate: '2026-08-14',
    dormantAlertDismissedAt: null,
  });

  // Billed for three months, never opened. The dormant case.
  await saveScheduled({
    id: 'sch-cloudstore',
    kind: 'bill',
    name: 'CloudStore 2TB',
    amount: eur(9.99),
    nextDue: '2026-09-28',
    cadence: 'monthly',
    accountId: VISA,
    categoryId: ACCOUNT_IDS.billsAndSubs,
    active: true,
    expectedAmount: eur(9.99),
    lastAmount: eur(9.99),
    lastBilledDate: '2026-08-28',
    dormantAlertDismissedAt: null,
  });

  await saveScheduled({
    id: 'sch-salary',
    kind: 'income',
    name: 'Salary',
    amount: eur(3_950),
    nextDue: '2026-09-25',
    cadence: 'monthly',
    accountId: CHECKING,
    categoryId: null,
    active: true,
    expectedAmount: eur(3_950),
    lastAmount: eur(3_950),
    lastBilledDate: '2026-08-25',
    dormantAlertDismissedAt: null,
  });

  /* --- 6. four months of living ------------------------------------------ */

  const MONTHS = [
    { key: '2026-06', pay: '2026-06-25', first: '2026-06-01' },
    { key: '2026-07', pay: '2026-07-25', first: '2026-07-01' },
    { key: '2026-08', pay: '2026-08-25', first: '2026-08-01' },
    { key: '2026-09', pay: '2026-09-25', first: '2026-09-01' },
  ];

  const PLAN: { id: AccountId; name: string; each: number }[] = [
    { id: ACCOUNT_IDS.potGroceries, name: 'Food shopping', each: 520 },
    { id: ACCOUNT_IDS.potEatingOut, name: 'Eating out', each: 110 },
    { id: ACCOUNT_IDS.potTransport, name: 'Getting around', each: 160 },
    { id: ACCOUNT_IDS.potHome, name: 'Home', each: 1_450 },
    { id: ACCOUNT_IDS.potHealth, name: 'Health', each: 70 },
    { id: ACCOUNT_IDS.potFun, name: 'Fun', each: 120 },
    { id: ACCOUNT_IDS.potBills, name: 'Bills and subscriptions', each: 210 },
    { id: ACCOUNT_IDS.potShopping, name: 'Shopping', each: 140 },
    { id: homeSupplies.envelopeId, name: 'Home supplies', each: 45 },
    { id: personalCare.envelopeId, name: 'Personal care', each: 40 },
    { id: CAR_INSURANCE, name: 'Annual Car Insurance', each: 85 },
    { id: HOLIDAY, name: 'Holiday Travel', each: 150 },
  ];

  await assignOnDate(EMERGENCY, 'Emergency Fund', eur(10_000), on('2026-06-01'));

  for (const month of MONTHS) {
    // Two incomes: salary on the 25th of the month before, plus a partner's.
    await recordIncome({
      date: month.first,
      amount: eur(3_950),
      payer: 'work',
      into: CHECKING,
    });
    await recordIncome({
      date: month.first,
      amount: eur(1_180),
      payer: 'freelance work',
      into: CHECKING,
      sourceId: ACCOUNT_IDS.otherIncome,
    });

    for (const pot of PLAN) {
      await assignOnDate(pot.id, pot.name, eur(pot.each), on(month.first));
    }
    // Money set aside for the card bills, so they are covered when they land.
    await assignOnDate(ACCOUNT_IDS.potCardBill, 'Set aside for the Visa', eur(240), on(month.first));
    await assignOnDate(AMEX_POT, 'Set aside for the Amex', eur(160), on(month.first));
  }
  notes.push('Four months of income and envelope assignments.');

  /* --- everyday spending --------------------------------------------------- */

  const grocery = (date: string, amount: number, payee: string) =>
    recordSpend({
      amount: eur(amount),
      categoryId: ACCOUNT_IDS.groceries,
      envelopeId: ACCOUNT_IDS.potGroceries,
      categoryName: 'Food shopping',
      paidFrom: CHECKING,
      payee,
      date: on(date),
    });

  const dining = (date: string, amount: number, payee: string, card: AccountId = VISA) =>
    recordSpend({
      amount: eur(amount),
      categoryId: ACCOUNT_IDS.eatingOut,
      envelopeId: ACCOUNT_IDS.potEatingOut,
      categoryName: 'Eating out',
      paidFrom: card,
      payee,
      date: on(date),
    });

  const simple = (
    date: string,
    amount: number,
    categoryId: AccountId,
    envelopeId: AccountId,
    categoryName: string,
    payee: string,
    from: AccountId = CHECKING,
  ) =>
    recordSpend({
      amount: eur(amount),
      categoryId,
      envelopeId,
      categoryName,
      paidFrom: from,
      payee,
      date: on(date),
    });

  for (const month of MONTHS) {
    const m = month.key;
    await grocery(`${m}-03`, 78.4, 'Albert Heijn');
    await grocery(`${m}-09`, 112.65, 'Jumbo');
    await grocery(`${m}-16`, 64.2, 'Albert Heijn');
    await grocery(`${m}-23`, 96.8, 'Lidl');

    await simple(`${m}-05`, 62.4, ACCOUNT_IDS.billsAndSubs, ACCOUNT_IDS.potBills, 'Bills and subscriptions', 'Eneco energy');
    await simple(`${m}-07`, 39.9, ACCOUNT_IDS.transport, ACCOUNT_IDS.potTransport, 'Getting around', 'NS travel');
    await simple(`${m}-12`, 24.5, ACCOUNT_IDS.health, ACCOUNT_IDS.potHealth, 'Health', 'Etos pharmacy');
    await simple(`${m}-14`, 11.99, ACCOUNT_IDS.fun, ACCOUNT_IDS.potFun, 'Fun', 'Spotify', VISA);
    await simple(`${m}-22`, m >= '2026-08' ? 16.99 : 13.99, ACCOUNT_IDS.fun, ACCOUNT_IDS.potFun, 'Fun', 'Netflix', VISA);
    await simple(`${m}-28`, 9.99, ACCOUNT_IDS.billsAndSubs, ACCOUNT_IDS.potBills, 'Bills and subscriptions', 'CloudStore 2TB', VISA);

    await dining(`${m}-06`, 42.5, 'Cafe Modern');
    await dining(`${m}-18`, 31.8, 'Thai Corner', AMEX);
  }

  // A hypermarket receipt that was three different things.
  await recordSplitSpend({
    lines: [
      {
        categoryId: ACCOUNT_IDS.groceries,
        envelopeId: ACCOUNT_IDS.potGroceries,
        amount: eur(86),
      },
      {
        categoryId: homeSupplies.categoryId,
        envelopeId: homeSupplies.envelopeId,
        amount: eur(34.5),
        memo: 'Cleaning and laundry',
      },
      {
        categoryId: personalCare.categoryId,
        envelopeId: personalCare.envelopeId,
        amount: eur(24.5),
        memo: 'Toiletries',
      },
    ],
    paidFrom: CHECKING,
    payee: 'Carrefour hypermarket',
    date: on('2026-08-08'),
    memo: 'Monthly big shop',
  });
  notes.push('One €145.00 receipt split across three categories.');

  /* --- the overspends ------------------------------------------------------ */

  // July: dining out went over, and was covered from Fun the same week.
  await dining('2026-07-21', 96.4, 'Anniversary dinner');
  await moveBetweenEnvelopes(
    { id: ACCOUNT_IDS.potFun, name: 'Fun' },
    { id: ACCOUNT_IDS.potEatingOut, name: 'Eating out' },
    eur(70),
    on('2026-07-22'),
  );
  notes.push('July: an overspend on eating out, covered from Fun.');

  // August: went over and was left over, so the carryover rule has something
  // to act on.
  await dining('2026-08-27', 188.2, 'Leaving do');
  await dining('2026-08-29', 96.9, 'Sunday lunch');
  notes.push('August: an overspend on eating out, left uncovered on purpose.');

  /* --- money fronted for work ---------------------------------------------- */

  await recordFronted({
    amount: eur(450),
    paidFrom: AMEX,
    counterparty: 'Work, client dinner',
    kind: 'work_expense',
    date: on('2026-07-09'),
    memo: 'Dinner with the Rotterdam client',
  });
  const claims = await listOpenClaims();
  const clientDinner = claims.find((c) => c.counterparty.startsWith('Work'));
  if (clientDinner) {
    await recordPayback(clientDinner, eur(450));
    notes.push('€450 fronted for work on 9 July, paid back two weeks later.');
  }

  /* --- paying the cards ---------------------------------------------------- */

  await recordCardPayment(eur(210), 'Main Visa');

  /* --- 7. the mortgage ----------------------------------------------------- */

  for (const date of ['2026-06-01', '2026-07-01', '2026-08-01']) {
    await recordLoanPayment({
      loanId: MORTGAGE,
      fundingAccountId: CHECKING,
      envelopeId: ACCOUNT_IDS.potHome,
      date,
    });
  }
  notes.push('Three mortgage payments, split into principal, interest and escrow.');

  /* --- 8. the car losing value --------------------------------------------- */

  // Straight line at 15% a year: €32,000 × 15% × 3/12 = €1,200 over the window.
  await recordValuation(CAR, {
    value: eur(30_800),
    date: on('2026-09-01'),
    notes: 'Three months of straight-line depreciation at 15% a year.',
  });

  /* --- 9. the portfolio ---------------------------------------------------- */

  // Two lots of the same fund, bought six months apart.
  await addHolding({
    accountId: BROKER,
    symbol: 'VWCE',
    name: 'Vanguard FTSE All-World',
    assetClass: 'equity',
    isin: 'IE00BK5BQT80',
    expenseRatioBp: basisPoints(22),
    quantity1e8: shares(40),
    costBasis: eur(4_320), // 40 × €108.00
    priceMinor: eur(122),
    asOf: on('2026-01-15'),
  });
  await addHolding({
    accountId: BROKER,
    symbol: 'VWCE',
    name: 'Vanguard FTSE All-World',
    assetClass: 'equity',
    isin: 'IE00BK5BQT80',
    expenseRatioBp: basisPoints(22),
    quantity1e8: shares(20),
    costBasis: eur(2_290), // 20 × €114.50
    priceMinor: eur(122),
    asOf: on('2026-06-12'),
  });

  await addHolding({
    accountId: BROKER,
    symbol: 'VUSA',
    name: 'Vanguard S&P 500',
    assetClass: 'equity',
    isin: 'IE00B3XXRP09',
    expenseRatioBp: basisPoints(7),
    quantity1e8: shares(30),
    costBasis: eur(2_460), // 30 × €82.00
    priceMinor: eur(94.5),
    asOf: on('2026-02-20'),
  });

  // Priced in dollars whatever account holds it, so the return splits into
  // what the share did and what the currency did.
  await addHolding({
    accountId: BROKER,
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'equity',
    expenseRatioBp: basisPoints(0),
    quantity1e8: shares(15),
    costBasis: minor(277_500), // 15 × $185.00
    priceMinor: minor(22_500), // $225.00
    currency: 'USD',
    asOf: on('2026-03-05'),
  });
  notes.push('Three securities, four opening lots, one of them in dollars.');

  const securityIdOf = async (symbol: string): Promise<string> => {
    const rows = (await db.all(
      sql`SELECT id FROM securities WHERE symbol = ${symbol} LIMIT 1`,
    )) as unknown as unknown[][];
    const id = rows[0]?.[0];
    if (id === undefined) throw new Error(`No security called ${symbol}.`);
    return String(id);
  };

  const VWCE = await securityIdOf('VWCE');
  const VUSA = await securityIdOf('VUSA');

  // A dividend paid in cash, with tax taken at source.
  await recordDividend({
    accountId: BROKER,
    securityId: VUSA,
    cashAccountId: CHECKING,
    grossAmount: eur(38.4),
    taxWithheld: eur(5.76),
    isReinvested: false,
    date: on('2026-06-26'),
  });

  // And one reinvested, which buys shares and therefore opens a new lot.
  await recordDividend({
    accountId: BROKER,
    securityId: VWCE,
    cashAccountId: BROKER,
    grossAmount: eur(61),
    taxWithheld: eur(9.15),
    isReinvested: true,
    quantityBought1e8: shares(0.425),
    date: on('2026-07-30'),
  });
  notes.push('One cash dividend and one reinvested, the second opening a third lot.');

  // Selling ten shares relieves the oldest lot first.
  //
  // The proceeds go to the current account rather than staying at the broker,
  // because the ledger has no way to record the second one: `investmentSell`
  // refuses two legs on the same account. That is a real gap — leaving cash at
  // the broker after a sale is the ordinary case, and rebalancing assumes it —
  // and it is written up in the audit rather than patched around here.
  await executeSell({
    accountId: BROKER,
    securityId: VWCE,
    cashAccountId: CHECKING,
    quantity1e8: shares(10),
    pricePerShare: eur(122),
    feesMinor: eur(2),
    date: on('2026-08-19'),
  });
  notes.push('Ten VWCE shares sold on 19 August, oldest lot relieved first.');

  /* --- 10. statement checks ------------------------------------------------ */

  // June and July are checked against the bank and locked. The statement
  // figure is what the ledger says had gone through by then, which is what a
  // correct set of records and a correct bank would both say.
  for (const end of ['2026-06-30', '2026-07-31']) {
    const state = await getReconciliationState(CHECKING, on(end), minor(0));
    await commitReconciliation(CHECKING, on(end), state.clearedBalance);
  }
  notes.push('June and July checked against the statement and locked.');

  // September is half-settled: the most recent few have not gone through.
  const recent = await linesFor(CHECKING, on('2026-09-30'));
  const pending = recent.filter((l) => l.date >= '2026-09-01' && l.clearance === 'cleared').slice(0, 3);
  for (const line of pending) {
    await togglePostingClearance(line.postingId, 'pending');
  }
  notes.push(`${pending.length} September lines left pending.`);

  const allAccounts = await listAccounts();
  return {
    accounts: allAccounts.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY').length,
    entries: 0,
    months: MONTHS.map((m) => m.key),
    notes,
  };
}
