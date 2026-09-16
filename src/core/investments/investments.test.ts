import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { type Minor, basisPoints, minor } from '@/core/money';
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
  QUANTITY_SCALE,
  describeHoldingEntry,
  describePortfolioSetup,
  HOLDABLE_ASSET_CLASSES,
  ASSET_CLASS_ORDER,
  ASSET_CLASS_NAMES,
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

  /*
   * The regression this exists for.
   *
   * `versusBaseline` is what the comparison fund would have kept less what
   * yours will, so it goes negative for anybody holding funds cheaper than the
   * 0.15% baseline - which is most people holding ordinary trackers, and was
   * the seeded household. The sentence printed the signed figure after the
   * word "less", so a cheap portfolio was told its charges added up to
   * "-EUR174.44 less than" a tracker: a double negative that reads as bad news
   * to somebody who is doing well.
   */
  it('says "more" when the funds are cheaper than the comparison', () => {
    const cheap = feeDragOf([
      holding(security('X', 'equity', LOW_COST_BASELINE_BP - 5), 100 * SHARE, 0, 100_00),
    ]);
    const said = describeFeeDrag(cheap, (a) => `\u20ac${(a / 100).toFixed(2)}`);

    expect(cheap.projections[1]!.versusBaseline).toBeLessThan(0);
    expect(said).toContain('more than the same money');
    expect(said).not.toContain('less than');
    // Never a negative amount inside a sentence that already carries the sign
    // in a word.
    expect(said).not.toMatch(/\u2212|-\u20ac/);
  });

  it('says "less" when the funds are dearer than the comparison', () => {
    const dear = feeDragOf([
      holding(security('X', 'equity', LOW_COST_BASELINE_BP + 50), 100 * SHARE, 0, 100_00),
    ]);
    const said = describeFeeDrag(dear, (a) => `\u20ac${(a / 100).toFixed(2)}`);

    expect(dear.projections[1]!.versusBaseline).toBeGreaterThan(0);
    expect(said).toContain('less than the same money');
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

  /*
   * The phantom crash.
   *
   * Walked from a wiped database: an account given EUR 3,458 by hand, then one
   * holding worth EUR 1,777.50 typed in. The balance was reset to the
   * register's incomplete total and the difference written off — dated today,
   * so the screen read "down EUR 1,681 this month" and the net-worth history
   * kept it. One correct action, a permanent invented loss.
   *
   * There is no safe guess here. The gap is either cash in the account or a
   * holding not typed in yet, and the two want opposite treatment. So the
   * engine refuses, and says it is refusing.
   *
   * VERIFIED by breaking it: restoring `uninvested = 0` for the null case
   * fails all four expectations below.
   */
  it('refuses to guess the first time, rather than writing off the difference', () => {
    const result = reconcileTarget({
      registerValue: minor(177_750),
      ledgerValue: minor(345_800),
      lastRegisterValue: null,
    });

    expect(result.needsReconciling, 'the difference is unexplained').toBe(true);
    expect(result.delta, 'nothing may be written').toBe(0);
    expect(result.target, 'the figure the person gave stands').toBe(345_800);
    expect(result.uninvestedCash, 'the residual is reported for somebody to confirm').toBe(168_050);
  });

  it('reports a register that has outrun the balance rather than clamping it', () => {
    // Prices rose past the hand-typed figure. Still not the engine's call.
    const result = reconcileTarget({
      registerValue: minor(357_800),
      ledgerValue: minor(345_800),
      lastRegisterValue: null,
    });

    expect(result.needsReconciling).toBe(true);
    expect(result.delta).toBe(0);
    expect(result.uninvestedCash, 'signed, so a caller can tell which way').toBe(-12_000);
  });

  it('moves the account when the cash is stated rather than guessed', () => {
    // What the flow does at the end: register plus the cash somebody typed.
    const result = reconcileTarget({
      registerValue: minor(301_750),
      ledgerValue: minor(345_800),
      lastRegisterValue: null,
      statedCash: minor(44_050),
    });

    expect(result.needsReconciling).toBe(false);
    expect(result.target).toBe(345_800);
    expect(result.delta, 'the figure they gave was right all along').toBe(0);
    expect(result.uninvestedCash).toBe(44_050);
  });

  it('keeps stated cash through the next price move', () => {
    // Reconciled above at register 301_750 with 44_050 cash. VWCE then rises.
    const result = reconcileTarget({
      registerValue: minor(311_750),
      ledgerValue: minor(345_800),
      lastRegisterValue: minor(301_750),
    });

    expect(result.uninvestedCash, 'the cash survives').toBe(44_050);
    expect(result.delta, 'only the holdings moved').toBe(10_000);
    expect(result.target).toBe(355_800);
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

/* ===========================================================================
 * THE SENTENCE ABOVE THE BUTTON
 * ---------------------------------------------------------------------------
 * It read "This will **add** 15 shares of VWCE valued at EUR 1,777.50 to your
 * Trading 212." Every figure was right and the verb was wrong: recording what
 * an account holds re-states what the account is worth, and the first time it
 * happens the figure somebody typed is replaced outright. Somebody reading
 * "add" against a EUR 3,458 account expects EUR 5,235.50 and gets EUR
 * 1,777.50.
 *
 * `describeFeeDrag` again, so the same rule applies: the wording turns on a
 * plural, on whether a cost was given, and on a sign, and each branch is
 * written to fail against the old sentence.
 * ======================================================================== */

describe('what recording a holding says it will do', () => {
  const euros = (amount: Minor) => `€${(amount / 100).toFixed(2)}`;
  const base = {
    quantity1e8: 15 * QUANTITY_SCALE,
    symbol: 'vwce',
    marketValue: minor(177_750),
    costBasis: minor(170_000),
    accountName: 'Trading 212',
    replacesTypedValue: false,
  };

  it('says the typed figure is replaced, on the first holding in an account', () => {
    const said = describeHoldingEntry({ ...base, replacesTypedValue: true }, euros);

    expect(said).toContain('Trading 212 is worth €1777.50');
    expect(said).toContain('replacing the figure you typed');
    // The word that made the old sentence wrong.
    expect(said, 'the account is not gaining €1,777.50').not.toMatch(/\badd\b/i);
  });

  it('says it records, not adds, once the account already holds something', () => {
    const said = describeHoldingEntry(base, euros);

    expect(said).toContain('This records 15 shares of VWCE');
    expect(said).toContain('in Trading 212');
    expect(said).not.toMatch(/\badd\b/i);
    expect(said, 'and it is not replacing anything now').not.toContain('replacing');
  });

  it('upper-cases the symbol whatever was typed', () => {
    expect(describeHoldingEntry(base, euros)).toContain('VWCE');
  });

  it('says share rather than shares when there is one', () => {
    const said = describeHoldingEntry({ ...base, quantity1e8: QUANTITY_SCALE }, euros);
    expect(said).toContain('1 share of VWCE');
    expect(said).not.toContain('1 shares');
  });

  it('names the direction the holding has moved', () => {
    expect(describeHoldingEntry(base, euros)).toContain('up €77.50');
    expect(
      describeHoldingEntry({ ...base, costBasis: minor(200_000) }, euros),
    ).toContain('down €222.50');
  });

  it('says nothing about a gain when no cost was given', () => {
    const said = describeHoldingEntry({ ...base, costBasis: minor(0) }, euros);
    expect(said).not.toContain('cost');
    expect(said).not.toMatch(/\bup\b|\bdown\b/);
  });
});

/* ===========================================================================
 * SETTING UP A PORTFOLIO, PER BRANCH
 * ---------------------------------------------------------------------------
 * The footer of the composition screen. It turns on four things — whether
 * anything is in the list, whether there is cash, whether the account already
 * carried a figure somebody typed, and whether the total now agrees with it —
 * so there is a test per branch, per CLAUDE.md.
 *
 * The branch that earns the rest is the disagreeing one. An account being set
 * up after the fact has a figure on it already, and somebody has to be told
 * before they press Done whether this leaves it alone or moves it. Finding
 * out afterwards is the whole defect the flow exists to remove.
 * ======================================================================== */

describe('what setting up a portfolio says it will do', () => {
  const euros = (amount: Minor) => `€${(amount / 100).toFixed(2)}`;
  const base = {
    accountName: 'Trading 212',
    holdingCount: 2,
    holdingsValue: minor(301_750),
    cash: minor(44_050),
    total: minor(345_800),
    typedValue: minor(345_800),
  };

  it('asks for the holdings when nothing is in the list and no figure exists', () => {
    const said = describePortfolioSetup(
      { ...base, holdingCount: 0, holdingsValue: minor(0), cash: minor(0), total: minor(0), typedValue: null },
      euros,
    );
    expect(said).toContain('Add what you hold');
  });

  it('says the existing figure stands while the list is empty', () => {
    const said = describePortfolioSetup(
      { ...base, holdingCount: 0, holdingsValue: minor(0), cash: minor(0), total: minor(0) },
      euros,
    );
    expect(said).toContain('Trading 212 stays at €3458.00');
  });

  it('names the total, the holdings and the cash', () => {
    const said = describePortfolioSetup(base, euros);
    expect(said).toContain('Trading 212 will be worth €3458.00');
    expect(said).toContain('€3017.50 in 2 holdings');
    expect(said).toContain('€440.50 in cash');
  });

  it('says nothing else changes when the total matches what was recorded', () => {
    const said = describePortfolioSetup(base, euros);
    expect(said).toContain('matches the €3458.00 already recorded');
    expect(said).toContain('nothing else changes');
  });

  it('warns when the total is short, because something is probably missing', () => {
    const said = describePortfolioSetup({ ...base, cash: minor(0), total: minor(301_750) }, euros);
    expect(said).toContain('€440.50 less than the €3458.00 recorded');
    expect(said).toContain('If something is missing, add it before finishing');
  });

  it('says the account goes up when the holdings have outrun the old figure', () => {
    const said = describePortfolioSetup(
      { ...base, holdingsValue: minor(357_800), cash: minor(0), total: minor(357_800) },
      euros,
    );
    expect(said).toContain('€120.00 more than the €3458.00 recorded');
    expect(said).toContain('the account goes up by that much');
  });

  it('singularises one holding', () => {
    const said = describePortfolioSetup({ ...base, holdingCount: 1 }, euros);
    expect(said).toContain('in 1 holding');
    expect(said).not.toContain('1 holdings');
  });

  it('leaves cash out of the sentence when there is none', () => {
    const said = describePortfolioSetup(
      { ...base, cash: minor(0), total: minor(301_750), typedValue: null },
      euros,
    );
    expect(said).not.toContain('cash');
  });

  it('describes a brand-new account without mentioning a recorded figure', () => {
    const said = describePortfolioSetup({ ...base, typedValue: null }, euros);
    expect(said).toContain('will be worth €3458.00');
    expect(said).not.toContain('recorded');
  });
});

/* ---------------------------------------------------------------------------
 * Cash is a field, so it is not also a kind of holding.
 * ------------------------------------------------------------------------ */
describe('what a holding may be recorded as', () => {
  it('does not offer cash, because the account has a cash field', () => {
    expect(HOLDABLE_ASSET_CLASSES).not.toContain('cash_equivalent');
  });

  it('still offers every other class', () => {
    for (const cls of ['equity', 'fixed_income', 'real_estate', 'commodity', 'crypto', 'other']) {
      expect(HOLDABLE_ASSET_CLASSES).toContain(cls);
    }
  });

  it('keeps the class itself, which the schema and rebalancing both use', () => {
    // Narrowing the picker must not narrow the type: v11's CHECK constraint
    // allows it, a rebalancing target may be it, and existing rows carry it.
    expect(ASSET_CLASS_ORDER).toContain('cash_equivalent');
    expect(ASSET_CLASS_NAMES.cash_equivalent).toBe('Cash');
  });
});

/* ---------------------------------------------------------------------------
 * The overshoot branch, walked because prices move.
 *
 * Somebody typed a figure weeks ago and the holdings have since grown past it.
 * The screen's cash suggestion has to stop suggesting — walking this found it
 * standing still instead, leaving a figure offered at an earlier total and
 * inflating the account by cash the arithmetic no longer supported.
 *
 * `describePortfolioSetup` is what says the consequence out loud, so the
 * figure it names has to be the real overshoot rather than one computed
 * against stale cash.
 * ------------------------------------------------------------------------ */
describe('when the holdings have outgrown the figure that was typed', () => {
  const euros = (amount: Minor) => `€${(amount / 100).toFixed(2)}`;

  it('names the true overshoot, with the cash gone', () => {
    // 20 x 132.40 plus 2 x 640.00 = 3,928.00 against 3,458.00 typed.
    const said = describePortfolioSetup(
      {
        accountName: 'Trading 212',
        holdingCount: 2,
        holdingsValue: minor(392_800),
        cash: minor(0),
        total: minor(392_800),
        typedValue: minor(345_800),
      },
      euros,
    );

    expect(said).toContain('€470.00 more than the €3458.00 recorded');
    expect(said).toContain('the account goes up by that much');
    expect(said, 'no cash clause when there is none').not.toContain('in cash');
  });

  it('would have named the wrong figure had stale cash survived', () => {
    // What the defect produced: cash suggested at the one-holding total and
    // still applied at the two-holding one, so the overshoot read €1,280.
    const said = describePortfolioSetup(
      {
        accountName: 'Trading 212',
        holdingCount: 2,
        holdingsValue: minor(392_800),
        cash: minor(81_000),
        total: minor(473_800),
        typedValue: minor(345_800),
      },
      euros,
    );

    // The sentence is honest about whatever it is handed — which is why the
    // clamp belongs in the screen, and why this test pins the difference
    // between the two readings rather than trusting one of them.
    expect(said).toContain('€1280.00 more');
    expect(said).toContain('€810.00 in cash');
  });
});
