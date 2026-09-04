/* ===========================================================================
 * WHAT A POSITION IS WORTH
 * ---------------------------------------------------------------------------
 * A third of a share cannot be written down in binary floating point. Neither
 * can 0.1. A register that stores share counts as doubles will, given enough
 * buys, stop being able to add up its own rows — and the person will be shown
 * a portfolio total that does not equal the sum of the lines above it.
 *
 * So quantities are exact integers at 1e8, the same discipline money already
 * gets here, and every scaling goes through `mulDivRound`, which falls back to
 * BigInt the moment a product would leave the safe-integer range. That matters
 * more than it sounds: a hundred thousand shares at €118.50 is 1.2e17 as a
 * naive product, well past where a double stops counting in ones.
 * ======================================================================== */

import {
  BP_ZERO,
  basisPoints,
  minor,
  mulDivRound,
  toDecimalString,
  type BasisPoints,
  type Minor,
} from '@/core/money';

/** Shares are stored as integers at this scale. 1.0 share = 100,000,000. */
export const QUANTITY_SCALE = 100_000_000;

/** The number of decimal places a share count is kept to. */
export const QUANTITY_EXPONENT = 8;

export type AssetClass =
  | 'equity'
  | 'fixed_income'
  | 'cash_equivalent'
  | 'real_estate'
  | 'commodity'
  | 'crypto'
  | 'other';

export interface Security {
  id: string;
  symbol: string;
  name: string;
  isin: string | null;
  assetClass: AssetClass;
  currency: string;
  /** Annual charge in basis points. 22 is 0.22% a year. */
  expenseRatioBp: BasisPoints;
}

export interface Holding {
  id: string;
  accountId: string;
  security: Security;
  /** Shares as an exact integer at 1e8. */
  quantity1e8: number;
  /** What the whole position cost, in minor units. */
  costBasis: Minor;
  /** Minor units for one whole share, from the latest price on record. */
  priceMinor: Minor;
  /** The day that price was recorded, or null while none has been. */
  pricedOn: string | null;
}

export interface HoldingValue {
  marketValue: Minor;
  /** Market value less what it cost. Negative when it is down. */
  gainLoss: Minor;
  /** The same, as a return in basis points. 1,840 is +18.40%. */
  returnBp: BasisPoints;
}

/**
 * What a position is worth at a given price.
 *
 * `price × quantity ÷ 1e8`, in one rounded step rather than two. Dividing
 * first would throw away the fractional shares before they were paid for.
 */
export function marketValue(priceMinor: Minor, quantity1e8: number): Minor {
  return mulDivRound(priceMinor, quantity1e8, QUANTITY_SCALE);
}

/**
 * What a position is worth, what it has made, and what that is as a return.
 *
 * A cost basis of nothing returns nothing rather than infinity: a position
 * that was given to you, or whose cost has not been entered yet, has no
 * meaningful percentage return, and 0% is the only honest thing to show.
 */
export function valueOf(holding: Holding): HoldingValue {
  const value = marketValue(holding.priceMinor, holding.quantity1e8);
  const gainLoss = minor(value - holding.costBasis);

  return {
    marketValue: value,
    gainLoss,
    returnBp:
      holding.costBasis === 0
        ? BP_ZERO
        : basisPoints(mulDivRound(gainLoss, 10_000, holding.costBasis)),
  };
}

export interface PortfolioTotals {
  marketValue: Minor;
  costBasis: Minor;
  gainLoss: Minor;
  returnBp: BasisPoints;
}

/** The same three figures across a whole portfolio. */
export function totalsOf(holdings: readonly Holding[]): PortfolioTotals {
  let value = 0;
  let cost = 0;

  for (const holding of holdings) {
    value += marketValue(holding.priceMinor, holding.quantity1e8);
    cost += holding.costBasis;
  }

  const gainLoss = minor(value - cost);
  return {
    marketValue: minor(value),
    costBasis: minor(cost),
    gainLoss,
    returnBp: cost === 0 ? BP_ZERO : basisPoints(mulDivRound(gainLoss, 10_000, cost)),
  };
}

