/* ===========================================================================
 * MONEY IN MORE THAN ONE CURRENCY
 * ---------------------------------------------------------------------------
 * Two problems live here, and only one of them is arithmetic.
 *
 * The arithmetic one: converting ¥100,000,000,000 at a rate with six decimal
 * places is a multiplication whose intermediate product is around 1e17, well
 * past where a double stops counting in ones. Every conversion therefore goes
 * through BigInt, rounds exactly once, and rounds half away from zero — the
 * same convention `mulDivRound` already uses on every other scaled amount in
 * this app, so a converted figure and a prorated one round the same way.
 *
 * The harder one: when a foreign holding goes up, a person wants to know
 * whether they made money or whether their currency simply moved. Those are
 * different facts with different meanings, and a single percentage hides which
 * happened. A US fund up 22% in dollars, held by somebody reporting in euros
 * while the dollar weakened 6%, is up about 14.6% — and being shown only the
 * 14.6% leaves them unable to tell a good fund from a lucky exchange rate.
 *
 * Rates are quote-per-base throughout, at 1e6. On the EUR/USD row, 1_085_215
 * means one euro buys 1.085215 dollars. Base → quote multiplies; quote → base
 * divides. Getting that backwards is the single easiest mistake to make here,
 * so the direction is named at every call site rather than inferred.
 * ======================================================================== */

import { minorUnitExponent, type CurrencyCode } from './currency';
import { RATE_SCALE, minor, MoneyError, type Minor } from './minor';

declare const rateBrand: unique symbol;

/**
 * An exchange rate as an integer at 1e6 — six decimal places.
 *
 * Six because that is what rate publishers quote to, and because at six
 * places the error on converting a million euros is under a cent. Storing a
 * rate as a float would put the one number every converted figure depends on
 * outside the integer discipline the rest of this ledger keeps.
 */
export type Rate1e6 = number & { readonly [rateBrand]: 'Rate1e6' };

/** A currency against itself, typed as a rate. */
export const IDENTITY_RATE_1E6 = RATE_SCALE as Rate1e6;

/** Construct a rate from an integer at 1e6. Throws on anything else. */
export function rate1e6(value: number): Rate1e6 {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(
      `An exchange rate must be a whole number at 1e6, received ${value}. ` +
        `A fractional value here means a float leaked into a conversion.`,
    );
  }
  if (value <= 0) {
    throw new MoneyError('An exchange rate has to be greater than nothing.');
  }
  return value as Rate1e6;
}

/* ===========================================================================
 * CONVERTING
 * ======================================================================== */

/** Round half away from zero, in BigInt, so no float ever touches a rate. */
function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  const half = denominator / 2n;
  return numerator >= 0n ? (numerator + half) / denominator : (numerator - half) / denominator;
}

// A literal rather than `BigInt(Number.MAX_SAFE_INTEGER)`. A call at module
// scope is a side effect a bundler cannot prove is pure, so it has to keep the
// whole module — which put every conversion routine on the first paint for
// nothing. 2^53 − 1, written out.
const SAFE = 9_007_199_254_740_991n;

/**
 * Bring an exact BigInt result back to a Minor, refusing rather than rounding.
 *
 * The arithmetic above is exact at any size, but the answer still has to fit
 * in a JavaScript integer to be a `Minor` at all. Converting a trillion units
 * at a rate near zero genuinely produces a number too large to hold, and the
 * only honest response is to say so — silently returning the nearest double
 * would hand back a figure that is wrong in its low digits and looks fine.
 */
function toMinorExactly(value: bigint, context: string): Minor {
  if (value > SAFE || value < -SAFE) {
    throw new MoneyError(
      `${context} comes to an amount too large to hold exactly. ` +
        `Check the exchange rate — a rate entered the wrong way up is the usual cause.`,
    );
  }
  return minor(Number(value));
}

export type ConversionDirection = 'baseToQuote' | 'quoteToBase';

