/* ===========================================================================
 * FINDING THINGS AGAIN
 * ---------------------------------------------------------------------------
 * Until this file existed, Sovereign could record a payment and never show it
 * to you again — the dashboard's last eight entries were the entire window
 * onto your own history.
 *
 * The text search runs through FTS5 where the engine has it, and falls back to
 * LIKE where it does not. Which one is in play is decided by looking for the
 * index rather than by assuming, because the fallback exists precisely for the
 * case where our assumption about the binary turns out to be wrong.
 *
 * Every filter is a correlated EXISTS against `postings` rather than a JOIN,
 * so an entry with four lines is counted once. Getting that wrong returns the
 * same payment four times and quietly inflates every total on the screen.
 * ======================================================================== */

import { and, desc, inArray, sql, type SQL } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import type {
  AccountId,
  Book,
  Clearance,
  EntryId,
  EntryKind,
  IsoDate,
  Posting,
  PostingId,
} from '@/core/ledger';
import { db } from '../client';
import { entries, postings } from '../schema/tables';
import type { EntryWithPostings } from './ledgerRepo';

export interface EntrySearchParams {
  /** Matched against the description and any notes. */
  query?: string;
  accountIds?: string[];
  categoryIds?: string[];
  dateRange?: { start: IsoDate; end: IsoDate };
  /** Compared against what the payment was worth, in minor units. */
  amountRange?: { min?: Minor; max?: Minor };
  hasNotes?: boolean;
  limit?: number;
  offset?: number;
}

export interface PaginatedEntries {
  entries: EntryWithPostings[];
  /** How many match in total, not just on this page. */
  total: number;
  hasMore: boolean;
  /** Which path answered — useful when search feels slower than it should. */
  usedFullTextSearch: boolean;
}

/** Tables whose changes should re-run a search. */
export const SEARCH_TABLES = ['entries', 'postings', 'accounts'] as const;

const DEFAULT_LIMIT = 50;

/**
 * Is the full-text index actually there?
 *
 * Asked rather than assumed, and not cached: a reset rebuilds the schema, and
 * a stale `false` here would silently downgrade every later search to LIKE
 * with nothing to show why.
 */
async function fullTextAvailable(): Promise<boolean> {
  // `db.all` on a raw template returns positional arrays here, so this only
  // ever asks whether a row came back — never what is in it.
  const rows = await db.all(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries_fts'`,
  );
  return rows.length > 0;
}

/**
 * Turn what somebody typed into an FTS5 query.
 *
 * Every token is quoted, so an apostrophe in "Sam's" or a bare `AND` is
 * treated as text rather than as syntax and cannot throw. A trailing star
 * makes it match as you type, which is the only behaviour that feels right in
 * a search box.
 */
export function toMatchQuery(input: string): string {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // FTS5 escapes a double quote by doubling it.
    .map((token) => `"${token.replace(/"/g, '""')}"*`);
  return tokens.join(' ');
}

function conditions(params: EntrySearchParams, fts: boolean): SQL[] {
  const where: SQL[] = [];
  const text = params.query?.trim();

  if (text) {
    where.push(
      fts
        ? sql`entries.id IN (SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ${toMatchQuery(text)})`
        : sql`(entries.description LIKE ${'%' + text + '%'} OR EXISTS (
             SELECT 1 FROM postings p WHERE p.entry_id = entries.id AND p.memo LIKE ${'%' + text + '%'}
           ))`,
    );
  }

  if (params.accountIds?.length) {
    where.push(sql`EXISTS (
      SELECT 1 FROM postings p WHERE p.entry_id = entries.id AND p.book = 'FINANCIAL'
        AND p.account_id IN ${params.accountIds}
    )`);
  }

  if (params.categoryIds?.length) {
    // A category is the account that was debited — money going *into* an
    // expense account is what "spent on groceries" means here.
    where.push(sql`EXISTS (
      SELECT 1 FROM postings p WHERE p.entry_id = entries.id AND p.book = 'FINANCIAL'
        AND p.amount > 0 AND p.account_id IN ${params.categoryIds}
    )`);
  }

  if (params.dateRange) {
    where.push(sql`entries.date >= ${params.dateRange.start} AND entries.date <= ${params.dateRange.end}`);
  }

  if (params.amountRange?.min !== undefined || params.amountRange?.max !== undefined) {
    // What a payment "is worth" is the sum of its debits in the financial
    // book — the same figure the row shows.
    const size = sql`(SELECT COALESCE(SUM(p.amount), 0) FROM postings p
                       WHERE p.entry_id = entries.id AND p.book = 'FINANCIAL' AND p.amount > 0)`;
    if (params.amountRange.min !== undefined) {
      where.push(sql`${size} >= ${params.amountRange.min}`);
    }
    if (params.amountRange.max !== undefined) {
      where.push(sql`${size} <= ${params.amountRange.max}`);
    }
  }

  if (params.hasNotes) {
    where.push(sql`EXISTS (
      SELECT 1 FROM postings p
       WHERE p.entry_id = entries.id AND p.memo IS NOT NULL AND TRIM(p.memo) <> ''
    )`);
  }

  return where;
}

function whereClause(where: SQL[]): SQL {
  if (where.length === 0) return sql`1 = 1`;
  return and(...where) ?? sql`1 = 1`;
}

/**
 * Find entries, newest first, with their lines attached.
 *
 * The rows come back through the query builder rather than as raw SQL. That is
 * not a style preference: the worker returns rows as positional arrays, so a
 * hand-written `SELECT *` arrives as `[id, kind, date, ...]` and every field
 * read off it is undefined. The builder knows the order it asked for and maps
 * them; raw SQL has no way to.
 *
 * The count comes back alongside the page so the view can say "48 payments"
 * without a second round trip, and so an empty result can tell the difference
 * between "nothing matches this search" and "nothing recorded yet".
 */
export async function searchEntries(
  params: EntrySearchParams = {},
): Promise<PaginatedEntries> {
  const fts = params.query?.trim() ? await fullTextAvailable() : false;
  const clause = whereClause(conditions(params, fts));
  const limit = params.limit ?? DEFAULT_LIMIT;
  const offset = params.offset ?? 0;

  const [countRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(entries)
    .where(clause);
  const total = Number(countRow?.n ?? 0);

  const entryRows = await db
    .select()
    .from(entries)
    .where(clause)
    .orderBy(desc(entries.date), desc(entries.createdAt))
    .limit(limit)
    .offset(offset);

  if (entryRows.length === 0) {
    return { entries: [], total, hasMore: false, usedFullTextSearch: fts };
  }

  const ids = entryRows.map((row) => row.id);
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

  const results: EntryWithPostings[] = entryRows.map((row) => ({
    id: row.id as EntryId,
    kind: row.kind as EntryKind,
    date: row.date as IsoDate,
    description: row.description,
    postings: (byEntry.get(row.id) ?? []).sort((a, b) => a.sequence - b.sequence),
    sourceTransactionId: row.sourceTransactionId,
    reversesEntryId: (row.reversesEntryId as EntryId | null) ?? null,
    sealed: row.sealed === 1,
    claimId: row.claimId,
    createdAt: row.createdAt,
  }));

  return {
    entries: results,
    total,
    hasMore: offset + results.length < total,
    usedFullTextSearch: fts,
  };
}
