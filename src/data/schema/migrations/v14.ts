/* ===========================================================================
 * VERSION 14 — MONEY IN MORE THAN ONE CURRENCY
 * ---------------------------------------------------------------------------
 * Until now every amount in this ledger was in one currency, and the whole
 * arithmetic rested on that: "does this entry balance?" was `sum === 0`,
 * because every line was denominated the same way. A dollar account breaks
 * that in the most fundamental way possible — €1,000 out and $1,080 in is a
 * perfectly correct transfer whose native amounts sum to 80.
 *
 * So every posting gains two fields: what moved in the account's own currency,
 * and what that was worth in the household's reporting currency at the time.
 * Balance is then asserted on the second, which is the only figure all the
 * lines share. The first stays exact and untouched, because a dollar account's
 * statement says dollars and the app must agree with it to the cent.
 *
 * Rates are integers at 1e6 — six decimal places, which is what every rate
 * source publishes and more than enough that a rounding difference is a cent
 * rather than a euro. They are stored as quote-per-base: 1.085215 on the
 * EUR/USD row means one euro buys 1.085215 dollars.
 *
 * Two columns the brief did not name are added here because the slice cannot
 * work without them:
 *
 *   · `accounts.currency`. The brief's own verification creates a USD checking
 *     account, and Module 5 renders "any account where currency !== base" —
 *     neither is expressible without somewhere to record it. It defaults to
 *     the base currency, so every existing account is unchanged.
 *
 *   · `entries.fx_note`. A cross-currency entry needs somewhere to say which
 *     rate it was struck at, so the figure can be explained months later
 *     rather than only recomputed.
 *
 * The backfill is the load-bearing part. Every posting that already exists was
 * made in the base currency, so `base_amount = amount` and the rate is exactly
 * one. That is true rather than assumed: there was no other currency to have
 * been in. It means every balance, every invariant and every screen reads
 * identically the moment this migration lands.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** Rates are integers at this scale. 1.085215 → 1_085_215. */
export const RATE_SCALE = 1_000_000;

/** The rate of a currency against itself. Always exactly one. */
export const IDENTITY_RATE = RATE_SCALE;

const FX_RATES = `CREATE TABLE IF NOT EXISTS fx_rates (
   id             TEXT PRIMARY KEY,
   -- The household's reporting currency. One euro buys rate_scaled of the
   -- quote currency (at 1e6), so the pair reads EUR/USD = 1.085215.
   base_currency  TEXT NOT NULL,
   quote_currency TEXT NOT NULL,
   rate_scaled    INTEGER NOT NULL CHECK (rate_scaled > 0),
   date           TEXT NOT NULL CHECK (date LIKE '____-__-__'),
   source         TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','ecb','csv')),
   created_at     TEXT NOT NULL
 );`;

export function v14Statements(): string[] {
  return [
    FX_RATES,
    // One rate per pair per day. A second opinion about the same day is a
    // correction, not a second fact, so it replaces rather than stacking.
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_rates_pair_date
       ON fx_rates(base_currency, quote_currency, date);`,
    // "What was this worth on or before that day?" — the only shape anything
    // reads rates in.
    `CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup ON fx_rates(quote_currency, date DESC);`,

    // Every posting that already exists was made in the base currency. This is
    // a statement of fact rather than an assumption: there was no other
    // currency for it to have been in.
    `UPDATE postings SET base_amount = amount WHERE base_amount IS NULL OR base_amount = 0;`,
    `UPDATE postings SET fx_rate_scaled = ${IDENTITY_RATE}
      WHERE fx_rate_scaled IS NULL OR fx_rate_scaled = 0;`,

    `CREATE INDEX IF NOT EXISTS idx_postings_base_book ON postings(book, base_amount);`,
  ];
}

export const V14: MigrationStep = {
  to: 14,
  reason:
    'Accounts and securities in other currencies, the rates they were converted at, and ' +
    'balance asserted on what everything is worth in the one currency you report in.',
  addColumns: [
    // Signed minor units in the household's reporting currency. Defaulting to
    // zero rather than to `amount` because a column default cannot reference
    // another column; the backfill above sets it properly.
    { table: 'postings', column: 'base_amount', declaration: `INTEGER NOT NULL DEFAULT 0` },
    {
      table: 'postings',
      column: 'fx_rate_scaled',
      declaration: `INTEGER NOT NULL DEFAULT ${IDENTITY_RATE}`,
    },
    // Not in the brief, but the slice cannot work without it — see the note at
    // the top of this file.
    { table: 'accounts', column: 'currency', declaration: 'TEXT' },
    { table: 'entries', column: 'fx_note', declaration: 'TEXT' },
  ],
  statements: v14Statements(),
};
