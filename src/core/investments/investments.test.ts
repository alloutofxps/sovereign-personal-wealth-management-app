import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { basisPoints, minor } from '@/core/money';
import {
  ASSUMED_GROSS_RETURN_BP,
  LOW_COST_BASELINE_BP,
  allocationOf,
  compound,
  describeAllocation,
  describeFeeDrag,
  feeDragOf,
  formatQuantity,
  formatReturn,
  formatShare,
  marketValue,
  parseQuantity,
  reconcileTarget,
  totalsOf,
  valueOf,
  weightedExpenseRatio,
  type AssetClass,
  type Holding,
  type Security,
} from './index';

/* ===========================================================================
 * FIXTURES
 * ======================================================================== */

const security = (
  symbol: string,
  assetClass: AssetClass,
  expenseRatioBp: number,
): Security => ({
  id: `sec-${symbol}`,
  symbol,
  name: `${symbol} fund`,
  isin: null,
  assetClass,
  currency: 'EUR',
  expenseRatioBp: basisPoints(expenseRatioBp),
});

const holding = (
  sec: Security,
  quantity1e8: number,
  costBasis: number,
  priceMinor: number,
): Holding => ({
  id: `hold-${sec.symbol}`,
  accountId: 'acc-brokerage',
  security: sec,
  quantity1e8,
  costBasis: minor(costBasis),
  priceMinor: minor(priceMinor),
  pricedOn: '2026-09-04',
});

const SHARE = 100_000_000;

/* ===========================================================================
 * FRACTIONAL SHARES, EXACTLY
 * ---------------------------------------------------------------------------
 * The failure being guarded against is quiet: a register that stores share
 * counts as doubles adds up its own rows to something other than its own
 * total, and the person is shown a portfolio figure that does not match the
 * lines above it. Nothing errors. It is simply wrong.
 * ======================================================================== */

describe('working out what a position is worth', () => {
  it('handles a whole number of shares exactly', () => {
    // 50 shares at €118.50.
    expect(marketValue(minor(11_850), 50 * SHARE)).toBe(592_500);
  });

  it('handles a half share without a rounding artefact', () => {
    // 25.5 shares at €92.00 is €2,346.00 exactly.
    expect(marketValue(minor(9_200), 25.5 * SHARE)).toBe(234_600);
  });

  it('handles the smallest share a broker will sell', () => {
    // One hundred-millionth of a share at €118.50 rounds to nothing, and
    // should say so rather than producing a fraction of a cent.
    expect(marketValue(minor(11_850), 1)).toBe(0);
    // A thousand of them is still under half a cent.
    expect(marketValue(minor(11_850), 1_000)).toBe(0);
    // Ten thousand crosses it: 0.0001 shares × €118.50 = 1.185 cents.
    expect(marketValue(minor(11_850), 10_000)).toBe(1);
  });

  it('stays exact at a size that overflows a double', () => {
    // 100,000 shares at €118.50. The naive product is 1.185e17 — well past
    // where a double counts in ones — so this only holds because the
    // arithmetic falls back to BigInt rather than trusting the multiply.
    const value = marketValue(minor(11_850), 100_000 * SHARE);
    expect(value).toBe(1_185_000_000);
    expect(Number.isSafeInteger(value)).toBe(true);
  });

  it('never drifts across the whole range of sizes a person might hold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 * SHARE }),
        fc.integer({ min: 1, max: 10_000_00 }),
        (quantity1e8, priceMinor) => {
          const value = marketValue(minor(priceMinor), quantity1e8);

          // Whatever the size, the answer is a whole number of minor units
          // that is exactly the rounded true product.
          expect(Number.isSafeInteger(value)).toBe(true);

          const exact =
            (BigInt(priceMinor) * BigInt(quantity1e8) * 2n + BigInt(SHARE)) /
            (BigInt(SHARE) * 2n);
          expect(BigInt(value)).toBe(exact);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('what a position has made', () => {
  const vwce = security('VWCE', 'equity', 22);

  it('reports the gain and the return together', () => {
    // 50 shares that cost €5,500, now worth €5,925.
    const result = valueOf(holding(vwce, 50 * SHARE, 550_000, 11_850));
    expect(result.marketValue).toBe(592_500);
    expect(result.gainLoss).toBe(42_500);
    expect(result.returnBp).toBe(773); // +7.73%
  });

  it('reports a fall as a negative return rather than as an absence', () => {
    const result = valueOf(holding(vwce, 10 * SHARE, 120_000, 10_000));
    expect(result.gainLoss).toBe(-20_000);
    expect(result.returnBp).toBe(-1_667); // −16.67%
  });

  it('returns nothing rather than infinity when nothing was paid', () => {
    // Shares that were given to you have no meaningful percentage return.
    const result = valueOf(holding(vwce, 10 * SHARE, 0, 10_000));
    expect(result.gainLoss).toBe(100_000);
    expect(result.returnBp).toBe(0);
  });

  it('adds a portfolio up to the same figure as its rows', () => {
    const vusa = security('VUSA', 'equity', 7);
    const totals = totalsOf([
      holding(vwce, 50 * SHARE, 550_000, 11_850),
      holding(vusa, 25.5 * SHARE, 204_000, 9_200),
    ]);

    expect(totals.marketValue).toBe(592_500 + 234_600);
    expect(totals.costBasis).toBe(754_000);
    expect(totals.gainLoss).toBe(73_100);
  });
});

describe('writing a share count down', () => {
  it('writes it the way a person would', () => {
    expect(formatQuantity(10.5 * SHARE)).toBe('10.5');
    expect(formatQuantity(100 * SHARE)).toBe('100');
    expect(formatQuantity(425_120)).toBe('0.0042512');
    expect(formatQuantity(1)).toBe('0.00000001');
    expect(formatQuantity(0)).toBe('0');
  });

  it('survives a round trip through text', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 * SHARE }), (quantity) => {
        expect(parseQuantity(formatQuantity(quantity))).toBe(quantity);
      }),
      { numRuns: 200 },
    );
  });

  it('refuses more precision than it can keep, rather than truncating quietly', () => {
    expect(() => parseQuantity('1.123456789')).toThrow(/decimal places/);
  });

  it('always shows which way a return went', () => {
    expect(formatReturn(basisPoints(1_840))).toBe('+18.40%');
    expect(formatReturn(basisPoints(-320))).toBe('−3.20%');
    expect(formatReturn(basisPoints(0))).toBe('0.00%');
  });
});

