/* ===========================================================================
 * THE STORED SCHEMA
 * ---------------------------------------------------------------------------
 * Drizzle table definitions, used to build typed SQL on the main thread. The
 * SQL itself runs in the worker; nothing here touches the database directly.
 *
 * Amounts are INTEGER minor units, matching `Minor` exactly. SQLite's INTEGER
 * is 64-bit, so nothing is lost on the way in or out.
 * ======================================================================== */

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  book: text('book').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  normal: text('normal').notNull(),
  parentId: text('parent_id'),
  status: text('status').notNull().default('active'),
  /** SQLite has no boolean; 0 or 1. */
  onBudget: integer('on_budget').notNull().default(0),
  liquid: integer('liquid').notNull().default(0),
  paymentEnvelopeId: text('payment_envelope_id'),
  envelopeRole: text('envelope_role'),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Pots saving up for something carry their own target and date. */
  targetAmount: integer('target_amount'),
  targetDate: text('target_date'),
  targetRecurring: integer('target_recurring').notNull().default(0),
  /** v17. 'by_date' | 'monthly' | 'open'. How the monthly share is worked out. */
  targetKind: text('target_kind').notNull().default('by_date'),
  /** Annual rate in basis points, and the least the lender accepts. */
  aprBp: integer('apr_bp'),
  minPayment: integer('min_payment'),
  creditLimit: integer('credit_limit'),
  dueDay: integer('due_day'),
  /** Set when a category is retired. Its history stays; it stops being offered. */
  archivedAt: text('archived_at'),
  colorToken: text('color_token'),
  icon: text('icon'),
  /** v10. What kind of thing this is. Null on accounts that predate v10. */
  class: text('class'),
  institution: text('institution'),
  /** How something loses value on its own, with nothing being spent. */
  depreciationModel: text('depreciation_model'),
  depreciationRateBp: integer('depreciation_rate_bp'),
  salvageValue: integer('salvage_value'),
  /** v14. Null means the household's base currency. */
  currency: text('currency'),
  /** v15. What a loan payment is split by. `aprBp` above holds the rate. */
  originalPrincipal: integer('original_principal'),
  termMonths: integer('term_months'),
  startDate: text('start_date'),
  monthlyPayment: integer('monthly_payment'),
  escrowMonthly: integer('escrow_monthly').notNull().default(0),
  interestType: text('interest_type').notNull().default('fixed'),
});

/** What each loan payment came to. An audit trail, never a source of balance. */
export const loanPayments = sqliteTable('loan_payments', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  entryId: text('entry_id').notNull(),
  paymentNumber: integer('payment_number').notNull(),
  date: text('date').notNull(),
  totalPayment: integer('total_payment').notNull(),
  principalAmount: integer('principal_amount').notNull(),
  interestAmount: integer('interest_amount').notNull(),
  escrowAmount: integer('escrow_amount').notNull().default(0),
  extraPrincipal: integer('extra_principal').notNull().default(0),
  remainingBalance: integer('remaining_balance').notNull(),
  createdAt: text('created_at').notNull(),
});

