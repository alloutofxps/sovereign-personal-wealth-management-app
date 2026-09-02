/* ===========================================================================
 * THE STARTER SET-UP
 * ---------------------------------------------------------------------------
 * A first run needs a chart of accounts, or there is nowhere for money to go.
 * These are ordinary accounts with ordinary names — everything a person sees
 * here is written the way they would say it, not the way a ledger would.
 *
 * The system accounts (Ready to assign, Money you can spend, and so on) are
 * real accounts too. They are what make the arithmetic work, and they are
 * named so that if one ever surfaces in the interface it still reads sensibly.
 * ======================================================================== */

import {
  BOOK_BY_TYPE,
  NORMAL_BY_TYPE,
  accountId,
  type AccountId,
  type EnvelopeRole,
  type LedgerAccount,
  type LedgerAccountType,
  type SystemAccounts,
} from '@/core/ledger';
import { listAccounts, saveAccounts } from './repositories/ledgerRepo';

export const ACCOUNT_IDS = {
  // Things you have and owe
  everyday: accountId('acc-everyday'),
  savings: accountId('acc-savings'),
  card: accountId('acc-card'),
  owed: accountId('acc-owed-to-you'),
  openingBalances: accountId('acc-opening-balances'),
  // Money coming in
  salary: accountId('inc-salary'),
  otherIncome: accountId('inc-other'),
  // What you spend on
  groceries: accountId('cat-groceries'),
  eatingOut: accountId('cat-eating-out'),
  transport: accountId('cat-transport'),
  home: accountId('cat-home'),
  shopping: accountId('cat-shopping'),
  health: accountId('cat-health'),
  fun: accountId('cat-fun'),
  billsAndSubs: accountId('cat-bills'),
  // The budget side
  spendable: accountId('bud-spendable'),
  readyToAssign: accountId('bud-ready-to-assign'),
  potGroceries: accountId('pot-groceries'),
  potEatingOut: accountId('pot-eating-out'),
  potTransport: accountId('pot-transport'),
  potHome: accountId('pot-home'),
  potShopping: accountId('pot-shopping'),
  potHealth: accountId('pot-health'),
  potFun: accountId('pot-fun'),
  potBills: accountId('pot-bills'),
  potCardBill: accountId('pot-card-bill'),
  potFronted: accountId('pot-fronted'),
} as const;

export const SYSTEM_ACCOUNTS: SystemAccounts = {
  readyToAssign: ACCOUNT_IDS.readyToAssign,
  budgetableCash: ACCOUNT_IDS.spendable,
  openingBalances: ACCOUNT_IDS.openingBalances,
  receivables: ACCOUNT_IDS.owed,
  reimbursementsEnvelope: ACCOUNT_IDS.potFronted,
};

/** A spending category and the pot that funds it, kept side by side. */
export interface CategoryPair {
  categoryId: AccountId;
  envelopeId: AccountId;
  name: string;
}

export const CATEGORIES: CategoryPair[] = [
  { categoryId: ACCOUNT_IDS.groceries, envelopeId: ACCOUNT_IDS.potGroceries, name: 'Food shopping' },
  { categoryId: ACCOUNT_IDS.eatingOut, envelopeId: ACCOUNT_IDS.potEatingOut, name: 'Eating out' },
  { categoryId: ACCOUNT_IDS.transport, envelopeId: ACCOUNT_IDS.potTransport, name: 'Getting around' },
  { categoryId: ACCOUNT_IDS.home, envelopeId: ACCOUNT_IDS.potHome, name: 'Home' },
  { categoryId: ACCOUNT_IDS.shopping, envelopeId: ACCOUNT_IDS.potShopping, name: 'Shopping' },
  { categoryId: ACCOUNT_IDS.health, envelopeId: ACCOUNT_IDS.potHealth, name: 'Health' },
  { categoryId: ACCOUNT_IDS.fun, envelopeId: ACCOUNT_IDS.potFun, name: 'Fun' },
  { categoryId: ACCOUNT_IDS.billsAndSubs, envelopeId: ACCOUNT_IDS.potBills, name: 'Bills and subscriptions' },
];

function make(
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

const pot = (id: AccountId, name: string, role: EnvelopeRole = 'category'): LedgerAccount =>
  make(id, 'ENVELOPE', name, { envelopeRole: role });

export function starterChart(): LedgerAccount[] {
  return [
    // --- what you have, and what you owe ---
    make(ACCOUNT_IDS.everyday, 'ASSET', 'Everyday account', { onBudget: true, liquid: true }),
    make(ACCOUNT_IDS.savings, 'ASSET', 'Savings', { onBudget: true, liquid: true }),
    make(ACCOUNT_IDS.card, 'LIABILITY', 'Credit card', {
      paymentEnvelopeId: ACCOUNT_IDS.potCardBill,
    }),
    make(ACCOUNT_IDS.owed, 'ASSET', 'Money you are owed'),
    make(ACCOUNT_IDS.openingBalances, 'EQUITY', 'Starting balances'),

    // --- money coming in ---
    make(ACCOUNT_IDS.salary, 'INCOME', 'Pay'),
    make(ACCOUNT_IDS.otherIncome, 'INCOME', 'Other money in'),

    // --- what you spend on ---
    ...CATEGORIES.map((c) => make(c.categoryId, 'EXPENSE', c.name)),

    // --- the budget side ---
    make(ACCOUNT_IDS.spendable, 'BUDGETABLE_CASH', 'Money you can spend'),
    make(ACCOUNT_IDS.readyToAssign, 'READY_TO_ASSIGN', 'Not given a job yet'),
    ...CATEGORIES.map((c) => pot(c.envelopeId, c.name)),
    pot(ACCOUNT_IDS.potCardBill, 'Set aside for your card bill', 'card_payment'),
    pot(ACCOUNT_IDS.potFronted, 'Money you fronted', 'reimbursements'),
  ];
}

/** Which pot funds which category. */
export function envelopeForCategory(categoryId: AccountId): AccountId {
  const pair = CATEGORIES.find((c) => c.categoryId === categoryId);
  if (!pair) throw new Error(`No pot is set up for that category.`);
  return pair.envelopeId;
}

/** Create the starter accounts if this is a first run. Safe to call again. */
export async function ensureStarterChart(): Promise<{ created: boolean }> {
  const existing = await listAccounts();
  const chart = starterChart();
  const known = new Set(existing.map((a) => a.id));
  const missing = chart.filter((a) => !known.has(a.id));

  if (missing.length === 0) return { created: false };
  await saveAccounts(chart);
  return { created: existing.length === 0 };
}
