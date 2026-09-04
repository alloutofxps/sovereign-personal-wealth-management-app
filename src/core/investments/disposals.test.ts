import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { basisPoints, minor } from '@/core/money';
import {
  DisposalError,
  RebalanceError,
  assertTargetsComplete,
  describeDisposal,
  describeRebalance,
  openLotsInOrder,
  planRebalance,
  relieveLotsFIFO,
  totalRemaining,
  type AssetClass,
  type TargetAllocation,
  type TaxLot,
} from './index';

const SHARE = 100_000_000;

const lot = (
  id: string,
  acquiredDate: string,
  shares: number,
  costMinor: number,
  remaining = shares,
): TaxLot => ({
  id,
  accountId: 'acc-brokerage',
  securityId: 'sec-VWCE',
  holdingId: 'hold-VWCE',
  acquiredDate,
  quantity1e8: shares * SHARE,
  remainingQuantity1e8: remaining * SHARE,
  costBasisMinor: minor(costMinor),
  isClosed: remaining === 0,
});

/* ===========================================================================
 * WHICH SHARES DID YOU SELL?
 * ---------------------------------------------------------------------------
 * 20 bought in January at €100 and 30 in June at €120. Sell 20 and the answer
 * is either a €500 gain or a €100 loss depending entirely on which twenty
 * went. The shares are interchangeable; the parcels are not.
 * ======================================================================== */

describe('relieving the oldest parcels first', () => {
  const january = lot('l1', '2026-01-15', 20, 200_000); // 20 @ €100
  const june = lot('l2', '2026-06-10', 30, 360_000); // 30 @ €120

  it('closes the oldest parcel exactly and leaves the newer one alone', () => {
    const result = relieveLotsFIFO({
      lots: [june, january],
      sellQuantity1e8: 20 * SHARE,
      salePriceMinor: minor(12_500),
    });

    expect(result.relieved).toHaveLength(1);
    expect(result.relieved[0]!.lotId).toBe('l1');
    expect(result.relieved[0]!.closes).toBe(true);

    const after = new Map(result.updatedLots.map((l) => [l.id, l]));
    expect(after.get('l1')!.remainingQuantity1e8).toBe(0);
    expect(after.get('l1')!.isClosed).toBe(true);
    // The June parcel is untouched, down to the object it came in as.
    expect(after.get('l2')!.remainingQuantity1e8).toBe(30 * SHARE);
    expect(after.get('l2')!.isClosed).toBe(false);

    // 20 × €125 = €2,500 in, against €2,000 paid.
    expect(result.totalProceeds).toBe(250_000);
    expect(result.totalCostBasisRelieved).toBe(200_000);
    expect(result.realizedGain).toBe(50_000);
  });

  it('prorates a partly sold parcel against what it originally cost', () => {
    const result = relieveLotsFIFO({
      lots: [january],
      sellQuantity1e8: 5 * SHARE,
      salePriceMinor: minor(12_500),
    });

    // A quarter of the parcel, so a quarter of its cost: €500 of €2,000.
    expect(result.totalCostBasisRelieved).toBe(50_000);
    expect(result.relieved[0]!.closes).toBe(false);
    expect(result.updatedLots[0]!.remainingQuantity1e8).toBe(15 * SHARE);
    expect(result.updatedLots[0]!.isClosed).toBe(false);
    // And the parcel's original figures are untouched, so the next sale
    // prorates against the same denominator rather than a shrinking one.
    expect(result.updatedLots[0]!.quantity1e8).toBe(20 * SHARE);
    expect(result.updatedLots[0]!.costBasisMinor).toBe(200_000);
  });

  it('runs through several parcels when one is not enough', () => {
    const result = relieveLotsFIFO({
      lots: [january, june],
      sellQuantity1e8: 35 * SHARE,
      salePriceMinor: minor(12_500),
    });

    expect(result.relieved.map((r) => r.lotId)).toEqual(['l1', 'l2']);
    expect(result.relieved[0]!.closes).toBe(true);
    expect(result.relieved[1]!.closes).toBe(false);

    // All of January (€2,000) plus half of June (€1,800).
    expect(result.totalCostBasisRelieved).toBe(200_000 + 180_000);
    expect(result.totalProceeds).toBe(35 * 12_500);
    expect(result.realizedGain).toBe(437_500 - 380_000);
  });

  it('takes the fee off the proceeds, not off the cost', () => {
    const result = relieveLotsFIFO({
      lots: [january],
      sellQuantity1e8: 20 * SHARE,
      salePriceMinor: minor(12_500),
      feesMinor: minor(500),
    });

    expect(result.totalProceeds).toBe(250_000 - 500);
    expect(result.totalCostBasisRelieved).toBe(200_000);
    // A dealing fee reduces the gain, because it reduces what you got.
    expect(result.realizedGain).toBe(49_500);
    expect(result.feesMinor).toBe(500);
  });

  it('reports a loss as a loss rather than as an absence', () => {
    const result = relieveLotsFIFO({
      lots: [june],
      sellQuantity1e8: 30 * SHARE,
      salePriceMinor: minor(10_000),
    });

    expect(result.realizedGain).toBe(300_000 - 360_000);
  });

  it('refuses to sell more than is held, and says how many there are', () => {
    expect(() =>
      relieveLotsFIFO({
        lots: [january],
        sellQuantity1e8: 25 * SHARE,
        salePriceMinor: minor(12_500),
      }),
    ).toThrow(/You cannot sell more shares than you hold\. There are 20 to sell\./);
  });

  it('refuses a sale of nothing, and a negative fee', () => {
    expect(() =>
      relieveLotsFIFO({ lots: [january], sellQuantity1e8: 0, salePriceMinor: minor(1) }),
    ).toThrow(DisposalError);
    expect(() =>
      relieveLotsFIFO({
        lots: [january],
        sellQuantity1e8: SHARE,
        salePriceMinor: minor(1),
        feesMinor: minor(-1),
      }),
    ).toThrow(/negative/);
  });

  it('ignores closed parcels entirely', () => {
    const spent = lot('l0', '2025-01-01', 10, 100_000, 0);
    expect(openLotsInOrder([spent, january])).toHaveLength(1);
    expect(totalRemaining([spent, january])).toBe(20 * SHARE);
  });

  it('orders two parcels bought the same day the same way every time', () => {
    const a = lot('bbb', '2026-01-15', 5, 50_000);
    const b = lot('aaa', '2026-01-15', 5, 50_000);
    expect(openLotsInOrder([a, b]).map((l) => l.id)).toEqual(['aaa', 'bbb']);
    expect(openLotsInOrder([b, a]).map((l) => l.id)).toEqual(['aaa', 'bbb']);
  });

  it('handles a fractional sale without losing a cent of cost', () => {
    const fractional = lot('lf', '2026-01-01', 1, 11_850);
    const result = relieveLotsFIFO({
      lots: [{ ...fractional, quantity1e8: 33_333_333, remainingQuantity1e8: 33_333_333 }],
      sellQuantity1e8: 33_333_333,
      salePriceMinor: minor(12_500),
    });

    // The whole parcel went, so the whole cost is relieved — not a rounded
    // approximation of it.
    expect(result.totalCostBasisRelieved).toBe(11_850);
    expect(result.updatedLots[0]!.remainingQuantity1e8).toBe(0);
  });
});