/** What somebody was worth on a day. Derived; kept so history stays cheap. */
export const netWorthSnapshots = sqliteTable('net_worth_snapshots', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  totalAssets: integer('total_assets').notNull(),
  totalLiabilities: integer('total_liabilities').notNull(),
  netWorth: integer('net_worth').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * What an illiquid thing is reckoned to be worth, and when somebody last said so.
 *
 * The journal is what every balance is computed from. This is the human record
 * around it: the estimate, the day it applies to, and why. Emptying this table
 * would not move a single figure in the app.
 */
/** What a security *is*. One row per ticker, shared by every account. */
export const securities = sqliteTable('securities', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  isin: text('isin'),
  assetClass: text('asset_class').notNull(),
  currency: text('currency').notNull().default('EUR'),
  expenseRatioBp: integer('expense_ratio_bp').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

/** How much of it you have, and what the position cost. */
export const holdings = sqliteTable('holdings', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  securityId: text('security_id').notNull(),
  /** Shares as an exact integer at 1e8. 10.5 shares is 1,050,000,000. */
  quantity1e8: integer('quantity_1e8').notNull(),
  costBasis: integer('cost_basis').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * One parcel of shares, as bought.
 *
 * A holding says how much you have; a lot says when each part of it arrived
 * and what that part cost. Selling relieves the oldest first, and the gain
 * depends on which parcels went.
 */
export const taxLots = sqliteTable('tax_lots', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  securityId: text('security_id').notNull(),
  holdingId: text('holding_id').notNull(),
  acquiredDate: text('acquired_date').notNull(),
  quantity1e8: integer('quantity_1e8').notNull(),
  remainingQuantity1e8: integer('remaining_quantity_1e8').notNull(),
  costBasisMinor: integer('cost_basis_minor').notNull(),
  isClosed: integer('is_closed').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

/** What was traded and when. History, never a source of any balance. */
export const investmentTrades = sqliteTable('investment_trades', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  securityId: text('security_id').notNull(),
  tradeType: text('trade_type').notNull(),
  date: text('date').notNull(),
  quantity1e8: integer('quantity_1e8').notNull().default(0),
  priceMinor: integer('price_minor').notNull().default(0),
  grossAmountMinor: integer('gross_amount_minor').notNull(),
  feesMinor: integer('fees_minor').notNull().default(0),
  realizedGainMinor: integer('realized_gain_minor'),
  entryId: text('entry_id'),
  createdAt: text('created_at').notNull(),
});

/** What the portfolio is meant to look like. Only meaningful as a whole set. */
export const targetAllocations = sqliteTable('target_allocations', {
  id: text('id').primaryKey(),
  assetClass: text('asset_class').notNull(),
  targetBp: integer('target_bp').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** What one whole share was worth on a day. Append-only. */
export const securityPrices = sqliteTable('security_prices', {
  id: text('id').primaryKey(),
  securityId: text('security_id').notNull(),
  date: text('date').notNull(),
  priceMinor: integer('price_minor').notNull(),
  source: text('source').notNull().default('manual'),
  createdAt: text('created_at').notNull(),
});

/** Historical exchange rates. One euro buys `rateScaled`/1e6 of the quote. */
export const fxRates = sqliteTable('fx_rates', {
  id: text('id').primaryKey(),
  baseCurrency: text('base_currency').notNull(),
  quoteCurrency: text('quote_currency').notNull(),
  rateScaled: integer('rate_scaled').notNull(),
  date: text('date').notNull(),
  source: text('source').notNull().default('manual'),
  createdAt: text('created_at').notNull(),
});

export const valuations = sqliteTable('valuations', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  date: text('date').notNull(),
  value: integer('value').notNull(),
  costBasis: integer('cost_basis'),
  notes: text('notes'),
  entryId: text('entry_id'),
  createdAt: text('created_at').notNull(),
});

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  isRegex: integer('is_regex').notNull().default(0),
  matchField: text('match_field').notNull().default('description'),
  categoryId: text('category_id').notNull(),
  envelopeId: text('envelope_id').notNull(),
  /** Lower runs first. */
  priority: integer('priority').notNull().default(0),
  active: integer('active').notNull().default(1),
  matchCount: integer('match_count').notNull().default(0),
  lastMatchedAt: text('last_matched_at'),
  createdAt: text('created_at').notNull(),
});

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    /** 'YYYY-MM-DD'. Sorts and compares correctly as text. */
    date: text('date').notNull(),
    description: text('description').notNull(),
    sourceTransactionId: text('source_transaction_id'),
    reversesEntryId: text('reverses_entry_id'),
    sealed: integer('sealed').notNull().default(0),
    createdAt: text('created_at').notNull(),
    /** Set on the entries that open and settle money you fronted. */
    claimId: text('claim_id'),
    /** v14. Which rate a cross-currency entry was struck at, in words. */
    fxNote: text('fx_note'),
  },
  (t) => [index('entries_date_idx').on(t.date)],
);

