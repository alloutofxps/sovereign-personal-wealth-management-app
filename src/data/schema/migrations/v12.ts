/* ===========================================================================
 * VERSION 12 — SELLING, AND WHAT IT COSTS YOU IN TAX
 * ---------------------------------------------------------------------------
 * A register that can only be added to is half a register. This step completes
 * the lifecycle: shares can be sold, the gain worked out against what those
 * particular shares actually cost, dividends recorded whether they arrive as
 * cash or as more shares, and a target allocation written down so the next
 * deposit has somewhere to go.
 *
 * The important table is `tax_lots`. A holding says "you have 50 shares that
 * cost €5,500"; a tax lot says "20 of them were bought in January at €100 and
 * 30 in June at €116.67". Those are not the same fact, and the difference is
 * the entire gain calculation. Sell 20 shares and what you owe tax on depends
 * on *which* 20 — and the only defensible answer without asking somebody to
 * pick parcels by hand is the oldest first, which is what most tax authorities
 * assume and what this implements.
 *
 * Averaging the cost across the whole holding, as the `holdings` table does on
 * its own, is legal in some places and wrong in others, and it silently gives
 * a different gain figure. So the lots are kept alongside rather than derived,
 * and `remaining_quantity_1e8` across open lots must always equal the holding's
 * quantity — a property the tests assert over 200 random buy-and-sell runs.
 *
 * `investment_trades` is history rather than state. Nothing computes a balance
 * from it; it exists so somebody can see what they did and when, and so a
 * realized gain has somewhere to live that is not an accounting entry.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** How the cost of sold shares is worked out. FIFO for now; see the note above. */
export const RELIEF_METHODS = ['fifo'] as const;

export const TRADE_TYPES = ['buy', 'sell', 'dividend_reinvest', 'dividend_cash'] as const;

const TRADE_TYPE_LIST = TRADE_TYPES.map((t) => `'${t}'`).join(',');

const ASSET_CLASS_LIST = [
  'equity',
  'fixed_income',
  'cash_equivalent',
  'real_estate',
  'commodity',
  'crypto',
  'other',
]
  .map((c) => `'${c}'`)
  .join(',');

const TAX_LOTS = `CREATE TABLE IF NOT EXISTS tax_lots (
   id                     TEXT PRIMARY KEY,
   account_id             TEXT NOT NULL REFERENCES accounts(id),
   security_id            TEXT NOT NULL REFERENCES securities(id),
   holding_id             TEXT NOT NULL REFERENCES holdings(id),
   acquired_date          TEXT NOT NULL CHECK (acquired_date LIKE '____-__-__'),
   -- What the parcel was when it was bought. Never changes.
   quantity_1e8           INTEGER NOT NULL CHECK (quantity_1e8 > 0),
   -- What is left of it. Falls to zero as the parcel is sold off.
   remaining_quantity_1e8 INTEGER NOT NULL CHECK (remaining_quantity_1e8 >= 0),
   -- What the whole original parcel cost, in minor units.
   cost_basis_minor       INTEGER NOT NULL CHECK (cost_basis_minor >= 0),
   is_closed              INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0,1)),
   created_at             TEXT NOT NULL
 );`;

const TRADES = `CREATE TABLE IF NOT EXISTS investment_trades (
   id                  TEXT PRIMARY KEY,
   account_id          TEXT NOT NULL REFERENCES accounts(id),
   security_id         TEXT NOT NULL REFERENCES securities(id),
   trade_type          TEXT NOT NULL CHECK (trade_type IN (${TRADE_TYPE_LIST})),
   date                TEXT NOT NULL CHECK (date LIKE '____-__-__'),
   quantity_1e8        INTEGER NOT NULL DEFAULT 0,
   price_minor         INTEGER NOT NULL DEFAULT 0,
   gross_amount_minor  INTEGER NOT NULL,
   fees_minor          INTEGER NOT NULL DEFAULT 0,
   -- Set on a sale. Null everywhere else, because nothing was realised.
   realized_gain_minor INTEGER,
   entry_id            TEXT REFERENCES entries(id),
   created_at          TEXT NOT NULL
 );`;

/**
 * What somebody wants their portfolio to look like.
 *
 * One row per class, and the rows are only meaningful together — a target of
 * 60% equities says nothing without knowing what the other 40% is. The
 * repository enforces that the active rows add to exactly 10,000 basis points
 * before writing any of them, so a half-finished target can never be saved and
 * then quietly used to give somebody advice.
 */
const TARGETS = `CREATE TABLE IF NOT EXISTS target_allocations (
   id          TEXT PRIMARY KEY,
   asset_class TEXT NOT NULL UNIQUE CHECK (asset_class IN (${ASSET_CLASS_LIST})),
   target_bp   INTEGER NOT NULL CHECK (target_bp >= 0 AND target_bp <= 10000),
   created_at  TEXT NOT NULL,
   updated_at  TEXT NOT NULL
 );`;

export function v12Statements(): string[] {
  return [
    TAX_LOTS,
    // Exactly the shape the relief engine reads in: one security in one
    // account, open lots only, oldest first.
    `CREATE INDEX IF NOT EXISTS idx_tax_lots_lookup
       ON tax_lots(account_id, security_id, is_closed, acquired_date ASC);`,
    `CREATE INDEX IF NOT EXISTS idx_tax_lots_holding ON tax_lots(holding_id);`,

    TRADES,
    `CREATE INDEX IF NOT EXISTS idx_trades_account_date
       ON investment_trades(account_id, date DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_trades_security ON investment_trades(security_id, date DESC);`,

    TARGETS,
  ];
}

export const V12: MigrationStep = {
  to: 12,
  reason:
    'Selling shares, working the gain out against what those particular shares cost, ' +
    'recording dividends, and writing down what the portfolio is meant to look like.',
  statements: v12Statements(),
};