/**
 * Convert an amount at a rate, both currencies having the same minor-unit
 * exponent.
 *
 * `baseToQuote` multiplies: one euro buys `rate` dollars, so euros × rate is
 * dollars. `quoteToBase` divides, which is the direction almost everything in
 * this app needs — a dollar balance being reported in euros.
 *
 * BigInt throughout. A hundred billion yen at any plausible rate produces an
 * intermediate around 1e17, and a double stops counting in ones at about 9e15;
 * the failure is silent and the figure is simply wrong by a few units.
 */
export function convertCurrency(
  amount: Minor,
  rateScaled: Rate1e6,
  direction: ConversionDirection,
): Minor {
  const a = BigInt(amount);
  const r = BigInt(rateScaled);
  const scale = BigInt(RATE_SCALE);

  const result =
    direction === 'baseToQuote' ? roundedDiv(a * r, scale) : roundedDiv(a * scale, r);

  return toMinorExactly(result, 'That conversion');
}

/**
 * Convert between currencies whose minor units are different sizes.
 *
 * A yen has no minor unit at all and a dinar has three, so ¥100,000 is 100,000
 * minor units where €1,000.00 is also 100,000 — the same integer meaning a
 * hundredfold different amount of money. Converting without accounting for
 * that is off by a factor of 100, which is the kind of error that looks
 * plausible on screen and is not.
 *
 * The exponent shift is folded into the same division as the rate, so the
 * result is rounded once rather than twice.
 */
export function convertMinorUnits(input: {
  amount: Minor;
  rateScaled: Rate1e6;
  direction: ConversionDirection;
  /** Minor-unit exponent of the foreign currency. Defaults to 2. */
  quoteExponent?: number;
  /** Minor-unit exponent of the reporting currency. Defaults to 2. */
  baseExponent?: number;
}): Minor {
  const quoteExp = input.quoteExponent ?? 2;
  const baseExp = input.baseExponent ?? 2;

  const a = BigInt(input.amount);
  const r = BigInt(input.rateScaled);
  const scale = BigInt(RATE_SCALE);

  // Whichever side needs scaling up gets a power of ten; the other side gets
  // nothing. Never both, so the numbers stay as small as they can be.
  const up = (n: number) => 10n ** BigInt(Math.max(0, n));

  const [numerator, denominator] =
    input.direction === 'baseToQuote'
      ? [a * r * up(quoteExp - baseExp), scale * up(baseExp - quoteExp)]
      : [a * scale * up(baseExp - quoteExp), r * up(quoteExp - baseExp)];

  return toMinorExactly(roundedDiv(numerator, denominator), 'That conversion');
}

/** Convert a foreign amount into the reporting currency, exponents and all. */
export function toBaseCurrency(input: {
  amount: Minor;
  rateScaled: Rate1e6;
  quoteCurrency: CurrencyCode;
  baseCurrency: CurrencyCode;
}): Minor {
  if (input.quoteCurrency === input.baseCurrency) return input.amount;
  return convertMinorUnits({
    amount: input.amount,
    rateScaled: input.rateScaled,
    direction: 'quoteToBase',
    quoteExponent: minorUnitExponent(input.quoteCurrency),
    baseExponent: minorUnitExponent(input.baseCurrency),
  });
}

/** The other way: what a base amount is worth in the foreign currency. */
export function toQuoteCurrency(input: {
  amount: Minor;
  rateScaled: Rate1e6;
  quoteCurrency: CurrencyCode;
  baseCurrency: CurrencyCode;
}): Minor {
  if (input.quoteCurrency === input.baseCurrency) return input.amount;
  return convertMinorUnits({
    amount: input.amount,
    rateScaled: input.rateScaled,
    direction: 'baseToQuote',
    quoteExponent: minorUnitExponent(input.quoteCurrency),
    baseExponent: minorUnitExponent(input.baseCurrency),
  });
}