export const postings = sqliteTable(
  'postings',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull(),
    book: text('book').notNull(),
    accountId: text('account_id').notNull(),
    /** Signed minor units. Positive is a debit, negative a credit. */
    amount: integer('amount').notNull(),
    clearance: text('clearance').notNull(),
    memo: text('memo'),
    sequence: integer('sequence').notNull(),
    /** v14. What this line is worth in the currency you report in. */
    baseAmount: integer('base_amount').notNull().default(0),
    /** v14. Quote-per-base rate at 1e6. Exactly 1_000_000 when already base. */
    fxRateScaled: integer('fx_rate_scaled').notNull().default(1_000_000),
    /**
     * v16. When this line was checked against a bank statement.
     *
     * Null until somebody has checked it. This is the whole of what "locked"
     * means — see migrations/v16.ts for why there is no third clearance value.
     */
    reconciledAt: text('reconciled_at'),
  },
  (t) => [
    index('postings_account_idx').on(t.accountId),
    index('postings_entry_idx').on(t.entryId),
  ],
);

export const scheduledItems = sqliteTable(
  'scheduled_items',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    amount: integer('amount').notNull(),
    nextDue: text('next_due').notNull(),
    cadence: text('cadence').notNull(),
    accountId: text('account_id'),
    categoryId: text('category_id'),
    active: integer('active').notNull().default(1),
    /** What it is supposed to cost, which price-creep is measured against. */
    expectedAmount: integer('expected_amount').notNull().default(0),
    lastAmount: integer('last_amount'),
    lastBilledDate: text('last_billed_date'),
    dormantAlertDismissedAt: text('dormant_alert_dismissed_at'),
  },
  (t) => [index('scheduled_due_idx').on(t.nextDue)],
);

/** Statement rows waiting to be looked at. */
export const stagedTransactions = sqliteTable(
  'staged_transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    date: text('date').notNull(),
    amount: integer('amount').notNull(),
    description: text('description').notNull(),
    raw: text('raw').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull(),
    entryId: text('entry_id'),
    importedAt: text('imported_at').notNull(),
    batchId: text('batch_id').notNull(),
  },
  (t) => [index('staged_status_idx').on(t.status)],
);

/** Money you paid out that somebody else owes you back. */
export const claims = sqliteTable(
  'claims',
  {
    id: text('id').primaryKey(),
    counterparty: text('counterparty').notNull(),
    kind: text('kind').notNull(),
    expected: integer('expected').notNull(),
    settled: integer('settled').notNull().default(0),
    status: text('status').notNull(),
    openedOn: text('opened_on').notNull(),
    note: text('note'),
  },
  (t) => [index('claims_status_idx').on(t.status)],
);

/** Schema version and one-off flags, so migrations know where they are. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const reconciliations = sqliteTable('reconciliations', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  statementDate: text('statement_date').notNull(),
  /** What the bank said the account came to. */
  statementBalance: integer('statement_balance').notNull(),
  /** What we had, counting only lines that had gone through. */
  clearedBalance: integer('cleared_balance').notNull(),
  /** The bank's figure less ours. Zero on a clean check. */
  discrepancy: integer('discrepancy').notNull().default(0),
  status: text('status').notNull().default('completed'),
  createdAt: text('created_at').notNull(),
});

/** v18. A label. Joined to entries and to nothing that carries an amount. */
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  /** As typed, case and all. */
  name: text('name').notNull(),
  /** Lower-cased and stripped; what two spellings of one tag agree on. */
  slug: text('slug').notNull(),
  createdAt: text('created_at').notNull(),
});

export const entryTags = sqliteTable(
  'entry_tags',
  {
    entryId: text('entry_id').notNull(),
    tagId: text('tag_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] })],
);

export const TABLES = [
  'accounts',
  'entries',
  'postings',
  'scheduled_items',
  'staged_transactions',
  'claims',
  'meta',
  'tags',
  'entry_tags',
  'valuations',
  'securities',
  'holdings',
  'security_prices',
  'tax_lots',
  'investment_trades',
  'target_allocations',
  'fx_rates',
  'loan_payments',
  'net_worth_snapshots',
  'reconciliations',
] as const;
export type TableName = (typeof TABLES)[number];
