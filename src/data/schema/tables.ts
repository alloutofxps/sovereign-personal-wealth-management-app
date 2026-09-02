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

/** Schema version and one-off flags, so migrations know where they are. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const TABLES = ['accounts', 'entries', 'postings', 'scheduled_items', 'meta'] as const;
export type TableName = (typeof TABLES)[number];
