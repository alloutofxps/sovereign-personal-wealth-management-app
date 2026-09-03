/* ===========================================================================
 * THE REVIEW QUEUE
 * ---------------------------------------------------------------------------
 * Imported statement rows wait here until somebody has looked at them. The
 * queue is meant to empty: confirming a row turns it into a journal entry and
 * takes it out, which is the whole psychological point — a finite job with an
 * end, rather than a ledger that always needs tending.
 * ======================================================================== */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import type { CandidateRow } from '@/ingest';
import { db, runBatch } from '../client';
import { stagedTransactions } from '../schema/tables';

export interface StagedRow {
  id: string;
  accountId: AccountId;
  date: string;
  amount: Minor;
  description: string;
  raw: string;
  status: 'unreviewed' | 'reviewed' | 'ignored';
  batchId: string;
}

type Row = typeof stagedTransactions.$inferSelect;

const toStaged = (row: Row): StagedRow => ({
  id: row.id,
  accountId: row.accountId as AccountId,
  date: row.date,
  amount: minor(row.amount),
  description: row.description,
  raw: row.raw,
  status: row.status as StagedRow['status'],
  batchId: row.batchId,
});

export async function listUnreviewed(limit = 200): Promise<StagedRow[]> {
  const rows = await db
    .select()
    .from(stagedTransactions)
    .where(eq(stagedTransactions.status, 'unreviewed'))
    .orderBy(asc(stagedTransactions.date))
    .limit(limit);
  return rows.map(toStaged);
}

export async function countUnreviewed(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(stagedTransactions)
    .where(eq(stagedTransactions.status, 'unreviewed'));
  return Number(row?.n ?? 0);
}

/** Which of these have we already seen? Checked before anything is written. */
export async function findExistingKeys(keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();

  // SQLite has a parameter ceiling; ask in batches rather than one huge IN.
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 400) {
    const slice = keys.slice(i, i + 400);
    const rows = await db
      .select({ key: stagedTransactions.dedupeKey })
      .from(stagedTransactions)
      .where(inArray(stagedTransactions.dedupeKey, [...slice]));
    for (const row of rows) found.add(row.key);
  }
  return found;
}

export interface StageResult {
  added: number;
  duplicates: number;
  batchId: string;
}

/**
 * Put a batch of candidate rows into the queue.
 *
 * Anything already seen is skipped rather than added again, and the whole
 * batch lands in one transaction so a half-imported statement is impossible.
 */
export async function stageRows(
  rows: readonly CandidateRow[],
  accountId: AccountId,
): Promise<StageResult> {
  const batchId = crypto.randomUUID();
  const importedAt = new Date().toISOString();

  const existing = await findExistingKeys(rows.map((row) => row.dedupeKey));
  const fresh = rows.filter((row) => !existing.has(row.dedupeKey));

  if (fresh.length > 0) {
    const statements = fresh.map((row) =>
      db
        .insert(stagedTransactions)
        .values({
          id: crypto.randomUUID(),
          accountId,
          date: row.date,
          amount: row.amount,
          description: row.description,
          raw: row.raw,
          dedupeKey: row.dedupeKey,
          status: 'unreviewed',
          entryId: null,
          importedAt,
          batchId,
        })
        .onConflictDoNothing()
        .toSQL(),
    );
    await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
  }

  return { added: fresh.length, duplicates: rows.length - fresh.length, batchId };
}

/** Mark a row reviewed and point it at the entry it became. */
export function markReviewedStatement(id: string, entryId: string) {
  return db
    .update(stagedTransactions)
    .set({ status: 'reviewed', entryId })
    .where(eq(stagedTransactions.id, id))
    .toSQL();
}

/** Set aside a row without recording it — a duplicate, or something not yours. */
export async function ignoreRow(id: string): Promise<void> {
  const statement = db
    .update(stagedTransactions)
    .set({ status: 'ignored' })
    .where(eq(stagedTransactions.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Undo a whole import, as long as nothing in it has been confirmed yet. */
export async function discardBatch(batchId: string): Promise<void> {
  const statement = db
    .delete(stagedTransactions)
    .where(
      and(eq(stagedTransactions.batchId, batchId), eq(stagedTransactions.status, 'unreviewed')),
    )
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

export const STAGING_TABLES = ['staged_transactions'] as const;