/* ===========================================================================
 * WRITING A SHARE COUNT DOWN
 * ======================================================================== */

/**
 * A share count as a person would write it: `10.5`, `0.0042512`, `100`.
 *
 * Built from the integer by string surgery rather than by dividing — dividing
 * 4_251_200 by 1e8 and formatting the result reintroduces exactly the float
 * that storing an integer was meant to avoid, and it shows up as `0.00425120000001`
 * on the one holding somebody looks at closest.
 */
export function formatQuantity(quantity1e8: number): string {
  const text = toDecimalString(minor(quantity1e8), QUANTITY_EXPONENT);
  if (!text.includes('.')) return text;
  // Trailing zeros carry no information about a share count, and eight of them
  // make every whole number look like a measurement.
  return text.replace(/\.?0+$/, '');
}

/** `"10.5"` → `1_050_000_000`. Rejects more than eight decimal places. */
export function parseQuantity(input: string): number {
  const cleaned = input.trim().replace(/[\s'_]/g, '').replace(',', '.');
  if (cleaned === '') return 0;
  if (!/^\d*\.?\d*$/.test(cleaned)) {
    throw new Error(`That is not a number of shares: "${input}".`);
  }

  const [whole = '', fraction = ''] = cleaned.split('.');
  if (fraction.length > QUANTITY_EXPONENT) {
    throw new Error(
      `Share counts are kept to ${QUANTITY_EXPONENT} decimal places, and "${input}" has more.`,
    );
  }

  const digits = `${whole || '0'}${fraction.padEnd(QUANTITY_EXPONENT, '0')}`;
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) {
    throw new Error('That is more shares than this can count exactly.');
  }
  return value;
}

/**
 * How a return reads next to a figure: `+18.40%`, `−3.20%`, `0.00%`.
 *
 * The sign is always shown on a non-zero return, because a percentage without
 * one beside a portfolio total is ambiguous in the direction that matters.
 */
export function formatReturn(returnBp: BasisPoints): string {
  const sign = returnBp > 0 ? '+' : returnBp < 0 ? '−' : '';
  const magnitude = Math.abs(returnBp);
  return `${sign}${(magnitude / 100).toFixed(2)}%`;
}

/* ===========================================================================
 * KEEPING THE REGISTER AND THE BALANCE SHEET EQUAL
 * ======================================================================== */

export interface Reconciliation {
  /** What the account balance should be set to. */
  target: Minor;
  /** How far it has to move to get there. Zero means leave it alone. */
  delta: Minor;
  /** Money in the account that the register does not know about. */
  uninvestedCash: Minor;
}

/**
 * What an investment account should be worth, given what its holdings add up
 * to and what its balance currently says.
 *
 * The subtlety is money sitting in the account that has not been invested yet.
 * Somebody who transfers €500 to a broker on Monday and buys on Friday has an
 * account worth €500 more than its holdings all week, and a reconciliation
 * that simply set the balance to the register's total would delete that €500 —
 * silently, on a screen they were not looking at.
 *
 * So the register's total is not the target on its own. Whatever the balance
 * holds above the last agreed figure is cash the register cannot see, and it
 * is carried through untouched.
 *
 * `lastRegisterValue` is null the first time the two are reconciled, or for an
 * account that predates the figure being recorded. Then the safe assumption is
 * that *none* of the balance is uninvested cash rather than all of it —
 * guessing the other way would take an account already holding shares and add
 * their whole value to itself a second time.
 */
export function reconcileTarget(input: {
  registerValue: Minor;
  ledgerValue: Minor;
  lastRegisterValue: Minor | null;
}): Reconciliation {
  const uninvested =
    input.lastRegisterValue === null
      ? minor(0)
      : minor(input.ledgerValue - input.lastRegisterValue);

  // Floored at zero: a negative residual means the balance has fallen behind
  // the register for some reason this cannot see, and inventing negative cash
  // to explain it would make the next reconciliation worse, not better.
  const target = minor(input.registerValue + Math.max(0, uninvested));

  return { target, delta: minor(target - input.ledgerValue), uninvestedCash: uninvested };
}
