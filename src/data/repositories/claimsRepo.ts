/* ===========================================================================
 * MONEY YOU FRONTED
 * ---------------------------------------------------------------------------
 * A claim is money you paid out that somebody else owes back — a work trip, a
 * dinner you covered. It is deliberately not your spending, and the repayment
 * is deliberately not your income, so both stay out of every figure on the
 * dashboard until the claim is either settled or written off.
 * ======================================================================== */

import { desc, eq, inArray, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import type { ClaimId, IsoDate } from '@/core/ledger';
import { db, runBatch } from '../client';
import { claims } from '../schema/tables';

export type ClaimKind = 'work_expense' | 'shared_with_friends' | 'insurance' | 'other';
export type ClaimStatus = 'open' | 'partly_settled' | 'settled' | 'written_off';

export interface Claim {
  id: ClaimId;
  /** Who owes you, as you would say it: "Work", "Sam". */
  counterparty: string;
  kind: ClaimKind;
  expected: Minor;
  settled: Minor;
  outstanding: Minor;
  status: ClaimStatus;
  openedOn: string;
  note: string | null;
}

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = {
  work_expense: 'Something for work',
  shared_with_friends: 'Split with friends',
  insurance: 'Going through insurance',
  other: 'Something else',
};

type Row = typeof claims.$inferSelect;

function toClaim(row: Row): Claim {
  const expected = minor(row.expected);
  const settled = minor(row.settled);
  return {
    id: row.id as ClaimId,
    counterparty: row.counterparty,
    kind: row.kind as ClaimKind,
    expected,
    settled,
    outstanding: minor(Math.max(0, expected - settled)),
    status: row.status as ClaimStatus,
    openedOn: row.openedOn,
    note: row.note,
  };
}

/** Everything still owed to you, oldest first. */
export async function listOpenClaims(): Promise<Claim[]> {
  const rows = await db
    .select()
    .from(claims)
    .where(inArray(claims.status, ['open', 'partly_settled']))
    .orderBy(claims.openedOn);
  return rows.map(toClaim);
}

export async function listAllClaims(limit = 100): Promise<Claim[]> {
  const rows = await db.select().from(claims).orderBy(desc(claims.openedOn)).limit(limit);
  return rows.map(toClaim);
}

export async function totalOwedToYou(): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${claims.expected} - ${claims.settled}), 0)` })
    .from(claims)
    .where(inArray(claims.status, ['open', 'partly_settled']));
  return minor(Math.max(0, Number(row?.total ?? 0)));
}

export interface NewClaim {
  id: ClaimId;
  counterparty: string;
  kind: ClaimKind;
  expected: Minor;
  openedOn: IsoDate;
  note?: string | null;
}

export async function openClaim(claim: NewClaim): Promise<void> {
  const statement = db
    .insert(claims)
    .values({
      id: claim.id,
      counterparty: claim.counterparty,
      kind: claim.kind,
      expected: claim.expected,
      settled: 0,
      status: 'open',
      openedOn: claim.openedOn,
      note: claim.note ?? null,
    })
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/**
 * Record money coming back against a claim.
 *
 * A partial repayment leaves the claim open for the rest; anything that
 * settles it in full closes it. The ledger entry is written separately, in the
 * same batch, so the two can never drift apart.
 */
export function settleClaimStatement(claim: Claim, amount: Minor) {
  const settled = minor(claim.settled + amount);
  const status: ClaimStatus = settled >= claim.expected ? 'settled' : 'partly_settled';

  return db
    .update(claims)
    .set({ settled, status })
    .where(eq(claims.id, claim.id))
    .toSQL();
}

/** Give up on a claim. The money finally becomes spending, in this month. */
export function writeOffStatement(claim: Claim) {
  return db
    .update(claims)
    .set({ status: 'written_off' })
    .where(eq(claims.id, claim.id))
    .toSQL();
}

export const CLAIM_TABLES = ['claims', 'entries', 'postings'] as const;
