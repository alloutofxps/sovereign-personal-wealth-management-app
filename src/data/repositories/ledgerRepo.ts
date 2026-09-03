/* ===========================================================================
 * THE LEDGER REPOSITORY
 * ---------------------------------------------------------------------------
 * The only place in the app that writes SQL. Everything above it deals in
 * domain types; everything below it is the worker.
 *
 * Writes go through `saveEntry`, which validates the entry and then commits it
 * as one transaction. A journal entry is meaningless in pieces, so it is
 * written whole or not at all.
 * ======================================================================== */

import { desc, eq, inArray, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import {
  assertBalanced,
  type AccountId,
  type Book,
  type Clearance,
  type EntryId,
  type EntryKind,
  type IsoDate,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type Normal,
  type Posting,
  type PostingId,
} from '@/core/ledger';
import { db, runBatch } from '../client';
import { accounts, entries, postings } from '../schema/tables';

/* --- accounts ------------------------------------------------------------ */

type AccountRow = typeof accounts.$inferSelect;

function toAccount(row: AccountRow): LedgerAccount {
  return {
    id: row.id as AccountId,
    book: row.book as Book,
    type: row.type as LedgerAccountType,
    name: row.name,
    normal: row.normal as Normal,
    parentId: (row.parentId as AccountId | null) ?? null,
    status: row.status as LedgerAccount['status'],
    onBudget: row.onBudget === 1,
    liquid: row.liquid === 1,
    paymentEnvelopeId: (row.paymentEnvelopeId as AccountId | null) ?? null,
    envelopeRole: (row.envelopeRole as LedgerAccount['envelopeRole']) ?? null,
  };
}

export async function listAccounts(): Promise<LedgerAccount[]> {
  const rows = await db.select().from(accounts).orderBy(accounts.sortOrder, accounts.name);
  return rows.map(toAccount);
}

export async function accountsById(): Promise<Map<AccountId, LedgerAccount>> {
  return new Map((await listAccounts()).map((a) => [a.id, a]));
}

/**
 * Insert the chart of accounts. Existing rows are left alone.
 *
 * Accounts reference each other — a credit card points at the pot holding
 * money for its bill — and those references are foreign keys checked as each
 * row goes in. Rather than depending on the list happening to be in a workable
 * order, every account is inserted with its references empty and they are
 * filled in afterwards. The whole thing is one transaction, so the references
 * are never visibly missing.
 */
export async function saveAccounts(list: readonly LedgerAccount[]): Promise<void> {
  if (list.length === 0) return;

  const inserts = list.map((account, index) =>
    db
      .insert(accounts)
      .values({
        id: account.id,
        book: account.book,
        type: account.type,
        name: account.name,
        normal: account.normal,
        status: account.status,
        onBudget: account.onBudget ? 1 : 0,
        liquid: account.liquid ? 1 : 0,
        // Filled in by the second pass below.
        parentId: null,
        paymentEnvelopeId: null,
        envelopeRole: account.envelopeRole,
        sortOrder: index,
      })
      .onConflictDoNothing()
      .toSQL(),
  );

  const links = list
    .filter((account) => account.parentId || account.paymentEnvelopeId)
    .map((account) =>
      db
        .update(accounts)
        .set({ parentId: account.parentId, paymentEnvelopeId: account.paymentEnvelopeId })
        .where(eq(accounts.id, account.id))
        .toSQL(),
    );

  await runBatch([...inserts, ...links].map((s) => ({ sql: s.sql, params: s.params })));
}

/* --- entries ------------------------------------------------------------- */

/**
 * Commit one journal entry.
 *
 * The balance check runs again here even though the builders already enforce
 * it, because this is the last point before the data becomes permanent and an
 * entry could have been assembled by something other than a builder.
 */
export async function saveEntry(
  entry: JournalEntry,
  /**
   * Extra statements committed in the same transaction — the claim row that
   * goes with money you fronted, for instance. Either both land or neither
   * does, so a claim can never disagree with the ledger behind it.
   */
  alongside: { sql: string; params: unknown[] }[] = [],
): Promise<void> {
  assertBalanced(entry.id, entry.kind, entry.postings);

  const entryStatement = db
    .insert(entries)
    .values({
      id: entry.id,
      kind: entry.kind,
      date: entry.date,
      description: entry.description,
      sourceTransactionId: entry.sourceTransactionId,
      reversesEntryId: entry.reversesEntryId,
      sealed: entry.sealed ? 1 : 0,
      createdAt: new Date().toISOString(),
      claimId: claimIdOf(entry),
    })
    .toSQL();

  const postingStatements = entry.postings.map((posting) =>
    db
      .insert(postings)
      .values({
        id: posting.id,
        entryId: posting.entryId,
        book: posting.book,
        accountId: posting.accountId,
        amount: posting.amount,
        clearance: posting.clearance,
        memo: posting.memo,
        sequence: posting.sequence,
      })
      .toSQL(),
  );

  await runBatch([
    ...[entryStatement, ...postingStatements].map((s) => ({ sql: s.sql, params: s.params })),
    ...alongside,
  ]);
}

/** Claims are attached to an entry through an optional field on the domain
 *  object, so the ledger core stays unaware that claims exist at all. */
function claimIdOf(entry: JournalEntry & { claimId?: string | null }): string | null {
  return entry.claimId ?? null;
}

export interface EntryWithPostings extends JournalEntry {
  createdAt: string;
}

/** Most recent entries first, with their lines attached. */
export async function listRecentEntries(limit = 50): Promise<EntryWithPostings[]> {
  const entryRows = await db
    .select()
    .from(entries)
    .orderBy(desc(entries.date), desc(entries.createdAt))
    .limit(limit);

  if (entryRows.length === 0) return [];

  const ids = entryRows.map((e) => e.id);
  const postingRows = await db.select().from(postings).where(inArray(postings.entryId, ids));

  const byEntry = new Map<string, Posting[]>();
  for (const row of postingRows) {
    const list = byEntry.get(row.entryId) ?? [];
    list.push({
      id: row.id as PostingId,
      entryId: row.entryId as EntryId,
      book: row.book as Book,
      accountId: row.accountId as AccountId,
      amount: minor(row.amount),
      clearance: row.clearance as Clearance,
      memo: row.memo,
      sequence: row.sequence,
    });
    byEntry.set(row.entryId, list);
  }

  return entryRows.map((row) => ({
    id: row.id as EntryId,
    kind: row.kind as EntryKind,
    date: row.date as IsoDate,
    description: row.description,
    postings: (byEntry.get(row.id) ?? []).sort((a, b) => a.sequence - b.sequence),
    sourceTransactionId: row.sourceTransactionId,
    reversesEntryId: (row.reversesEntryId as EntryId | null) ?? null,
    sealed: row.sealed === 1,
    createdAt: row.createdAt,
  }));
}

export async function countEntries(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(entries);
  return Number(row?.n ?? 0);
}

/* --- balances ------------------------------------------------------------
 * This is where SQL earns its place. One grouped aggregate replaces a fold
 * over every posting in the journal, and it stays fast as the ledger grows.
 * ---------------------------------------------------------------------- */

export interface AccountBalance {
  accountId: AccountId;
  /** Raw signed total: debits positive, credits negative. */
  raw: Minor;
  /** As a person reads it — a card with money owed shows a positive number. */
  presented: Minor;
}

export async function accountBalances(): Promise<Map<AccountId, AccountBalance>> {
  const rows = await db
    .select({
      accountId: postings.accountId,
      total: sql<number>`sum(${postings.amount})`,
      normal: accounts.normal,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .groupBy(postings.accountId, accounts.normal);

  return new Map(
    rows.map((row) => {
      const raw = minor(Number(row.total));
      return [
        row.accountId as AccountId,
        {
          accountId: row.accountId as AccountId,
          raw,
          presented: minor(row.normal === 'CREDIT' ? -raw : raw),
        },
      ];
    }),
  );
}

/** Cash you could actually spend today, across on-budget liquid accounts. */
export async function spendableCash(): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.amount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(sql`${accounts.type} = 'ASSET' AND ${accounts.onBudget} = 1 AND ${accounts.liquid} = 1`);
  return minor(Number(row?.total ?? 0));
}

/** Total spending over a date range, net of refunds. */
export async function spendingBetween(from: IsoDate, to: IsoDate): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.amount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(sql`${accounts.type} = 'EXPENSE' AND ${entries.date} >= ${from} AND ${entries.date} <= ${to}`);
  return minor(Number(row?.total ?? 0));
}

/**
 * Spending per day across a range, net of refunds.
 *
 * One grouped aggregate rather than a fold over every posting — this is the
 * query behind the cumulative curve, and it stays fast as the ledger grows.
 */
export async function spendByDay(from: IsoDate, to: IsoDate): Promise<Map<string, Minor>> {
  const rows = await db
    .select({ date: entries.date, total: sql<number>`sum(${postings.amount})` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(sql`${accounts.type} = 'EXPENSE' AND ${entries.date} >= ${from} AND ${entries.date} <= ${to}`)
    .groupBy(entries.date);

  return new Map(rows.map((row) => [row.date, minor(Number(row.total))]));
}

/** Presented balances for every account of a given type. */
export async function balancesByType(
  type: 'LIABILITY' | 'ENVELOPE' | 'ASSET',
): Promise<{ id: AccountId; name: string; amount: Minor; role: string | null }[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      role: accounts.envelopeRole,
      normal: accounts.normal,
      total: sql<number>`coalesce(sum(${postings.amount}), 0)`,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .where(eq(accounts.type, type))
    .groupBy(accounts.id, accounts.name, accounts.envelopeRole, accounts.normal);

  return rows.map((row) => {
    const raw = Number(row.total);
    return {
      id: row.id as AccountId,
      name: row.name,
      amount: minor(row.normal === 'CREDIT' ? -raw : raw),
      role: row.role,
    };
  });
}

/**
 * What you were worth at the end of a given day.
 *
 * Used for the calm month-on-month line under net worth. Assets carry debit
 * balances and debts carry credit balances, so adding the two raw totals
 * already subtracts what is owed.
 */
export async function netWorthAsOf(date: IsoDate): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.amount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    // Opening balances count whenever they were typed in. They record what was
    // already there, so treating one as this month's growth would tell someone
    // they had gained their entire savings in a fortnight.
    .where(
      sql`${accounts.type} IN ('ASSET','LIABILITY')
          AND (${entries.date} <= ${date} OR ${entries.kind} = 'OPENING_BALANCE')`,
    );
  return minor(Number(row?.total ?? 0));
}

/** Everything you own, including money other people owe you. */
export async function totalAssets(): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.amount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(eq(accounts.type, 'ASSET'));
  return minor(Number(row?.total ?? 0));
}

/** Every table this repository reads, for `useLiveQuery` subscriptions. */
export const LEDGER_TABLES = ['accounts', 'entries', 'postings'] as const;
