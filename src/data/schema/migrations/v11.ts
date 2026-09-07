/* ===========================================================================
 * VERSION 11 — WHAT IS ACTUALLY IN THE INVESTMENT ACCOUNT
 * ---------------------------------------------------------------------------
 * v10 let somebody record a brokerage account as a single figure. That is
 * enough to know what they are worth and nothing else: it cannot say what they
 * hold, what they paid for it, how it is spread across asset classes, or —
 * the one nobody is ever shown — what the funds charge them each year for
 * holding it.
 *
 * Three tables, and the split between them matters:
 *
 *   securities       what a thing *is*. One row per ticker, shared across
 *                    every account that holds it, because VWCE in a pension
 *                    and VWCE in a brokerage are the same fund with the same
 *                    fee, and storing that twice is how the two come to
 *                    disagree.
 *   holdings         how much of it *you* have, and what you paid. One row
 *                    per account-and-security, which is why the unique index
 *                    is on the pair.
 *   security_prices  what it was worth on a given day. Append-only history,
 *                    so a portfolio can be looked at as it stood rather than
 *                    only as it stands.
 *
 * Quantities are integers at 1e8, not floats. A third of a share is not
 * representable in binary floating point, and a register that cannot add up
 * its own rows is worse than no register — so the same discipline that governs
 * money here governs share counts: exact integers, scaled, all the way down.
 * The scale is 1e8 because that is what fractional-share brokers and every
 * crypto ledger settle on, and it leaves room for a €100,000 position in
 * something priced in fractions of a cent.
 *
 * On the price table having no unique index: the brief specified only a lookup
 * index, and that is right. The same security genuinely can be marked twice in
 * one day — an intraday note and a close — and the register reads the latest
 * row rather than assuming there is only one.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/**
 * What kind of thing a security is, for allocation.
 *
 * About the risk it carries rather than the wrapper it comes in: a property
 * fund is real estate whether it is held as an ETF or a trust, and somebody
 * looking at their allocation wants to know how much of their money is exposed
 * to houses, not how many fund structures they own.
 */
export const ASSET_CLASSES = [
  'equity',
  'fixed_income',
  'cash_equivalent',
  'real_estate',
  'commodity',
  'crypto',
  'other',
] as const;

/** Quantities are stored as integers at this scale. 1.0 share = 100,000,000. */
export const QUANTITY_SCALE = 100_000_000;

const CLASS_LIST = ASSET_CLASSES.map((c) => `'${c}'`).join(',');

const SECURITIES = `CREATE TABLE IF NOT EXISTS securities (
   id               TEXT PRIMARY KEY,
   symbol           TEXT NOT NULL,
   name             TEXT NOT NULL,
   isin             TEXT,
   asset_class      TEXT NOT NULL CHECK (asset_class IN (${CLASS_LIST})),
   currency         TEXT NOT NULL DEFAULT 'EUR',
   -- Annual charge in basis points: 7 is 0.07% a year, 22 is 0.22%.
   expense_ratio_bp INTEGER NOT NULL DEFAULT 0 CHECK (expense_ratio_bp >= 0),
   created_at       TEXT NOT NULL
 );`;

const HOLDINGS = `CREATE TABLE IF NOT EXISTS holdings (
   id           TEXT PRIMARY KEY,
   account_id   TEXT NOT NULL REFERENCES accounts(id),
   security_id  TEXT NOT NULL REFERENCES securities(id),
   -- Shares as an exact integer at 1e8. 10.5 shares is 1,050,000,000.
   quantity_1e8 INTEGER NOT NULL,
   -- What the whole position cost, in minor units. Never a per-share figure:
   -- a position built over four purchases has one cost and four prices, and
   -- storing the average is how the two stop agreeing.
   cost_basis   INTEGER NOT NULL,
   created_at   TEXT NOT NULL,
   updated_at   TEXT NOT NULL
 );`;

const PRICES = `CREATE TABLE IF NOT EXISTS security_prices (
   id          TEXT PRIMARY KEY,
   security_id TEXT NOT NULL REFERENCES securities(id),
   date        TEXT NOT NULL CHECK (date LIKE '____-__-__'),
   -- Minor units for one whole share.
   price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
   source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv')),
   created_at  TEXT NOT NULL
 );`;

export function v11Statements(): string[] {
  return [
    SECURITIES,
    // One row per ticker, shared by every account. Case is normalised before
    // the write rather than here, so 'vwce' and 'VWCE' cannot both exist.
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_securities_symbol ON securities(symbol);`,
    `CREATE INDEX IF NOT EXISTS idx_securities_class ON securities(asset_class);`,

    HOLDINGS,
    // Buying more of something you already hold adds to the position rather
    // than creating a second row beside it; this is what makes that true.
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_holdings_account_security
       ON holdings(account_id, security_id);`,
    `CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);`,

    PRICES,
    // Newest first, which is the only order anything reads this in.
    `CREATE INDEX IF NOT EXISTS idx_security_prices_lookup
       ON security_prices(security_id, date DESC);`,
  ];
}

export const V11: MigrationStep = {
  to: 11,
  reason:
    'What is actually held in an investment account: the securities, the share counts, ' +
    'what they cost, and what the funds charge for them.',
  statements: v11Statements(),
};
