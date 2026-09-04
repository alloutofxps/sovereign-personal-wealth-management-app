/* ===========================================================================
 * READING AND WRITING THE BUDGET
 * ---------------------------------------------------------------------------
 * Allocations are not stored here, because they are not stored anywhere new:
 * an assignment is an ASSIGN entry in the BUDGET book, dated to the period it
 * funds. What was assigned to an envelope in a period is the sum of those
 * entries, and what is available is the whole history up to the end of that
 * period.
 *
 * Keeping it that way is what makes invariants I4 and I5 true by construction
 * rather than by agreement between two tables. A `budget_allocations` table
 * holding the same fact would be a second source of truth, and the drift would
 * be silent — the ledger would balance while the grid showed something else.
 *
 * The four budgeting settings live in `meta`, the key/value table that has
 * been there since v1. They belong with the ledger rather than in browser
 * storage: "carry the negative" changes what every past month *means*, so
 * restoring an export onto a new device without it would silently rewrite
 * history.
 * ======================================================================== */

import { sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import { applyPosting, noMovement } from '@/core/budget';
import { db, runBatch } from '../client';
import { meta } from '../schema/tables';
import { SETTING_KEYS, type BudgetSettings } from './budgetSettingsRepo';

export const BUDGET_TABLES = ['entries', 'postings', 'accounts', 'meta'] as const;

// Re-exported so the grid has one place to import from. Reading them really
// happens next door, out of the first paint's way.
export {
  DEFAULT_BUDGET_SETTINGS,
  readBudgetSettings,
  type BudgetSettings,
} from './budgetSettingsRepo';

/**
 * Store a change to the settings.
 *
 * Only the budget screen ever calls this, which is why the insert builder it
 * needs is here rather than beside the read.
 */
export async function writeBudgetSettings(patch: Partial<BudgetSettings>): Promise<void> {
  const entries: [string, string][] = [];
  if (patch.overspendPolicy) entries.push([SETTING_KEYS.policy, patch.overspendPolicy]);
  if (patch.cadence) entries.push([SETTING_KEYS.cadence, patch.cadence]);
  if (patch.paycheckAnchor !== undefined) {
    entries.push([SETTING_KEYS.anchor, patch.paycheckAnchor ?? '']);
  }
  if (entries.length === 0) return;

  await runBatch(
    entries.map(([key, value]) => {
      const statement = db
        .insert(meta)
        .values({ key, value })
        .onConflictDoUpdate({ target: meta.key, set: { value } })
        .toSQL();
      return { sql: statement.sql, params: statement.params };
    }),
  );
}

/* --- what the grid needs -------------------------------------------------- */

export interface EnvelopeRow {
  envelopeId: AccountId;
  name: string;
  /** The group it sits under, mirrored from the financial book. */
  groupId: AccountId | null;
  groupName: string | null;
  /** A saving pot's target, where it has one. */
  targetAmount: Minor | null;
  targetDate: string | null;
  role: string | null;
}

/** Every envelope a person can assign to, with its place in the tree. */
export async function listBudgetEnvelopes(): Promise<EnvelopeRow[]> {
  const rows = (await db.all(sql`
    SELECT a.id, a.name, a.parent_id, parent.name, a.target_amount, a.target_date, a.envelope_role
      FROM accounts a
      LEFT JOIN accounts parent ON parent.id = a.parent_id
     WHERE a.book = 'BUDGET' AND a.type = 'ENVELOPE'
       AND a.archived_at IS NULL
       AND COALESCE(a.envelope_role, '') <> 'group'
     ORDER BY a.sort_order, a.name`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    envelopeId: String(row[0]) as AccountId,
    name: String(row[1]),
    groupId: row[2] ? (String(row[2]) as AccountId) : null,
    groupName: row[3] ? String(row[3]) : null,
    targetAmount: row[4] === null || row[4] === undefined ? null : minor(Number(row[4])),
    targetDate: row[5] ? String(row[5]) : null,
    role: row[6] ? String(row[6]) : null,
  }));
}

export interface PeriodMovement {
  envelopeId: string;
  assigned: Minor;
  activity: Minor;
}

/**
 * What each envelope was assigned and spent, per period, up to a date.
 *
 * One query for the whole history rather than one per period: a personal
 * ledger is thousands of rows at most, and the alternative is a round trip per
 * month on every scroll of the grid.
 *
 * Assignments are the debits to Ready-to-Assign's counterpart — money moving
 * *into* an envelope. Activity is money moving out of it, which is what a
 * SPEND does to the budget book.
 */
export async function movementsByPeriod(
  through: string,
  cadenceKey: (date: string) => string,
): Promise<Map<string, PeriodMovement[]>> {
  const rows = (await db.all(sql`
    SELECT e.date, p.account_id, p.amount, e.kind
      FROM postings p
      JOIN entries e  ON e.id = p.entry_id
      JOIN accounts a ON a.id = p.account_id
     WHERE p.book = 'BUDGET' AND a.type = 'ENVELOPE'
       AND COALESCE(a.envelope_role, '') <> 'group'
       AND e.date <= ${through}
     ORDER BY e.date ASC`)) as unknown as Record<number, unknown>[];

  const byPeriod = new Map<string, Map<string, PeriodMovement>>();

  for (const row of rows) {
    const date = String(row[0]);
    const envelopeId = String(row[1]);
    const amount = Number(row[2]);
    const key = cadenceKey(date);

    const period = byPeriod.get(key) ?? new Map<string, PeriodMovement>();
    const previous = period.get(envelopeId) ?? { envelopeId, ...noMovement() };

    // Which column a posting belongs in is decided in `@/core/budget`, where
    // it can be reasoned about and tested without a database behind it.
    period.set(envelopeId, {
      envelopeId,
      ...applyPosting(previous, String(row[3]), minor(amount)),
    });
    byPeriod.set(key, period);
  }

  return new Map([...byPeriod].map(([key, movements]) => [key, [...movements.values()]]));
}

/**
 * Everything assigned to a period after the one being looked at.
 *
 * Net, not gross: money put into a future pot and then taken back out again
 * was never promised to anything, and counting only the way in would have the
 * grid warning about a commitment the person had already undone.
 */
export async function assignedAfter(periodEnd: string): Promise<Minor> {
  const [row] = (await db.all(sql`
    SELECT COALESCE(-SUM(p.amount), 0)
      FROM postings p
      JOIN entries e  ON e.id = p.entry_id
      JOIN accounts a ON a.id = p.account_id
     WHERE p.book = 'BUDGET' AND a.type = 'ENVELOPE' AND e.kind = 'ASSIGN'
       AND COALESCE(a.envelope_role, '') <> 'group'
       AND e.date > ${periodEnd}`)) as unknown as Record<number, unknown>[];

  return minor(Number(row?.[0] ?? 0));
}
