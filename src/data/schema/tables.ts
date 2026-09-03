/* ===========================================================================
 * THE STORED SCHEMA
 * ---------------------------------------------------------------------------
 * Drizzle table definitions, used to build typed SQL on the main thread. The
 * SQL itself runs in the worker; nothing here touches the database directly.
 *
 * Amounts are INTEGER minor units, matching `Minor` exactly. SQLite's INTEGER
 * is 64-bit, so nothing is lost on the way in or out.
 * ======================================================================== */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  /** Annual rate in basis points, and the least the lender accepts. */
  aprBp: integer('apr_bp'),
  minPayment: integer('min_payment'),
  creditLimit: integer('credit_limit'),
  dueDay: integer('due_day'),
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

export const TABLES = [
  'accounts',
  'entries',
  'postings',
  'scheduled_items',
  'staged_transactions',
  'claims',
  'meta',
] as const;
export type TableName = (typeof TABLES)[number];
