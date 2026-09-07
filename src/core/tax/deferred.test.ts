import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import {
  DUTCH_BOX3_2025,
  IRISH_CGT_2025,
  deferredTax,
  describeDeferredTax,
  effectiveRateBp,
  netWorthAfterTax,
  type DeemedReturnRegime,
  type FlatGainsRegime,
  type TaxableEstate,
} from './deferred';

const m = (major: number): Minor => minor(Math.round(major * 100));
/* Symbol-free: real formatting is the money module's job, and the currency
 * guard rightly objects to a literal symbol anywhere outside it. */
const fmt = (a: Minor) => (a / 100).toFixed(2);

const estate = (over: Partial<TaxableEstate> = {}): TaxableEstate => ({
  savings: m(0),
  investments: m(0),
  investmentCostBasis: m(0),
  debts: m(0),
  ...over,
});

/* ===========================================================================
 * A GAIN TAXED WHEN IT IS TAKEN
 * ======================================================================== */

describe('tax waiting inside a gain', () => {
  const regime: FlatGainsRegime = { ...IRISH_CGT_2025, annualExemption: m(1_270) };

  it('takes the rate off the gain, after the allowance', () => {
    // 90,000 held, 60,000 paid. Gain 30,000, less 1,270 allowance, at 33%.
    const result = deferredTax(
      estate({ investments: m(90_000), investmentCostBasis: m(60_000) }),
      regime,
    );
    expect(result.grossAmount).toBe(m(30_000));
    expect(result.reliefApplied).toBe(m(1_270));
    expect(result.taxableAmount).toBe(m(28_730));
    expect(result.amount).toBe(m(9_480.9));
  });

  it('says the bill falls due on a sale, not this year', () => {
    expect(deferredTax(estate({ investments: m(1), investmentCostBasis: m(0) }), regime).timing).toBe(
      'on_sale',
    );
  });

  it('leaves a gain inside the allowance untaxed', () => {
    const result = deferredTax(
      estate({ investments: m(61_000), investmentCostBasis: m(60_000) }),
      regime,
    );
    expect(result.grossAmount).toBe(m(1_000));
    expect(result.amount).toBe(m(0));
  });

  it('never turns a loss into a refund', () => {
    // A loss may be worth something against a future gain, but that depends on
    // rules this does not model, and a negative liability reads as money owed
    // to the person.
    const result = deferredTax(
      estate({ investments: m(40_000), investmentCostBasis: m(60_000) }),
      regime,
    );
    expect(result.grossAmount).toBe(m(0));
    expect(result.amount).toBe(m(0));
  });

  it('takes the bill off net worth, because it is not all yours', () => {
    const result = deferredTax(
      estate({ investments: m(90_000), investmentCostBasis: m(60_000) }),
      regime,
    );
    expect(netWorthAfterTax(m(250_000), result)).toBe(m(250_000 - 9_480.9));
  });

  it('reports the share of the gain that would go in tax', () => {
    const result = deferredTax(
      estate({ investments: m(90_000), investmentCostBasis: m(60_000) }),
      regime,
    );
    // Slightly under the headline 33%, because of the allowance.
    expect(effectiveRateBp(result)).toBe(3_160);
  });

  it('has no rate to report when there is no gain', () => {
    // Zero per cent of nothing invites a reassuring conclusion about a figure
    // that does not exist.
    expect(effectiveRateBp(deferredTax(estate(), regime))).toBeNull();
  });
});

/* ===========================================================================
 * A DEEMED RETURN, TAXED EVERY YEAR
 * ======================================================================== */

describe('a charge on what you hold, gain or no gain', () => {
  const regime: DeemedReturnRegime = DUTCH_BOX3_2025;

  it('charges nothing below the tax-free amount', () => {
    const result = deferredTax(estate({ savings: m(20_000) }), regime);
    expect(result.amount).toBe(m(0));
    expect(result.timing).toBe('every_year');
  });

  it('charges on the part above it, at the blended deemed rate', () => {
    // 100,000 in savings. Deemed return 1.44% = 1,440. Net assets 100,000,
    // taxable base 100,000 − 57,684 = 42,316. Income = 1,440 × 42,316/100,000
    // = 609.35. Tax at 36% = 219.37.
    const result = deferredTax(estate({ savings: m(100_000) }), regime);
    expect(result.grossAmount).toBe(m(1_440));
    expect(result.taxableAmount).toBe(m(609.35));
    expect(result.amount).toBe(m(219.37));
  });

  it('assumes a much higher return on investments than on savings', () => {
    const saved = deferredTax(estate({ savings: m(200_000) }), regime);
    const invested = deferredTax(estate({ investments: m(200_000) }), regime);
    expect(invested.amount).toBeGreaterThan(saved.amount * 3);
  });

  it('charges the same whether the investments went up or down', () => {
    // The whole point of a deemed return. Cost basis is not read at all.
    const up = deferredTax(
      estate({ investments: m(200_000), investmentCostBasis: m(100_000) }),
      regime,
    );
    const down = deferredTax(
      estate({ investments: m(200_000), investmentCostBasis: m(400_000) }),
      regime,
    );
    expect(up.amount).toBe(down.amount);
  });

  it('deducts debts above the threshold, and ignores small ones', () => {
    const withSmallDebt = deferredTax(
      estate({ investments: m(200_000), debts: m(3_000) }),
      regime,
    );
    const withNoDebt = deferredTax(estate({ investments: m(200_000) }), regime);
    const withRealDebt = deferredTax(
      estate({ investments: m(200_000), debts: m(50_000) }),
      regime,
    );

    expect(withSmallDebt.amount).toBe(withNoDebt.amount);
    expect(withRealDebt.amount).toBeLessThan(withNoDebt.amount);
  });

  it('never charges on more than was held', () => {
    // Debts larger than assets leave nothing to tax, not a negative charge.
    const result = deferredTax(estate({ savings: m(10_000), debts: m(90_000) }), regime);
    expect(result.amount).toBe(m(0));
  });

  it('says it is an annual charge, not something waiting for a sale', () => {
    expect(deferredTax(estate({ investments: m(300_000) }), regime).timing).toBe('every_year');
  });

  it('has no net-worth adjustment to offer, and says so with null', () => {
    // Subtracting a yearly cost of holding from net worth once would be
    // neither this year's bill nor a liability.
    const result = deferredTax(estate({ investments: m(300_000) }), regime);
    expect(netWorthAfterTax(m(500_000), result)).toBeNull();
  });
});

