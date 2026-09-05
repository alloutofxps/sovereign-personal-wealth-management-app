/* ===========================================================================
 * STATEMENT CHECKS
 * ---------------------------------------------------------------------------
 * Reading the lines an account's statement should contain, ticking them off,
 * and — when the total agrees to the penny — locking that stretch of history.
 *
 * The lock is the only irreversible-feeling thing in this app, so two rules
 * hold it together. Nothing is locked unless the figures already match
 * exactly, checked again here rather than trusted from the screen. And the
 * lock and its record are written in one transaction, so there can never be
 * locked postings with no reconciliation explaining them, or a reconciliation
 * claiming a lock that did not happen.
 * ======================================================================== */

import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import { LedgerError, type AccountId, type IsoDate } from '@/core/ledger';
import {
  reconciliationState,
  type ReconcilableLine,
  type ReconciliationState,
} from '@/core/reconciliation/reconciliationMath';
import { db, runBatch } from '../client';
import { accounts, entries, postings, reconciliations } from '../schema/tables';

export const RECONCILIATION_TABLES = [
  'postings',
  'entries',
  'accounts',
  'reconciliations',
] as const;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export interface ReconciliationRecord {
  id: string;
  accountId: AccountId;
  statementDate: string;
  statementBalance: Minor;
  clearedBalance: Minor;
  discrepancy: Minor;
  status: 'completed' | 'reconciled_with_adjustment';
  createdAt: string;
}

/* ===========================================================================
 * READING WHERE THINGS STAND
 * ======================================================================== */

/**
 * Every line on this account up to a date, with its state.
 *
 * The FINANCIAL book only. The budget book's mirror of the same money is not
 * on anybody's bank statement, and including it would double every figure.
 */
export async function linesFor(
  accountId: AccountId,
  asOfDate: IsoDate,
): Promise<ReconcilableLine[]> {
  const rows = await db
    .select({
      postingId: postings.id,
      entryId: postings.entryId,
      date: entries.date,
      amount: postings.amount,
      description: entries.description,
      clearance: postings.clearance,
      reconciledAt: postings.reconciledAt,
    })
    .from(postings)
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(postings.book, 'FINANCIAL'),
        lte(entries.date, asOfDate),
      ),
    )
    .orderBy(desc(entries.date));

  return rows.map((row) => ({
    postingId: row.postingId,
    entryId: row.entryId,
    date: row.date,
    amount: minor(row.amount),
    description: row.description,
    // The same derivation as everywhere else: a date means locked.
    clearance: row.reconciledAt
      ? ('reconciled' as const)
      : (row.clearance as 'pending' | 'cleared'),
  }));
}

export interface ReconciliationView extends ReconciliationState {
  lines: ReconcilableLine[];
  accountName: string;
  /** The last check finished on this account, if there has been one. */
  lastReconciliation: ReconciliationRecord | null;
}

/**
 * Everything the statement-check screen needs, in one read.
 *
 * The totals come from the pure engine over the lines, rather than from a
 * second set of SQL sums. One source, so the banner and the checklist can
 * never disagree about what is ticked.
 */
export async function getReconciliationState(
  accountId: AccountId,
  asOfDate: IsoDate,
  statementBalance: Minor = minor(0),
): Promise<ReconciliationView> {
  const [lines, last, account] = await Promise.all([
    linesFor(accountId, asOfDate),
    lastReconciliation(accountId),
    db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, accountId)).limit(1),
  ]);

  return {
    ...reconciliationState({ lines, statementBalance, statementDate: asOfDate }),
    lines,
    accountName: account[0]?.name ?? 'this account',
    lastReconciliation: last,
  };
}

export async function lastReconciliation(
  accountId: AccountId,
): Promise<ReconciliationRecord | null> {
  const rows = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.accountId, accountId))
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.createdAt))
    .limit(1);

  const row = rows[0];
  return row ? toRecord(row) : null;
}

/** Every check ever done on an account, most recent first. */
export async function reconciliationHistory(
  accountId: AccountId,
  limit = 24,
): Promise<ReconciliationRecord[]> {
  const rows = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.accountId, accountId))
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.createdAt))
    .limit(limit);
  return rows.map(toRecord);
}

/* ===========================================================================
 * TICKING A LINE OFF
 * ======================================================================== */

/**
 * Flip one line between "gone through" and "not yet".
 *
 * Changes nothing about the money. A posting's amount, its date, its account
 * and both its books are exactly as they were; all that moves is whether the
 * bank has settled it. What somebody is worth cannot change by ticking a box,
 * and there is a property test that says so.
 */
