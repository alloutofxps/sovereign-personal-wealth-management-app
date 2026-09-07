/* ===========================================================================
 * HAS THIS PERSON BEEN HERE BEFORE?
 * ---------------------------------------------------------------------------
 * One question, asked once, on the first paint of every session. It has to be
 * cheap and it has to be right, and those pull in different directions.
 *
 * Cheap would be `localStorage`. Right rules it out: somebody who restores an
 * export onto a new phone has a household set up already, and being walked
 * through "where is your money?" on top of eleven accounts that are already
 * there would be worse than useless — it would look as though the restore had
 * failed. So it lives in `meta`, travels with the export, and a restored
 * database arrives already knowing it has been through this.
 *
 * `meta` is the key/value table, so this is a row rather than a column. See
 * the note in migrations/v17.ts for why the brief's `onboarding_completed_at`
 * column would have been the wrong shape.
 * ======================================================================== */

import { sql } from 'drizzle-orm';
import { db, runBatch } from '../client';

export const ONBOARDING_TABLES = ['meta'] as const;

export const ONBOARDING_KEYS = {
  /** ISO timestamp. Present means the wizard has been finished or dismissed. */
  completedAt: 'onboarding.completed_at',
} as const;

/**
 * When the first run was finished, or null if it never has been.
 *
 * Reads rather than throws on anything unexpected: a hand-edited value must
 * never be the reason somebody cannot open their own money.
 */
export async function onboardingCompletedAt(): Promise<string | null> {
  try {
    const rows = (await db.all(
      sql`SELECT value FROM meta WHERE key = ${ONBOARDING_KEYS.completedAt}`,
    )) as unknown as Record<number, unknown>[];

    const value = rows[0]?.[0];
    return value === undefined || value === null ? null : String(value);
  } catch {
    // A database old enough not to have `meta` cannot have completed this.
    return null;
  }
}

/**
 * Mark the first run as done.
 *
 * Called both when somebody works through every step and when they close the
 * wizard early — a person who has said "not now" has answered the question,
 * and asking again on the next launch would be nagging. Everything the wizard
 * sets up is reachable from Settings and the balance sheet afterwards.
 */
export async function markOnboardingComplete(at: string = new Date().toISOString()): Promise<void> {
  await runBatch([
    {
      sql: `INSERT INTO meta (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      params: [ONBOARDING_KEYS.completedAt, at],
    },
  ]);
}
