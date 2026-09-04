import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MoneyError, RATE_SCALE, minor } from './index';
import {
  IDENTITY_RATE_1E6,
  convertCurrency,
  convertMinorUnits,
  rate1e6,
  toBaseCurrency,
  toQuoteCurrency,
} from './fx';
import {
  decomposeInvestmentReturn,
  describeDecomposition,
  formatRate1e6,
  formatReturnBp,
  rateFromDecimal,
} from './fxReturns';

/* ===========================================================================
 * CONVERTING, EXACTLY
 * ---------------------------------------------------------------------------
 * Rates are quote-per-base: 1.100000 on EUR/USD means one euro buys 1.10
 * dollars. Base to quote multiplies; quote to base divides.
 * ======================================================================== */

describe('converting at a rate', () => {
  const usd = rate1e6(1_100_000); // 1.10 USD per EUR

  it('turns euros into dollars by multiplying', () => {
    // €1,000.00 at 1.10 is $1,100.00.
    expect(convertCurrency(minor(100_000), usd, 'baseToQuote')).toBe(110_000);
  });

  it('turns dollars into euros by dividing', () => {
    // $5,000.00 at 1.10 is €4,545.45 — the figure the brief's own
    // verification expects on the balance sheet.
    expect(convertCurrency(minor(500_000), usd, 'quoteToBase')).toBe(454_545);
  });

  it('leaves an amount alone at a rate of one', () => {
    expect(convertCurrency(minor(123_456), IDENTITY_RATE_1E6, 'quoteToBase')).toBe(123_456);
    expect(convertCurrency(minor(123_456), IDENTITY_RATE_1E6, 'baseToQuote')).toBe(123_456);
  });

  it('rounds half away from zero, the same way as every other scaled amount', () => {
    // 1 minor unit at 2.000000 quote-to-base is exactly 0.5, which goes to 1.
    expect(convertCurrency(minor(1), rate1e6(2_000_000), 'quoteToBase')).toBe(1);
    expect(convertCurrency(minor(-1), rate1e6(2_000_000), 'quoteToBase')).toBe(-1);
  });

  it('handles a negative amount symmetrically', () => {
    expect(convertCurrency(minor(-500_000), usd, 'quoteToBase')).toBe(-454_545);
  });

  it('refuses a rate that is not a whole number at 1e6', () => {
    expect(() => rate1e6(1.5)).toThrow(MoneyError);
    expect(() => rate1e6(0)).toThrow(/greater than nothing/);
    expect(() => rateFromDecimal(-1)).toThrow(/positive number/);
  });

  it('reads a typed rate and writes it back the same', () => {
    expect(rateFromDecimal(1.085215)).toBe(1_085_215);
    expect(formatRate1e6(rate1e6(1_085_215))).toBe('1.085215');
  });
});

/* ===========================================================================
 * THE SIZE THAT BREAKS A DOUBLE
 * ---------------------------------------------------------------------------
 * A double stops counting in ones at about 9e15. A hundred billion yen at a
 * six-decimal rate produces an intermediate around 1e17, and the failure is
 * silent — the answer is simply a few units wrong, with nothing to notice.
 * ======================================================================== */