export async function togglePostingClearance(
  postingId: string,
  targetState: 'pending' | 'cleared',
): Promise<void> {
  const rows = await db
    .select({ reconciledAt: postings.reconciledAt })
    .from(postings)
    .where(eq(postings.id, postingId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new LedgerError('That line could not be found, so nothing has been changed.');
  }
  if (row.reconciledAt) {
    throw new LedgerError(
      `That payment was locked during a statement check, so it cannot be ticked or ` +
        `unticked. Unlock that check first if it really needs to change.`,
    );
  }

  await db.update(postings).set({ clearance: targetState }).where(eq(postings.id, postingId));
}

/* ===========================================================================
 * FINISHING A CHECK
 * ======================================================================== */

export interface CommitResult {
  reconciliationId: string;
  /** How many lines were locked. */
  locked: number;
  clearedBalance: Minor;
}

/**
 * Lock everything that has gone through, up to the statement date.
 *
 * The balance is recomputed here and compared again before anything is
 * written. The screen has already done this arithmetic and shown a green
 * banner, but the screen is not the authority — a stale query, a second tab,
 * or an entry recorded while the sheet sat open would all produce a locked
 * stretch of history that does not actually match the statement it claims to.
 */
export async function commitReconciliation(
  accountId: AccountId,
  statementDate: IsoDate,
  statementBalance: Minor,
): Promise<CommitResult> {
  const lines = await linesFor(accountId, statementDate);
  const state = reconciliationState({ lines, statementBalance, statementDate });

  if (state.status !== 'balanced') {
    // No figure quoted: this layer has no locale and no currency, and a bare
    // count of minor units would read as a serial number rather than money.
    // The screen has the difference and shows it properly.
    throw new LedgerError(
      `This no longer adds up to what your bank says, so nothing has been locked. ` +
        `Something changed while the check was open. Go back through the list, and ` +
        `finish once the difference is nothing at all.`,
    );
  }

  const now = new Date().toISOString();
  const id = newId('rec');

  const record = db
    .insert(reconciliations)
    .values({
      id,
      accountId,
      statementDate,
      statementBalance,
      clearedBalance: state.clearedBalance,
      discrepancy: minor(0),
      status: 'completed',
      createdAt: now,
    })
    .toSQL();

  // Only lines that have gone through, only on this account, only up to the
  // statement date, and only ones not already locked. A pending line stays
  // pending: the bank has not settled it, so this check says nothing about it.
  const lock = db
    .update(postings)
    .set({ reconciledAt: now })
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(postings.clearance, 'cleared'),
        isNull(postings.reconciledAt),
        sql`${postings.entryId} IN (
              SELECT ${entries.id} FROM ${entries} WHERE ${entries.date} <= ${statementDate}
            )`,
      ),
    )
    .toSQL();

  // One transaction. Locked postings with no record explaining them would be
  // the app refusing to edit something for a reason it cannot state.
  await runBatch([
    { sql: record.sql, params: record.params },
    { sql: lock.sql, params: lock.params },
  ]);

  return { reconciliationId: id, locked: state.lockedCount, clearedBalance: state.clearedBalance };
}

/* ===========================================================================
 * UNDOING ONE
 * ======================================================================== */

/**
 * Unlock a completed check.
 *
 * Deliberately possible. A lock that cannot be undone is not a safeguard, it
 * is a trap — and the person whose money this is has the final say about their
 * own records. What the app owes them is that undoing it leaves a mark: the
 * reconciliation record stays, restated as having been unlocked, so the
 * history still explains why those months once agreed with the bank and now
 * carry an edit.
 */
export async function unlockReconciliation(reconciliationId: string): Promise<{ unlocked: number }> {
  const rows = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.id, reconciliationId))
    .limit(1);

  const record = rows[0];
  if (!record) {
    throw new LedgerError('That statement check could not be found.');
  }

  // Counted before the write, so the number reported back is the number of
  // records that were actually freed rather than a guess.
  const [counted] = await db
    .select({ n: sql<number>`count(*)` })
    .from(postings)
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(
      and(
        eq(postings.accountId, record.accountId),
        sql`${postings.reconciledAt} IS NOT NULL`,
        lte(entries.date, record.statementDate),
      ),
    );

  const unlock = db
    .update(postings)
    .set({ reconciledAt: null })
    .where(
      and(
        eq(postings.accountId, record.accountId),
        sql`${postings.reconciledAt} IS NOT NULL`,
        sql`${postings.entryId} IN (
              SELECT ${entries.id} FROM ${entries}
               WHERE ${entries.date} <= ${record.statementDate}
            )`,
      ),
    )
    .toSQL();

  const mark = db
    .update(reconciliations)
    .set({ status: 'reconciled_with_adjustment' })
    .where(eq(reconciliations.id, reconciliationId))
    .toSQL();

  await runBatch([
    { sql: unlock.sql, params: unlock.params },
    { sql: mark.sql, params: mark.params },
  ]);

  return { unlocked: Number(counted?.n ?? 0) };
}

/* --- reading rows -------------------------------------------------------- */

function toRecord(row: typeof reconciliations.$inferSelect): ReconciliationRecord {
  return {
    id: row.id,
    accountId: row.accountId as AccountId,
    statementDate: row.statementDate,
    statementBalance: minor(row.statementBalance),
    clearedBalance: minor(row.clearedBalance),
    discrepancy: minor(row.discrepancy),
    status: row.status as ReconciliationRecord['status'],
    createdAt: row.createdAt,
  };
}
