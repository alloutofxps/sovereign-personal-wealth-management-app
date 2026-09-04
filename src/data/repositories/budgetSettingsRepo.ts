/* ===========================================================================
 * THE SETTINGS THAT SHAPE A BUDGET
 * ---------------------------------------------------------------------------
 * Reading only, and kept apart from the rest of `budgetRepo` on purpose: the
 * home screen needs the cadence in order to cut its own period, and the home
 * screen is the first paint. Writing them is the budget screen's job, so
 * `writeBudgetSettings` lives next door where it can stay lazily loaded.
 *
 * They live in `meta`, the key/value table that has been there since v1,
 * rather than in browser storage: "carry the negative" changes what every past
 * month *means*, so restoring an export onto a new device without it would
 * silently rewrite history.
 * ======================================================================== */

import { sql } from 'drizzle-orm';
import type { BudgetCadence } from '@/core/liquidity';
import type { OverspendPolicy } from '@/core/budget';
import { db } from '../client';

export const BUDGET_SETTINGS_TABLES = ['meta'] as const;

export interface BudgetSettings {
  overspendPolicy: OverspendPolicy;
  cadence: BudgetCadence;
  /** The day a pay cycle is counted from. Null while on calendar months. */
  paycheckAnchor: string | null;
}

export const SETTING_KEYS = {
  policy: 'budget.overspend_policy',
  cadence: 'budget.cadence_mode',
  anchor: 'budget.paycheck_anchor',
} as const;

export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  overspendPolicy: 'deduct_next_rta',
  cadence: 'calendar_month',
  paycheckAnchor: null,
};

function isPolicy(value: string): value is OverspendPolicy {
  return value === 'deduct_next_rta' || value === 'carry_negative';
}

function isCadence(value: string): value is BudgetCadence {
  return (
    value === 'calendar_month' ||
    value === 'weekly' ||
    value === 'biweekly' ||
    value === 'semimonthly'
  );
}

/**
 * Read the settings, falling back rather than throwing.
 *
 * A hand-edited or half-migrated value must not stop the app opening, so
 * anything unrecognised is treated as the default.
 */
export async function readBudgetSettings(): Promise<BudgetSettings> {
  const rows = (await db.all(
    sql`SELECT key, value FROM meta WHERE key LIKE 'budget.%'`,
  )) as unknown as Record<number, unknown>[];

  const byKey = new Map(rows.map((row) => [String(row[0]), String(row[1])]));
  const policy = byKey.get(SETTING_KEYS.policy) ?? '';
  const cadence = byKey.get(SETTING_KEYS.cadence) ?? '';
  const anchor = byKey.get(SETTING_KEYS.anchor) ?? '';

  return {
    overspendPolicy: isPolicy(policy) ? policy : DEFAULT_BUDGET_SETTINGS.overspendPolicy,
    cadence: isCadence(cadence) ? cadence : DEFAULT_BUDGET_SETTINGS.cadence,
    paycheckAnchor: /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? anchor : null,
  };
}