describe('converting amounts large enough to break floating point', () => {
  it('stays exact on a hundred billion yen', () => {
    // ¥100,000,000,000 — yen has no minor unit, so that is the integer itself.
    const yen = minor(100_000_000_000);
    const rate = rate1e6(160_000_000); // 160.000000 JPY per EUR

    const euros = convertMinorUnits({
      amount: yen,
      rateScaled: rate,
      direction: 'quoteToBase',
      quoteExponent: 0,
      baseExponent: 2,
    });

    // ¥100bn ÷ 160 = €625,000,000.00 = 62,500,000,000 minor units.
    expect(euros).toBe(62_500_000_000);
    expect(Number.isSafeInteger(euros)).toBe(true);

    // The naive product would have been 1e11 × 1e6 × 100 = 1e19, far past
    // where a double counts in ones. This is what BigInt is here for.
    expect(Number(BigInt(yen) * BigInt(rate))).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
  });

  it('never drifts from the exact rounded quotient, at any size', () => {
    fc.assert(
      fc.property(
        // Up to ten billion major units, at rates from a hundredth to a
        // thousand — comfortably wider than any real currency pair, and inside
        // what a JavaScript integer can hold once converted.
        fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }),
        fc.integer({ min: 10_000, max: 1_000_000_000 }),
        (amount, rateScaled) => {
          const converted = convertCurrency(minor(amount), rate1e6(rateScaled), 'quoteToBase');
          expect(Number.isSafeInteger(converted)).toBe(true);

          const n = BigInt(amount) * BigInt(RATE_SCALE);
          const d = BigInt(rateScaled);
          const half = d / 2n;
          const exact = n >= 0n ? (n + half) / d : (n - half) / d;
          expect(BigInt(converted)).toBe(exact);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('refuses a result too large to hold, rather than rounding it away', () => {
    // A trillion units at a rate near zero is genuinely bigger than a
    // JavaScript integer. Returning the nearest double would be wrong in its
    // low digits and look perfectly fine, which is the worst way to be wrong.
    expect(() =>
      convertCurrency(minor(1_000_000_000_000), rate1e6(1), 'quoteToBase'),
    ).toThrow(/too large to hold exactly/);
  });
});

/* ===========================================================================
 * CURRENCIES WHOSE MINOR UNITS ARE DIFFERENT SIZES
 * ======================================================================== */

describe('currencies that do not have two decimal places', () => {
  it('converts yen, which has none', () => {
    // ¥16,000 at 160 JPY/EUR is €100.00.
    expect(
      convertMinorUnits({
        amount: minor(16_000),
        rateScaled: rate1e6(160_000_000),
        direction: 'quoteToBase',
        quoteExponent: 0,
        baseExponent: 2,
      }),
    ).toBe(10_000);
  });

  it('converts the other way, into yen', () => {
    expect(
      convertMinorUnits({
        amount: minor(10_000),
        rateScaled: rate1e6(160_000_000),
        direction: 'baseToQuote',
        quoteExponent: 0,
        baseExponent: 2,
      }),
    ).toBe(16_000);
  });

  it('converts a dinar, which has three', () => {
    // 1.000 BHD at 0.400000 BHD per EUR is €2.50.
    expect(
      convertMinorUnits({
        amount: minor(1_000),
        rateScaled: rate1e6(400_000),
        direction: 'quoteToBase',
        quoteExponent: 3,
        baseExponent: 2,
      }),
    ).toBe(250);
  });

  it('reads the exponents off the currency codes', () => {
    expect(
      toBaseCurrency({
        amount: minor(16_000),
        rateScaled: rate1e6(160_000_000),
        quoteCurrency: 'JPY',
        baseCurrency: 'EUR',
      }),
    ).toBe(10_000);

    expect(
      toQuoteCurrency({
        amount: minor(10_000),
        rateScaled: rate1e6(160_000_000),
        quoteCurrency: 'JPY',
        baseCurrency: 'EUR',
      }),
    ).toBe(16_000);
  });

  it('does nothing at all when the two currencies are the same', () => {
    const amount = minor(123_456);
    expect(
      toBaseCurrency({
        amount,
        rateScaled: rate1e6(9_999_999),
        quoteCurrency: 'EUR',
        baseCurrency: 'EUR',
      }),
    ).toBe(amount);
  });
});

/* ===========================================================================
 * WAS IT THE FUND, OR WAS IT THE CURRENCY?
 * ======================================================================== */

describe('splitting a foreign return into the asset and the currency', () => {
  // The brief's own scenario: AAPL at $180 with the euro buying 1.05 dollars,
  // now $220 with the euro buying 1.12 — a stronger euro, a weaker dollar.
  const apple = {
    initialNativePrice: minor(18_000),
    initialRateScaled: rate1e6(1_050_000),
    currentNativePrice: minor(22_000),
    currentRateScaled: rate1e6(1_120_000),
  };

  it('separates a rising stock from a falling dollar', () => {
    const split = decomposeInvestmentReturn(apple);

    // 220/180 − 1 = +22.22%
    expect(split.assetReturnBp).toBe(2_222);
    // 1.05/1.12 − 1 = −6.25%: a euro that buys more dollars means the dollar
    // bought less, which is a loss to somebody reporting in euros.
    expect(split.fxReturnBp).toBe(-625);
    // (1.2222 × 0.9375) − 1 = +14.58%
    expect(split.totalBaseReturnBp).toBe(1_458);
    expect(split.currencyMoved).toBe(true);
  });

  it('makes the three parts add up to the headline exactly', () => {
    const split = decomposeInvestmentReturn(apple);
    expect(split.assetReturnBp + split.fxReturnBp + split.interactionBp).toBe(
      split.totalBaseReturnBp,
    );
  });

  it('agrees with the interaction term computed directly, to a basis point', () => {
    const split = decomposeInvestmentReturn(apple);
    const direct = Math.round((split.assetReturnBp * split.fxReturnBp) / 10_000);
    expect(Math.abs(split.interactionBp - direct)).toBeLessThanOrEqual(1);
  });

  it('reports no currency effect when the rate has not moved', () => {
    const split = decomposeInvestmentReturn({
      ...apple,
      currentRateScaled: apple.initialRateScaled,
    });

    expect(split.fxReturnBp).toBe(0);
    expect(split.interactionBp).toBe(0);
    expect(split.totalBaseReturnBp).toBe(split.assetReturnBp);
    expect(split.currencyMoved).toBe(false);
  });

  it('reports a currency effect even when the holding itself has not moved', () => {
    const split = decomposeInvestmentReturn({
      ...apple,
      currentNativePrice: apple.initialNativePrice,
    });

    expect(split.assetReturnBp).toBe(0);
    expect(split.fxReturnBp).toBe(-625);
    expect(split.interactionBp).toBe(0);
    expect(split.totalBaseReturnBp).toBe(-625);
  });

  it('holds the identity across fifty market scenarios', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000_000 }),
        fc.integer({ min: 100, max: 10_000_000 }),
        fc.integer({ min: 10_000, max: 100_000_000 }),
        fc.integer({ min: 10_000, max: 100_000_000 }),
        (p0, p1, r0, r1) => {
          const split = decomposeInvestmentReturn({
            initialNativePrice: minor(p0),
            currentNativePrice: minor(p1),
            initialRateScaled: rate1e6(r0),
            currentRateScaled: rate1e6(r1),
          });

          // Exact by construction: the interaction term carries the rounding,
          // so what is on screen always adds up.
          expect(split.assetReturnBp + split.fxReturnBp + split.interactionBp).toBe(
            split.totalBaseReturnBp,
          );

          // And the direction is never wrong: a rate that rose is always a
          // loss to somebody reporting in the base currency.
          if (r1 > r0) expect(split.fxReturnBp).toBeLessThanOrEqual(0);
          if (r1 < r0) expect(split.fxReturnBp).toBeGreaterThanOrEqual(0);
          if (p1 > p0) expect(split.assetReturnBp).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('says which way each part went, without calling either a mistake', () => {
    const said = describeDecomposition(decomposeInvestmentReturn(apple), {
      quoteCurrency: 'USD',
      baseCurrency: 'EUR',
    });

    expect(said).toContain('gained value in USD');
    expect(said).toContain('USD weakened against the EUR');
    expect(said).not.toMatch(/should|mistake|wrong|badly|unfortunately/i);
  });

  it('says plainly when the currency has not moved at all', () => {
    const said = describeDecomposition(
      decomposeInvestmentReturn({ ...apple, currentRateScaled: apple.initialRateScaled }),
      { quoteCurrency: 'USD', baseCurrency: 'EUR' },
    );
    expect(said).toContain('has not moved');
  });

  it('formats a return with its sign', () => {
    expect(formatReturnBp(decomposeInvestmentReturn(apple).assetReturnBp)).toBe('+22.22%');
    expect(formatReturnBp(decomposeInvestmentReturn(apple).fxReturnBp)).toBe('−6.25%');
  });
});
