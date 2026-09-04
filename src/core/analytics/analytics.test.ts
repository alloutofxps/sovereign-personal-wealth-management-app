import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  OTHER_ID,
  RESERVES_ID,
  RETAINED_ID,
  STAGE_IDS,
  buildSankeyFlow,
  conservationErrors,
  foldSmallSlices,
  type FlowInput,
  type SpendSlice,
} from './sankeyFlow';
import { buildDistribution, describeShare, shareOf } from './categoryDistribution';
import {
  MIN_DAYS_OF_HISTORY,
  describePace,
  medianOf,
  trailingMedians,
  type CategoryHistory,
} from './trailingMedian';

const income = (name: string, amount: number) => ({
  accountId: name.toLowerCase(),
  name,
  amount: minor(amount),
});

const spend = (
  name: string,
  amount: number,
  extra: Partial<SpendSlice> = {},
): SpendSlice => ({
  categoryId: name.toLowerCase().replace(/\s+/g, '-'),
  categoryName: name,
  groupId: null,
  groupName: null,
  amount: minor(amount),
  ...extra,
});

const pot = (name: string, amount: number) => ({
  potId: name.toLowerCase(),
  name,
  amount: minor(amount),
});

/* ===========================================================================
 * THE SANKEY GRAPH
 * ---------------------------------------------------------------------------
 * Conservation is the whole point. A flow diagram whose ribbons do not add up
 * is not a chart with a rounding problem; it is a confident, convincing lie
 * about somebody's money.
 * ======================================================================== */

