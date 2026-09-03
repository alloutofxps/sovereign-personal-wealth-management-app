/* ===========================================================================
 * POTS
 * ---------------------------------------------------------------------------
 * A pot is an envelope in the budget book that happens to be saving up for
 * something. The target lives on the account itself rather than in a table of
 * its own, because a pot without an envelope would be a plan with nowhere for
 * the money to go.
 * ======================================================================== */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import type { AccountId, EnvelopeRole, IsoDate } from '@/core/ledger';
import type { PotTarget } from '@/core/goals';
import { db, runBatch } from '../client';
import { accounts, entries, postings } from '../schema/tables';

export interface PotRecord {
  id: AccountId;
  name: string;
  role: EnvelopeRole;
  balance: Minor;
  targetAmount: Minor | null;
  targetDate: string | null;
  recurring: boolean;
}

const SAVING_ROLES = ['goal', 'sinking_fund'] as const;

/** Every pot that is saving up for something, with its balance. */
export async function listSavingPots(): Promise<PotRecord[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      role: accounts.envelopeRole,
      targetAmount: accounts.targetAmount,
      targetDate: accounts.targetDate,
      recurring: accounts.targetRecurring,
      total: sql<number>`coalesce(sum(${postings.amount}), 0)`,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .where(
      and(
        eq(accounts.type, 'ENVELOPE'),
        inArray(accounts.envelopeRole, [...SAVING_ROLES]),
        eq(accounts.status, 'active'),
      ),
    )
    .groupBy(
      accounts.id,
      accounts.name,
      accounts.envelopeRole,
      accounts.targetAmount,
      accounts.targetDate,
      accounts.targetRecurring,
    );

  return rows.map((row) => ({
    id: row.id as AccountId,
    name: row.name,
    role: (row.role as EnvelopeRole) ?? 'goal',
    // Envelopes hold credit balances, so the raw total is negated to read
    // the way a person expects: a pot with money in it shows a positive.
    balance: minor(-Number(row.total)),
    targetAmount: row.targetAmount === null ? null : minor(row.targetAmount),
    targetDate: row.targetDate,
    recurring: row.recurring === 1,
  }));
}

/**
 * How much has been put into each pot during the current cycle.
 *
 * Without this, a pot that has already had its share this month would keep
 * asking for it, and safe-to-spend would hold the same money back twice.
 */
export async function assignedThisCycle(
  from: IsoDate,
  to: IsoDate,
): Promise<Map<AccountId, Minor>> {
  const rows = await db
    .select({
      accountId: postings.accountId,
      total: sql<number>`coalesce(sum(${postings.amount}), 0)`,
    })
    .from(postings)
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(
      sql`${entries.kind} = 'ASSIGN' AND ${entries.date} >= ${from} AND ${entries.date} <= ${to}
          AND ${postings.book} = 'BUDGET' AND ${postings.amount} < 0`,
    )
    .groupBy(postings.accountId);

  // A credit to an envelope is money going in, so negate to read positively.
  return new Map(rows.map((row) => [row.accountId as AccountId, minor(-Number(row.total))]));
}

/** Combine both queries into what the sinking-fund engine expects. */
export async function potTargets(from: IsoDate, to: IsoDate): Promise<PotTarget[]> {
  const [pots, assigned] = await Promise.all([listSavingPots(), assignedThisCycle(from, to)]);

  return pots.map((pot) => ({
    envelopeId: pot.id,
    name: pot.name,
    targetAmount: pot.targetAmount ?? minor(0),
    currentBalance: pot.balance,
    targetDate: pot.targetDate,
    recurring: pot.recurring,
    assignedThisCycle: assigned.get(pot.id) ?? minor(0),
  }));
}

export interface NewPot {
  id: AccountId;
  name: string;
  role: Extract<EnvelopeRole, 'goal' | 'sinking_fund'>;
  targetAmount: Minor;
  targetDate: string | null;
  recurring: boolean;
}

/** Create a pot, or update the target on one that already exists. */
export async function savePot(pot: NewPot): Promise<void> {
  const statement = db
    .insert(accounts)
    .values({
      id: pot.id,
      book: 'BUDGET',
      type: 'ENVELOPE',
      name: pot.name,
      normal: 'CREDIT',
      status: 'active',
      envelopeRole: pot.role,
      targetAmount: pot.targetAmount,
      targetDate: pot.targetDate,
      targetRecurring: pot.recurring ? 1 : 0,
      sortOrder: 500,
    })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        name: pot.name,
        envelopeRole: pot.role,
        targetAmount: pot.targetAmount,
        targetDate: pot.targetDate,
        targetRecurring: pot.recurring ? 1 : 0,
      },
    })
    .toSQL();

  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Archive a pot. Its history stays, so past months still add up. */
export async function archivePot(id: AccountId): Promise<void> {
  const statement = db
    .update(accounts)
    .set({ status: 'archived' })
    .where(eq(accounts.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

export const POT_TABLES = ['accounts', 'entries', 'postings'] as const;
