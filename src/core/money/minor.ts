/* ===========================================================================
 * MINOR-UNIT ARITHMETIC
 * ---------------------------------------------------------------------------
 * Every amount in Sovereign is a signed integer count of a currency's minor
 * unit — cents, yen, fils. There are no floats anywhere in the ledger, because
 * floating-point drift is the failure mode that destroys trust in a ledger and
 * it is unrecoverable once it enters the journal.
 *
 * `Minor` is a branded number, so the compiler rejects a raw `number` at every
 * ledger boundary. Constructing one is deliberate and validated.
 * ======================================================================== */

declare const minorBrand: unique symbol;

/** A signed integer amount in a currency's minor unit. */
export type Minor = number & { readonly [minorBrand]: 'Minor' };

/** JS integers are exact to 2^53−1 — about 90 trillion major units. */
export const MINOR_MAX = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

/** Construct a Minor from an integer. Throws on anything else. */
export function minor(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      `Amount must be a safe integer number of minor units, received ${value}. ` +
        `A fractional value here means a float leaked into the ledger.`,
    );
  }
  return value as Minor;
}

export const ZERO: Minor = 0 as Minor;

/** Assert at a boundary without allocating a new value. */
export function assertMinor(value: number): asserts value is Minor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Not a valid minor amount: ${value}`);
  }
}

/* --- arithmetic ---------------------------------------------------------- */

export function add(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

export function neg(a: Minor): Minor {
  return minor(-a);
}

export function abs(a: Minor): Minor {
  return minor(Math.abs(a));
}

export function sum(amounts: readonly Minor[]): Minor {
  let total = 0;
  for (const a of amounts) total += a;
  return minor(total);
}

/** Multiply by a whole number of times (e.g. 12 monthly payments). */
export function mulInt(a: Minor, factor: number): Minor {
  if (!Number.isSafeInteger(factor)) {
    throw new MoneyError(`mulInt factor must be an integer, received ${factor}`);
  }
  return minor(a * factor);
}

export function sign(a: Minor): -1 | 0 | 1 {
  return a < 0 ? -1 : a > 0 ? 1 : 0;
}

export const isZero = (a: Minor): boolean => a === 0;
export const isNegative = (a: Minor): boolean => a < 0;
export const isPositive = (a: Minor): boolean => a > 0;

export function compare(a: Minor, b: Minor): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const min = (a: Minor, b: Minor): Minor => (a <= b ? a : b);
export const max = (a: Minor, b: Minor): Minor => (a >= b ? a : b);

/* --- scaling ------------------------------------------------------------- */

/**
 * `(a × numerator) ÷ denominator`, rounded half away from zero, with no
 * intermediate float. This is the only way a Minor is ever scaled: interest,
 * percentages, proration and (later) FX all route through here.
 *
 * The fast path is plain integer arithmetic. When `a × numerator` would exceed
 * the safe-integer range it falls back to BigInt — correctness never depends
 * on the magnitude of the inputs.
 */
export function mulDivRound(a: Minor, numerator: number, denominator: number): Minor {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new MoneyError('mulDivRound requires integer numerator and denominator');
  }
  if (denominator === 0) {
    throw new MoneyError('mulDivRound: division by zero');
  }

  const product = a * numerator;
  if (Number.isSafeInteger(product)) {
    return minor(roundedDiv(product, denominator));
  }

  const big = (BigInt(a) * BigInt(numerator)) / 1n;
  return minor(Number(roundedDivBig(big, BigInt(denominator))));
}

function roundedDiv(numerator: number, denominator: number): number {
  const negative = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const remainder = n - q * d;
  // Half away from zero: the convention consumers expect on money.
  const rounded = remainder * 2 >= d ? q + 1 : q;
  return negative ? -rounded : rounded;
}

function roundedDivBig(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const remainder = n - q * d;
  const rounded = remainder * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/* --- allocation ---------------------------------------------------------- */

/**
 * Split an amount across weighted parts so the parts sum to *exactly* the
 * original — no cent is created or destroyed. Remainder units are handed out
 * by the largest-remainder method, then by index, so the result is fully
 * deterministic and the same input always produces the same split.
 *
 * This is what a percentage split rule uses (60/40 of €10.01 is 6.01 / 4.00,
 * never 6.00 / 4.00), and what sinking-fund amortisation uses across months.
 */
export function allocate(total: Minor, weights: readonly number[]): Minor[] {
  if (weights.length === 0) {
    throw new MoneyError('allocate requires at least one weight');
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('allocate weights must be finite and non-negative');
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) {
    throw new MoneyError('allocate weights must not sum to zero');
  }

  // Work on the magnitude so rounding is symmetric for negative totals.
  const negative = total < 0;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = magnitude - floors.reduce((s, v) => s + v, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const result = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    remainder -= 1;
  }

  return result.map((v) => minor(negative ? -v : v));
}

/** Split evenly across `parts`, distributing the remainder from the front. */
export function allocateEvenly(total: Minor, parts: number): Minor[] {
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new MoneyError(`allocateEvenly requires a positive integer, got ${parts}`);
  }
  return allocate(total, new Array<number>(parts).fill(1));
}

/* --- decimal string conversion ------------------------------------------
 * Exact, integer-only conversion between minor units and a plain decimal
 * string. Formatting goes through these rather than through `amount / 100`,
 * so no float ever touches a displayed figure.
 * ---------------------------------------------------------------------- */

/** `12345` at exponent 2 → `"123.45"`. Exact for every safe integer. */
export function toDecimalString(amount: Minor, exponent: number): string {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 8) {
    throw new MoneyError(`Unsupported minor-unit exponent: ${exponent}`);
  }
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  const whole = digits.slice(0, cut);
  const fraction = digits.slice(cut);
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * `"123.45"` at exponent 2 → `12345`. Accepts an optional sign, grouping
 * characters, and either separator. Extra fractional digits are rejected
 * rather than silently rounded — truncating a user's input without telling
 * them is how ledgers quietly lose money.
 */
export function fromDecimalString(input: string, exponent: number): Minor {
  // `\s` already covers U+00A0 and U+202F, the no-break spaces fr-FR and
  // several other locales use as group separators — so a formatted amount
  // pasted straight back in still parses.
  const cleaned = input.trim().replace(/[\s'_]/g, '');
  if (cleaned === '') throw new MoneyError('Empty amount');

  // Whichever separator appears last is the decimal point.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);

  const whole = (decimalAt >= 0 ? cleaned.slice(0, decimalAt) : cleaned).replace(/[.,]/g, '');
  const fraction = decimalAt >= 0 ? cleaned.slice(decimalAt + 1) : '';

  const negative = /^[-−]/.test(whole);
  const wholeDigits = whole.replace(/^[-+−]/, '');

  if (!/^\d*$/.test(wholeDigits) || !/^\d*$/.test(fraction)) {
    throw new MoneyError(`Not a valid amount: "${input}"`);
  }
  if (fraction.length > exponent) {
    throw new MoneyError(
      `"${input}" has ${fraction.length} decimal places but this currency has ${exponent}.`,
    );
  }

  const combined = `${wholeDigits || '0'}${fraction.padEnd(exponent, '0')}`;
  const value = Number(combined);
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Amount out of range: "${input}"`);
  }
  return minor(negative ? -value : value);
}