describe('building the cash-flow graph', () => {
  it('says so plainly when there is nothing to draw', () => {
    const graph = buildSankeyFlow({ incomes: [], spends: [], savings: [] });
    expect(graph.empty).toBe(true);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });

  it('routes income through stages to individual categories', () => {
    const graph = buildSankeyFlow({
      incomes: [income('Salary', 300_000)],
      spends: [
        spend('Rent', 120_000, { fixed: true }),
        spend('Food shopping', 60_000),
        spend('Eating out', 40_000),
      ],
      savings: [pot('Holiday', 30_000)],
    });

    expect(graph.empty).toBe(false);
    expect(conservationErrors(graph)).toEqual([]);

    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('income-salary');
    expect(ids).toContain(STAGE_IDS.fixed);
    expect(ids).toContain(STAGE_IDS.discretionary);
    expect(ids).toContain(STAGE_IDS.savings);
    expect(ids).toContain('category-rent');
    expect(ids).toContain('pot-holiday');
  });

  it('keeps what was not spent as its own leaf, so the sources still balance', () => {
    const graph = buildSankeyFlow({
      incomes: [income('Salary', 300_000)],
      spends: [spend('Rent', 100_000, { fixed: true })],
      savings: [],
    });

    expect(graph.retained).toBe(200_000);
    expect(graph.nodes.find((n) => n.id === RETAINED_ID)?.value).toBe(200_000);
    expect(conservationErrors(graph)).toEqual([]);
  });

  it('models a deficit as money drawn from savings rather than a backwards ribbon', () => {
    const graph = buildSankeyFlow({
      incomes: [income('Salary', 100_000)],
      spends: [spend('Rent', 150_000, { fixed: true })],
      savings: [],
    });

    expect(graph.drewOnReserves).toBe(true);
    const reserves = graph.nodes.find((n) => n.id === RESERVES_ID);
    expect(reserves).toBeDefined();
    // Positive, and exactly the shortfall.
    expect(reserves!.value).toBe(50_000);
    expect(graph.retained).toBe(-50_000);
    expect(conservationErrors(graph)).toEqual([]);
    // Every ribbon runs forwards.
    for (const link of graph.links) expect(link.value).toBeGreaterThan(0);
  });

  it('folds the small categories together so a phone is not covered in threads', () => {
    const tiny = Array.from({ length: 10 }, (_, i) => spend(`Small ${i}`, 500));
    const graph = buildSankeyFlow({
      incomes: [income('Salary', 300_000)],
      spends: [spend('Rent', 200_000, { fixed: true }), ...tiny],
      savings: [],
    });

    const other = graph.nodes.find((n) => n.id === OTHER_ID);
    expect(other).toBeDefined();
    expect(other!.value).toBe(5000);
    expect(other!.members).toHaveLength(10);
    // Each one is still itemised, so nothing is actually hidden.
    expect(other!.members!.every((m) => m.amount === 500)).toBe(true);
    expect(conservationErrors(graph)).toEqual([]);
  });

  it('does not fold a single category, because that is just renaming it', () => {
    const { kept, folded } = foldSmallSlices([spend('Tiny', 100)], 1_000_000);
    expect(folded).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it('conserves every unit over arbitrary ledgers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 500_000 }), { minLength: 0, maxLength: 4 }),
        fc.array(fc.integer({ min: 1, max: 200_000 }), { minLength: 0, maxLength: 12 }),
        fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 0, maxLength: 4 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 12 }),
        (incomeAmounts, spendAmounts, savingAmounts, fixedFlags) => {
          const input: FlowInput = {
            incomes: incomeAmounts.map((amount, i) => income(`Income ${i}`, amount)),
            spends: spendAmounts.map((amount, i) =>
              spend(`Category ${i}`, amount, { fixed: fixedFlags[i] ?? false }),
            ),
            savings: savingAmounts.map((amount, i) => pot(`Pot ${i}`, amount)),
          };

          const graph = buildSankeyFlow(input);
          if (graph.empty) return;

          // Nothing appears from nowhere and nothing vanishes.
          expect(conservationErrors(graph)).toEqual([]);

          // In equals out plus what was kept, by construction.
          expect(graph.totalIn).toBe(graph.totalOut + Math.max(graph.retained, 0));

          // Every ribbon carries a positive amount, in both directions of the
          // graph, whatever the ledger looked like.
          for (const link of graph.links) expect(link.value).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* ===========================================================================
 * DISTRIBUTION
 * ======================================================================== */

describe('ranking what the money went on', () => {
  const rows = [
    { categoryId: 'food', categoryName: 'Food shopping', groupId: 'g1', groupName: 'Essential living', amount: minor(50_000) },
    { categoryId: 'rent', categoryName: 'Rent', groupId: 'g1', groupName: 'Essential living', amount: minor(100_000) },
    { categoryId: 'fun', categoryName: 'Fun', groupId: 'g2', groupName: 'Lifestyle', amount: minor(50_000) },
  ];

  it('ranks biggest first and shares to the basis point', () => {
    const distribution = buildDistribution(rows);
    expect(distribution.total).toBe(200_000);
    expect(distribution.ranked[0]?.categoryName).toBe('Rent');
    expect(distribution.ranked[0]?.shareBp).toBe(5000); // exactly half
    expect(distribution.ranked[1]?.shareBp).toBe(2500);
  });

  it('makes a group exactly the sum of what is under it', () => {
    const distribution = buildDistribution(rows);
    const essential = distribution.groups.find((g) => g.groupId === 'g1')!;
    expect(essential.amount).toBe(150_000);
    expect(essential.categories.reduce((sum, c) => sum + c.amount, 0)).toBe(essential.amount);
    expect(essential.shareBp).toBe(7500);
  });

  it('keeps ungrouped categories rather than dropping them', () => {
    const distribution = buildDistribution([
      ...rows,
      { categoryId: 'x', categoryName: 'Loose', groupId: null, groupName: null, amount: minor(10_000) },
    ]);
    expect(distribution.ungrouped.map((c) => c.categoryName)).toEqual(['Loose']);
  });

  it('never divides by a total of nothing', () => {
    expect(shareOf(minor(100), minor(0))).toBe(0);
    expect(buildDistribution([]).empty).toBe(true);
  });

  it('describes a share the way a person would say it', () => {
    expect(describeShare(5000 as never)).toBe('about half of your spending');
    expect(describeShare(3300 as never)).toBe('about a third of your spending');
    expect(describeShare(2500 as never)).toBe('about a quarter of your spending');
    expect(describeShare(1200 as never)).toBe('about 12% of your spending');
    expect(describeShare(40 as never)).toMatch(/less than one per cent/);
  });
});

/* ===========================================================================
 * TRAILING MEDIANS
 * ---------------------------------------------------------------------------
 * The guard matters more than the arithmetic. Slice 4 shipped a category
 * average that divided three days of records by three months and reported
 * €12.17 for something that was really €36.50. Saying "not yet" is the whole
 * feature.
 * ======================================================================== */

const history = (name: string, cycles: number[], current = 0): CategoryHistory => ({
  categoryId: name.toLowerCase(),
  categoryName: name,
  cycles: cycles.map((amount, i) => ({ cycle: `2026-0${i + 1}`, amount: minor(amount) })),
  currentSpend: minor(current),
});

describe('working out what normal looks like', () => {
  it('refuses to invent a baseline for a young ledger', () => {
    const result = trailingMedians({
      histories: [history('Food', [10_000, 20_000, 30_000])],
      daysRecorded: 21,
      cycleElapsed: 0.5,
    });

    expect(result.status).toBe('insufficient_history');
    if (result.status === 'insufficient_history') {
      expect(result.daysRecorded).toBe(21);
      expect(result.explanation).toMatch(/more months? of records/);
      // The sentence must not contain a fabricated figure.
      expect(result.explanation).not.toMatch(/€/);
    }
  });

  it('refuses when there are not two closed cycles, however long the ledger', () => {
    const result = trailingMedians({
      histories: [history('Food', [10_000])],
      daysRecorded: 200,
      cycleElapsed: 0.5,
    });
    expect(result.status).toBe('insufficient_history');
    if (result.status === 'insufficient_history') expect(result.cyclesFound).toBe(1);
  });

  it('takes the exact median across three cycles', () => {
    // 100, 300, 200 → 200, not the 200 an average happens to give here.
    const result = trailingMedians({
      histories: [history('Food', [10_000, 30_000, 20_000])],
      daysRecorded: 120,
      cycleElapsed: 1,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.categories[0]?.median).toBe(20_000);
  });

  it('shrugs off a one-off spike the way an average would not', () => {
    // An annual insurance payment in one month out of five.
    const result = trailingMedians({
      histories: [history('Home', [5000, 5000, 200_000, 5000, 6000])],
      daysRecorded: 200,
      cycleElapsed: 1,
    });
    if (result.status !== 'ready') throw new Error('expected a baseline');
    expect(result.categories[0]?.median).toBe(5000);
  });

  it('averages the middle two on an even count, in whole units', () => {
    expect(medianOf([100, 300])).toBe(200);
    expect(medianOf([100, 101])).toBe(101); // rounds, never half a penny
    expect(medianOf([])).toBe(0);
  });

  it('flags a category running hot, and says so without alarm', () => {
    const result = trailingMedians({
      histories: [history('Eating out', [10_000, 10_000, 10_000], 6_500)],
      daysRecorded: 120,
      cycleElapsed: 0.5, // halfway through, so 6,500 projects to 13,000
    });
    if (result.status !== 'ready') throw new Error('expected a baseline');

    const baseline = result.categories[0]!;
    expect(baseline.projected).toBe(13_000);
    expect(baseline.paceBp).toBe(13_000);
    expect(baseline.runningHot).toBe(true);
    expect(describePace(baseline)).toBe(
      'Running about 30% higher than your usual three-month pace.',
    );
  });

  it('does not fire at exactly twenty per cent over', () => {
    // The brief says "exceeds by more than 20%", so the boundary is exclusive.
    // Stated as a test because "more than" and "at least" look identical in
    // prose and differ by one category's worth of nagging.
    const result = trailingMedians({
      histories: [history('Eating out', [10_000, 10_000, 10_000], 6_000)],
      daysRecorded: 120,
      cycleElapsed: 0.5,
    });
    if (result.status !== 'ready') throw new Error('expected a baseline');
    expect(result.categories[0]?.paceBp).toBe(12_000);
    expect(result.categories[0]?.runningHot).toBe(false);
  });

  it('stays quiet when the pace is ordinary', () => {
    const result = trailingMedians({
      histories: [history('Food', [10_000, 10_000, 10_000], 5_000)],
      daysRecorded: 120,
      cycleElapsed: 0.5,
    });
    if (result.status !== 'ready') throw new Error('expected a baseline');
    expect(result.categories[0]?.runningHot).toBe(false);
    expect(describePace(result.categories[0]!)).toBeNull();
  });

  it('never divides by an elapsed fraction of zero', () => {
    const result = trailingMedians({
      histories: [history('Food', [10_000, 10_000], 5_000)],
      daysRecorded: 120,
      cycleElapsed: 0,
    });
    if (result.status !== 'ready') throw new Error('expected a baseline');
    expect(Number.isFinite(result.categories[0]!.projected)).toBe(true);
  });

  it('holds the sixty-day line exactly', () => {
    const justUnder = trailingMedians({
      histories: [history('Food', [1, 2])],
      daysRecorded: MIN_DAYS_OF_HISTORY - 1,
      cycleElapsed: 1,
    });
    const justOver = trailingMedians({
      histories: [history('Food', [1, 2])],
      daysRecorded: MIN_DAYS_OF_HISTORY,
      cycleElapsed: 1,
    });
    expect(justUnder.status).toBe('insufficient_history');
    expect(justOver.status).toBe('ready');
  });
});