/* ===========================================================================
 * THE SHARES ALWAYS ADD TO A HUNDRED
 * ---------------------------------------------------------------------------
 * Percentages that come to 99.9% are the most common way a financial screen
 * tells somebody it cannot be trusted.
 * ======================================================================== */

describe('how a portfolio is spread', () => {
  it('adds to exactly 100% across a hundred random portfolios', () => {
    const classes: AssetClass[] = [
      'equity',
      'fixed_income',
      'cash_equivalent',
      'real_estate',
      'commodity',
      'crypto',
      'other',
    ];

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            cls: fc.constantFrom(...classes),
            quantity: fc.integer({ min: 1, max: 5_000 * SHARE }),
            price: fc.integer({ min: 1, max: 500_00 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (rows) => {
          const holdings = rows.map((row, index) =>
            holding(security(`S${index}`, row.cls, 10), row.quantity, 0, row.price),
          );

          const allocation = allocationOf(holdings);
          if (allocation.total === 0) {
            expect(allocation.slices).toHaveLength(0);
            return;
          }

          const total = allocation.slices.reduce((sum, s) => sum + s.shareBp, 0);
          expect(total).toBe(10_000);

          // And the slice values still add to the portfolio, so the legend and
          // the total on the screen above it cannot disagree.
          expect(allocation.slices.reduce((sum, s) => sum + s.value, 0)).toBe(allocation.total);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('gives a single-class portfolio the whole hundred percent', () => {
    const allocation = allocationOf([
      holding(security('VWCE', 'equity', 22), 50 * SHARE, 550_000, 11_850),
      holding(security('VUSA', 'equity', 7), 25.5 * SHARE, 204_000, 9_200),
    ]);

    expect(allocation.slices).toHaveLength(1);
    expect(allocation.slices[0]!.assetClass).toBe('equity');
    expect(formatShare(allocation.slices[0]!.shareBp)).toBe('100.00%');
    expect(allocation.slices[0]!.holdings).toBe(2);
  });

  it('splits a mixed portfolio without losing a basis point', () => {
    // Three holdings whose shares do not divide evenly into 10,000.
    const allocation = allocationOf([
      holding(security('A', 'equity', 10), 1 * SHARE, 0, 10_000),
      holding(security('B', 'fixed_income', 10), 1 * SHARE, 0, 10_000),
      holding(security('C', 'crypto', 10), 1 * SHARE, 0, 10_000),
    ]);

    expect(allocation.slices.map((s) => s.shareBp).reduce((a, b) => a + b, 0)).toBe(10_000);
    // 3,334 / 3,333 / 3,333 — the extra unit goes to the first by index, so
    // the same portfolio always produces the same picture.
    expect(allocation.slices.map((s) => s.shareBp)).toEqual([3_334, 3_333, 3_333]);
  });

  it('describes a one-sided portfolio without telling anybody off', () => {
    const said = describeAllocation(
      allocationOf([holding(security('VWCE', 'equity', 22), 50 * SHARE, 550_000, 11_850)]),
    );
    expect(said).toContain('a choice rather than a problem');
    expect(said).not.toMatch(/should|must|risky|dangerous|too much/i);
  });

  it('says plainly when there is nothing to show yet', () => {
    expect(allocationOf([]).slices).toHaveLength(0);
    expect(describeAllocation(allocationOf([]))).toContain('Nothing recorded yet');
  });
});

/* ===========================================================================
 * WHAT THE FUNDS CHARGE
 * ======================================================================== */

describe('the weighted charge across a portfolio', () => {
  const vwce = security('VWCE', 'equity', 22);
  const vusa = security('VUSA', 'equity', 7);

  const portfolio = [
    holding(vwce, 50 * SHARE, 550_000, 11_850), // €5,925 at 0.22%
    holding(vusa, 25.5 * SHARE, 204_000, 9_200), // €2,346 at 0.07%
  ];

  it('weights by how much is held, not by how many funds there are', () => {
    // (592,500 × 22 + 234,600 × 7) ÷ 827,100 = 17.74 bp.
    expect(weightedExpenseRatio(portfolio)).toBe(18);
  });

  it('does not let one small expensive holding dominate the figure', () => {
    const expensive = security('ACTIVE', 'equity', 150);
    const mostlyCheap = [
      holding(vusa, 1_000 * SHARE, 0, 9_200), // €92,000 at 0.07%
      holding(expensive, 10 * SHARE, 0, 10_000), // €1,000 at 1.50%
    ];

    // A plain average of the two rates would say 0.785%. The truth is 0.085%.
    expect(weightedExpenseRatio(mostlyCheap)).toBe(9);
  });

  it('reports nothing when there is nothing held', () => {
    expect(weightedExpenseRatio([])).toBe(0);
  });

  it('states the yearly cost at today’s size', () => {
    const drag = feeDragOf(portfolio);
    expect(drag.portfolioValue).toBe(827_100);
    expect(drag.weightedBp).toBe(18);
    // 0.18% of €8,271.00.
    expect(drag.annualCost).toBe(1_489);
    expect(drag.costliest?.symbol).toBe('VWCE');
  });
});

describe('what charges compound to', () => {
  it('grows an amount the same way every time', () => {
    // €10,000 at 7% for one year, then two.
    expect(compound(minor(1_000_000), ASSUMED_GROSS_RETURN_BP, 1)).toBe(1_070_000);
    expect(compound(minor(1_000_000), ASSUMED_GROSS_RETURN_BP, 2)).toBe(1_144_900);
    expect(compound(minor(1_000_000), ASSUMED_GROSS_RETURN_BP, 0)).toBe(1_000_000);
  });

  it('shows a costlier fund ending up behind a cheap one', () => {
    const expensive = [holding(security('ACTIVE', 'equity', 150), 100 * SHARE, 0, 100_00)];
    const drag = feeDragOf(expensive);
    const twenty = drag.projections.find((p) => p.years === 20)!;

    expect(drag.weightedBp).toBe(150);
    expect(twenty.withBaselineFees).toBeGreaterThan(twenty.withYourFees);
    expect(twenty.versusBaseline).toBe(twenty.withBaselineFees - twenty.withYourFees);
    // And all charges together cost more than the difference against a cheap
    // fund does, because the cheap fund still charges something.
    expect(twenty.feesAbsorbed).toBeGreaterThan(twenty.versusBaseline);
  });

  it('costs a portfolio already at the baseline almost nothing extra', () => {
    const cheap = [
      holding(security('CHEAP', 'equity', LOW_COST_BASELINE_BP), 100 * SHARE, 0, 100_00),
    ];
    const twenty = feeDragOf(cheap).projections.find((p) => p.years === 20)!;
    expect(twenty.versusBaseline).toBe(0);
  });

  it('covers ten, twenty and thirty years, growing each time', () => {
    const drag = feeDragOf([holding(security('X', 'equity', 100), 100 * SHARE, 0, 100_00)]);
    expect(drag.projections.map((p) => p.years)).toEqual([10, 20, 30]);

    const gaps = drag.projections.map((p) => p.versusBaseline);
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!);
    expect(gaps[2]!).toBeGreaterThan(gaps[1]!);
  });

  it('says what it costs without saying what to do about it', () => {
    const drag = feeDragOf([holding(security('X', 'equity', 100), 100 * SHARE, 0, 100_00)]);
    const said = describeFeeDrag(drag, (a) => `€${(a / 100).toFixed(2)}`);

    expect(said).toContain('a year');
    expect(said).toContain('20 years');
    // Never an instruction. This app does not know anybody's plans.
    expect(said).not.toMatch(/you should|switch to|move your money|we recommend/i);
  });

  it('asks for the charge rather than assuming it is nothing', () => {
    const unknown = [holding(security('X', 'equity', 0), 100 * SHARE, 0, 100_00)];
    const said = describeFeeDrag(feeDragOf(unknown), (a) => `€${(a / 100).toFixed(2)}`);
    expect(said).toContain('If you know the yearly fee');
  });
});

/* ===========================================================================
 * KEEPING THE REGISTER AND THE BALANCE SHEET EQUAL
 * ---------------------------------------------------------------------------
 * The failure this prevents is money disappearing. Transfer €500 to a broker
 * on Monday, buy on Friday, and in between the account is worth €500 more than
 * its holdings — a reconciliation that reset the balance to the register's
 * total would delete that €500 on a screen nobody was looking at.
 * ======================================================================== */

describe('reconciling an account against what it holds', () => {
  it('sets a fresh account to what its holdings add up to', () => {
    const result = reconcileTarget({
      registerValue: minor(827_100),
      ledgerValue: minor(0),
      lastRegisterValue: null,
    });

    expect(result.target).toBe(827_100);
    expect(result.delta).toBe(827_100);
    expect(result.uninvestedCash).toBe(0);
  });

  it('does nothing when the two already agree', () => {
    const result = reconcileTarget({
      registerValue: minor(827_100),
      ledgerValue: minor(827_100),
      lastRegisterValue: minor(827_100),
    });
    expect(result.delta).toBe(0);
  });

  it('carries uninvested cash through a price change untouched', () => {
    // €500 transferred in and not yet invested, then VWCE rises by €325.
    const result = reconcileTarget({
      registerValue: minor(859_600),
      ledgerValue: minor(877_100),
      lastRegisterValue: minor(827_100),
    });

    expect(result.uninvestedCash).toBe(50_000);
    // The account moves by the register's change, not to the register's total.
    expect(result.delta).toBe(32_500);
    expect(result.target).toBe(909_600);
    // And the cash is still there afterwards.
    expect(result.target - 859_600).toBe(50_000);
  });

  it('never adds an account’s holdings to itself twice', () => {
    // The case with no mark on record: an account already holding €8,271 of
    // shares. Assuming the whole balance was uninvested cash would make it
    // €16,542 — the bug this guards against.
    const result = reconcileTarget({
      registerValue: minor(827_100),
      ledgerValue: minor(827_100),
      lastRegisterValue: null,
    });

    expect(result.target).toBe(827_100);
    expect(result.delta).toBe(0);
  });

  it('does not invent negative cash when the balance has fallen behind', () => {
    const result = reconcileTarget({
      registerValue: minor(100_000),
      ledgerValue: minor(90_000),
      lastRegisterValue: minor(120_000),
    });

    // The residual is negative, so it is ignored rather than subtracted again.
    expect(result.uninvestedCash).toBe(-30_000);
    expect(result.target).toBe(100_000);
  });
});