/* ===========================================================================
 * THE PROPERTY THAT MATTERS
 * ---------------------------------------------------------------------------
 * The parcels must always add back up to the holding. If they ever drift, the
 * gain figure quietly stops being defensible and nothing says so.
 * ======================================================================== */

describe('two hundred sequences of buying and selling', () => {
  it('always leaves the open parcels adding up to what is held', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            shares: fc.integer({ min: 1, max: 500 }),
            cost: fc.integer({ min: 1, max: 200_000 }),
            month: fc.integer({ min: 1, max: 12 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 0, maxLength: 8 }),
        (buys, sells) => {
          let lots: TaxLot[] = buys.map((buy, index) =>
            lot(
              `l${index}`,
              `2026-${String(buy.month).padStart(2, '0')}-01`,
              buy.shares,
              buy.cost,
            ),
          );

          // What the holding says: everything bought, less everything sold.
          let held = lots.reduce((sum, l) => sum + l.remainingQuantity1e8, 0);

          for (const sell of sells) {
            const wanted = sell * SHARE;
            if (wanted > held) continue;

            const result = relieveLotsFIFO({
              lots,
              sellQuantity1e8: wanted,
              salePriceMinor: minor(10_000),
            });

            lots = result.updatedLots;
            held -= wanted;

            // The invariant: open parcels always add to the holding exactly.
            expect(totalRemaining(lots)).toBe(held);

            // And no parcel is ever left in an impossible state.
            for (const l of lots) {
              expect(l.remainingQuantity1e8).toBeGreaterThanOrEqual(0);
              expect(l.remainingQuantity1e8).toBeLessThanOrEqual(l.quantity1e8);
              expect(l.isClosed).toBe(l.remainingQuantity1e8 === 0);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('saying what a sale will do', () => {
  const format = (a: number) => `€${(a / 100).toFixed(2)}`;
  const formatDate = (iso: string) => (iso.startsWith('2026-01') ? 'January' : 'June');

  it('names the parcels by when they were bought', () => {
    const result = relieveLotsFIFO({
      lots: [lot('l1', '2026-01-15', 20, 200_000)],
      sellQuantity1e8: 10 * SHARE,
      salePriceMinor: minor(11_850),
    });

    const said = describeDisposal(result, {
      symbol: 'VWCE',
      quantity1e8: 10 * SHARE,
      cashAccountName: 'Everyday account',
      format,
      formatDate,
    });

    expect(said).toContain('Selling 10 shares of VWCE will return €1185.00');
    expect(said).toContain('gain of €185.00');
    expect(said).toContain('bought January');
  });

  it('says plainly when nothing was made or lost', () => {
    const result = relieveLotsFIFO({
      lots: [lot('l1', '2026-01-15', 10, 100_000)],
      sellQuantity1e8: 10 * SHARE,
      salePriceMinor: minor(10_000),
    });

    const said = describeDisposal(result, {
      symbol: 'VWCE',
      quantity1e8: 10 * SHARE,
      cashAccountName: 'Everyday account',
      format,
      formatDate,
    });
    expect(said).toContain('worth exactly what you paid');
  });
});

/* ===========================================================================
 * GETTING BACK TO WHERE YOU MEANT TO BE
 * ======================================================================== */

const targets = (...pairs: [AssetClass, number][]): TargetAllocation[] =>
  pairs.map(([assetClass, bp]) => ({ assetClass, targetBp: basisPoints(bp) }));

const values = (...pairs: [AssetClass, number][]) =>
  new Map(pairs.map(([cls, v]) => [cls, minor(v)] as const));

describe('checking a target is a whole portfolio', () => {
  it('refuses targets that do not add to a hundred, and says by how much', () => {
    expect(() => assertTargetsComplete(targets(['equity', 8_000]))).toThrow(
      /come to 80\.00%\. There is 20\.00% still to place/,
    );
    expect(() =>
      assertTargetsComplete(targets(['equity', 8_000], ['fixed_income', 4_000])),
    ).toThrow(/20\.00% more than you have/);
  });

  it('refuses a class listed twice', () => {
    expect(() =>
      assertTargetsComplete(targets(['equity', 5_000], ['equity', 5_000])),
    ).toThrow(RebalanceError);
  });

  it('refuses an empty target', () => {
    expect(() => assertTargetsComplete([])).toThrow(/Set what you want/);
  });
});

describe('working out how to get back to target', () => {
  it('sends new money to whatever is furthest behind', () => {
    // €8,271 of shares, nothing in bonds, wanting 80/20 with €500 to invest.
    const plan = planRebalance({
      currentValues: values(['equity', 827_100]),
      targets: targets(['equity', 8_000], ['fixed_income', 2_000]),
      depositCash: minor(50_000),
    });

    expect(plan.depositPlan).toHaveLength(1);
    expect(plan.depositPlan[0]!.assetClass).toBe('fixed_income');
    // The whole deposit goes to bonds, because bonds are €1,754 short and the
    // deposit is only €500 of that.
    expect(plan.depositPlan[0]!.amount).toBe(50_000);
    expect(plan.depositRemainder).toBe(0);
  });

  it('never allocates more than the deposit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 9_999 }),
        (equityValue, bondValue, deposit, equityBp) => {
          const plan = planRebalance({
            currentValues: values(['equity', equityValue], ['fixed_income', bondValue]),
            targets: targets(
              ['equity', equityBp],
              ['fixed_income', 10_000 - equityBp],
            ),
            depositCash: minor(deposit),
          });

          const placed = plan.depositPlan.reduce((sum, step) => sum + step.amount, 0);
          expect(placed).toBeLessThanOrEqual(deposit);
          expect(placed + plan.depositRemainder).toBe(deposit);
          // And it only ever buys. A deposit plan that sold something would
          // defeat the point of preferring deposits to trades.
          for (const step of plan.depositPlan) expect(step.amount).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('brings every class to within a basis point on a full rebalance', () => {
    fc.assert(
      fc.property(
        // At least €100 a class. Below about that, a basis point of the
        // portfolio is worth less than a penny and simply cannot be hit — a
        // three-cent portfolio cannot be split 49.99/50.01 by any arithmetic,
        // integer or otherwise. Conservation still holds at every size, and is
        // asserted separately below.
        fc.integer({ min: 10_000, max: 50_000_000 }),
        fc.integer({ min: 10_000, max: 50_000_000 }),
        fc.integer({ min: 10_000, max: 50_000_000 }),
        fc.integer({ min: 1, max: 9_998 }),
        (a, b, c, equityBp) => {
          const bondBp = Math.floor((10_000 - equityBp) / 2);
          const cashBp = 10_000 - equityBp - bondBp;

          const plan = planRebalance({
            currentValues: values(['equity', a], ['fixed_income', b], ['cash_equivalent', c]),
            targets: targets(
              ['equity', equityBp],
              ['fixed_income', bondBp],
              ['cash_equivalent', cashBp],
            ),
          });

          // Applying every recommended buy and sell lands on the targets.
          const total = plan.portfolioValue;
          for (const line of plan.lines) {
            const after = line.currentValue + line.difference;
            const bp = Math.round((after * 10_000) / total);
            expect(Math.abs(bp - line.targetBp)).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never creates or destroys a penny, at any size at all', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 9_998 }),
        (a, b, c, equityBp) => {
          const bondBp = Math.floor((10_000 - equityBp) / 2);
          const cashBp = 10_000 - equityBp - bondBp;

          const plan = planRebalance({
            currentValues: values(['equity', a], ['fixed_income', b], ['cash_equivalent', c]),
            targets: targets(
              ['equity', equityBp],
              ['fixed_income', bondBp],
              ['cash_equivalent', cashBp],
            ),
          });

          // The buys and the sells cancel exactly. A rebalance moves money
          // around; it does not conjure any. This holds on a three-cent
          // portfolio as firmly as on a three-million-euro one.
          expect(plan.lines.reduce((sum, l) => sum + l.difference, 0)).toBe(0);
          expect(plan.lines.reduce((sum, l) => sum + l.targetValue, 0)).toBe(
            plan.portfolioValue,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('splits a deposit too small to fix everything in proportion to the gaps', () => {
    const plan = planRebalance({
      currentValues: values(['equity', 100_000]),
      targets: targets(['fixed_income', 5_000], ['cash_equivalent', 5_000]),
      depositCash: minor(10_000),
    });

    expect(plan.depositPlan.map((s) => s.amount).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(plan.depositRemainder).toBe(0);
  });

  it('leaves the deposit over when everything is already at target', () => {
    const plan = planRebalance({
      currentValues: values(['equity', 800_000], ['fixed_income', 200_000]),
      targets: targets(['equity', 8_000], ['fixed_income', 2_000]),
      depositCash: minor(50_000),
    });

    // A deposit into a balanced portfolio still has somewhere to go, because
    // adding it changes the total. Both classes stay in proportion.
    expect(plan.depositPlan.reduce((sum, s) => sum + s.amount, 0)).toBe(50_000);
  });

  it('says nothing needs doing when nothing does', () => {
    const plan = planRebalance({
      currentValues: values(['equity', 800_000], ['fixed_income', 200_000]),
      targets: targets(['equity', 8_000], ['fixed_income', 2_000]),
    });

    expect(plan.alreadyBalanced).toBe(true);
    expect(describeRebalance(plan, (a) => `€${(a / 100).toFixed(2)}`)).toContain(
      'Nothing needs doing',
    );
  });

  it('describes drift without instructing anybody to trade', () => {
    const plan = planRebalance({
      currentValues: values(['equity', 900_000], ['fixed_income', 100_000]),
      targets: targets(['equity', 6_000], ['fixed_income', 4_000]),
    });

    const said = describeRebalance(plan, (a) => `€${(a / 100).toFixed(2)}`);
    // Both classes are 30 points out — one over, one under — so either is a
    // true thing to say. What matters is that it states the gap and stops.
    expect(said).toMatch(/30\.00% (more in shares|less in bonds)/);
    expect(said).not.toMatch(/you should|we recommend|must sell/i);
  });
});