/* ===========================================================================
 * WHAT IT SAYS
 * ======================================================================== */

describe('the sentences', () => {
  it('names the year the rate came from, every time', () => {
    const gains = describeDeferredTax(
      deferredTax(estate({ investments: m(90_000), investmentCostBasis: m(60_000) }), IRISH_CGT_2025),
      fmt,
    );
    const deemed = describeDeferredTax(
      deferredTax(estate({ investments: m(300_000) }), DUTCH_BOX3_2025),
      fmt,
    );
    expect(gains).toContain('2025');
    expect(deemed).toContain('2025');
  });

  it('does not call an annual charge something waiting for a sale', () => {
    const said = describeDeferredTax(
      deferredTax(estate({ investments: m(300_000) }), DUTCH_BOX3_2025),
      fmt,
    );
    expect(said).toMatch(/a year/);
    expect(said).not.toMatch(/if you sell|waiting inside|falls due/);
  });

  it('does not tell anybody what to do about it', () => {
    const sentences = [
      describeDeferredTax(deferredTax(estate({ investments: m(90_000), investmentCostBasis: m(60_000) }), IRISH_CGT_2025), fmt),
      describeDeferredTax(deferredTax(estate({ savings: m(20_000) }), DUTCH_BOX3_2025), fmt),
      describeDeferredTax(deferredTax(estate({ investments: m(300_000) }), DUTCH_BOX3_2025), fmt),
      describeDeferredTax(deferredTax(estate(), IRISH_CGT_2025), fmt),
    ];
    for (const said of sentences) {
      expect(said).not.toMatch(/you should|consider selling|it would be wise|advice|recommend/i);
    }
  });

  it('admits what it does not know', () => {
    const said = describeDeferredTax(
      deferredTax(estate({ investments: m(90_000), investmentCostBasis: m(60_000) }), IRISH_CGT_2025),
      fmt,
    );
    expect(said).toMatch(/does not know your circumstances/);
  });
});

/* ===========================================================================
 * PROPERTIES
 * ======================================================================== */

describe('properties', () => {
  it('never reports a negative bill, whatever it is given', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        (savings, investments, cost, debts) => {
          for (const regime of [IRISH_CGT_2025, DUTCH_BOX3_2025]) {
            const result = deferredTax(
              {
                savings: minor(savings),
                investments: minor(investments),
                investmentCostBasis: minor(cost),
                debts: minor(debts),
              },
              regime,
            );
            expect(result.amount).toBeGreaterThanOrEqual(0);
            expect(result.taxableAmount).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(result.amount)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never charges more than the gain itself', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20_000_000 }),
        fc.integer({ min: 0, max: 20_000_000 }),
        (investments, cost) => {
          const result = deferredTax(
            {
              savings: minor(0),
              investments: minor(investments),
              investmentCostBasis: minor(cost),
              debts: minor(0),
            },
            IRISH_CGT_2025,
          );
          expect(result.amount).toBeLessThanOrEqual(result.grossAmount);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holding more is never taxed less', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        (held, more) => {
          const less = deferredTax(
            { savings: minor(held), investments: minor(0), investmentCostBasis: minor(0), debts: minor(0) },
            DUTCH_BOX3_2025,
          );
          const extra = deferredTax(
            { savings: minor(held + more), investments: minor(0), investmentCostBasis: minor(0), debts: minor(0) },
            DUTCH_BOX3_2025,
          );
          expect(extra.amount).toBeGreaterThanOrEqual(less.amount);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never charges an annual regime on the gain, or a gains regime on the holding', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (investments, cost) => {
          const deemed = deferredTax(
            { savings: minor(0), investments: minor(investments), investmentCostBasis: minor(cost), debts: minor(0) },
            DUTCH_BOX3_2025,
          );
          const gains = deferredTax(
            { savings: minor(investments), investments: minor(0), investmentCostBasis: minor(0), debts: minor(0) },
            IRISH_CGT_2025,
          );
          // A deemed regime ignores cost entirely; a gains regime ignores cash.
          expect(deemed.timing).toBe('every_year');
          expect(gains.amount).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
