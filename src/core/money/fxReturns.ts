/* ===========================================================================
 * WAS IT THE FUND, OR WAS IT THE CURRENCY?
 * ---------------------------------------------------------------------------
 * Separate from `fx.ts` for one reason: converting is needed on the first
 * paint — invariant I2 checks every line against the rate it was struck at —
 * and splitting a return is needed only on one lazily loaded sheet. Leaving
 * them together put this file, and every sentence in it, in front of everybody
 * who opens the app.
 * ======================================================================== */

import type { Minor } from './minor';
import { basisPoints, type BasisPoints } from './rate';
import { MoneyError, RATE_SCALE } from './minor';
import { rate1e6, type Rate1e6 } from './fx';

/* --- reading and writing a rate ------------------------------------------
 * Here rather than beside the conversion arithmetic because only the rates
 * sheet ever needs them, and that sheet is lazily loaded.
 * ---------------------------------------------------------------------- */

/** `1.085215` → `1_085_215`. For reading a rate somebody typed. */
export function rateFromDecimal(value: number): Rate1e6 {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MoneyError('An exchange rate has to be a positive number.');
  }
  return rate1e6(Math.round(value * RATE_SCALE));
}

/** `1_085_215` → `1.085215`, for display only. Never fed back into maths. */
export function rateToDecimal(rate: Rate1e6): number {
  return rate / RATE_SCALE;
}

/** How a rate reads on screen: `1.085215`. */
export function formatRate1e6(rate: Rate1e6): string {
  return (rate / RATE_SCALE).toFixed(6);
}

/** Round half away from zero, in BigInt, so no float ever touches a rate. */
function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  const half = denominator / 2n;
  return numerator >= 0n ? (numerator + half) / denominator : (numerator - half) / denominator;
}

/* ===========================================================================
 * WAS IT THE FUND, OR WAS IT THE CURRENCY?
 * ---------------------------------------------------------------------------
 * A foreign holding's return in the reporting currency is two things
 * multiplied together, not added:
 *
 *     1 + total  =  (1 + asset) × (1 + fx)
 *
 * which expands to  asset + fx + asset×fx.  The third term is the one nobody
 * expects and the reason the first two never quite add up to the headline: a
 * fund up 22% while the currency fell 6% loses another 1.4% to the two moving
 * at once, because the currency fall applies to the gain as well as to the
 * original stake.
 *
 * `fx` is the rate the other way up. Rates here are quote-per-base — dollars
 * per euro — so a rate that *rises* means the euro buys more dollars, which
 * means the dollar has weakened, which is a loss for a euro-based holder.
 * Hence rate0/rate1, not rate1/rate0. Getting this inverted produces a figure
 * that is plausible, symmetrical and backwards.
 * ======================================================================== */

export interface ReturnDecomposition {
  /** What the holding did in its own currency. */
  assetReturnBp: BasisPoints;
  /** What the currency did to it, from the reporting currency's point of view. */
  fxReturnBp: BasisPoints;
  /** The two compounding against each other. Small, and never zero when both moved. */
  interactionBp: BasisPoints;
  /** What it came to in the reporting currency. */
  totalBaseReturnBp: BasisPoints;
  /** True when the currency moved at all. */
  currencyMoved: boolean;
}

/** Scale for the intermediate ratios. Ten decimal places, in BigInt. */
const RATIO_SCALE = 10_000_000_000n;

/** (numerator/denominator − 1) as basis points, rounded half away from zero. */
function returnBp(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const ratio = roundedDiv(numerator * RATIO_SCALE, denominator);
  return Number(roundedDiv((ratio - RATIO_SCALE) * 10_000n, RATIO_SCALE));
}

/**
 * Split a foreign holding's return into what the asset did and what the
 * currency did.
 *
 * The interaction term is derived as the remainder rather than computed
 * directly, and that is deliberate: the three parts are shown on screen next
 * to the total, and three numbers that do not add up to the fourth read as a
 * broken app however well the rounding is explained. Computing it directly
 * agrees to within a basis point — the tests assert exactly that — so putting
 * the rounding in the smallest and least consequential of the three costs
 * nothing and buys an identity a person can check by eye.
 */
export function decomposeInvestmentReturn(input: {
  initialNativePrice: Minor;
  initialRateScaled: Rate1e6;
  currentNativePrice: Minor;
  currentRateScaled: Rate1e6;
}): ReturnDecomposition {
  const p0 = BigInt(input.initialNativePrice);
  const p1 = BigInt(input.currentNativePrice);
  const r0 = BigInt(input.initialRateScaled);
  const r1 = BigInt(input.currentRateScaled);

  if (p0 === 0n) {
    return {
      assetReturnBp: basisPoints(0),
      fxReturnBp: basisPoints(0),
      interactionBp: basisPoints(0),
      totalBaseReturnBp: basisPoints(0),
      currencyMoved: r0 !== r1,
    };
  }

  const assetBp = returnBp(p1, p0);
  // Quote-per-base: a higher rate means the foreign currency bought less, so
  // the ratio is the old rate over the new one.
  const fxBp = returnBp(r0, r1);
  // The whole thing in one step, so the total is exact rather than assembled
  // from three separately rounded parts.
  const totalBp = returnBp(p1 * r0, p0 * r1);

  return {
    assetReturnBp: basisPoints(assetBp),
    fxReturnBp: basisPoints(fxBp),
    interactionBp: basisPoints(totalBp - assetBp - fxBp),
    totalBaseReturnBp: basisPoints(totalBp),
    currencyMoved: r0 !== r1,
  };
}

/** A return as a person reads it: `+18.50%`, `−4.20%`. */
export function formatReturnBp(value: BasisPoints): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${(Math.abs(value) / 100).toFixed(2)}%`;
}

/**
 * What the split means, in words.
 *
 * The point is not the three percentages — it is that somebody can tell a good
 * fund from a lucky exchange rate, which a single headline number makes
 * impossible. Written without judgement: a currency moving is weather, not a
 * mistake anybody made.
 */
export function describeDecomposition(
  split: ReturnDecomposition,
  input: { quoteCurrency: string; baseCurrency: string },
): string {
  if (!split.currencyMoved) {
    return (
      `The ${input.quoteCurrency} has not moved against the ${input.baseCurrency} since ` +
      `you bought this, so what you see is what the holding itself did.`
    );
  }

  const assetUp = split.assetReturnBp > 0;
  const fxUp = split.fxReturnBp > 0;

  const assetPart = assetUp
    ? `gained value in ${input.quoteCurrency}`
    : split.assetReturnBp < 0
      ? `lost value in ${input.quoteCurrency}`
      : `held its value in ${input.quoteCurrency}`;

  const fxPart = fxUp
    ? `the ${input.quoteCurrency} strengthened against the ${input.baseCurrency}`
    : `the ${input.quoteCurrency} weakened against the ${input.baseCurrency}`;

  const together =
    assetUp === fxUp
      ? `Both moved the same way, so they compounded.`
      : `They pulled against each other, which is why the total sits between them.`;

  return `The holding ${assetPart}, and ${fxPart} over the time you have held it. ${together}`;
}
