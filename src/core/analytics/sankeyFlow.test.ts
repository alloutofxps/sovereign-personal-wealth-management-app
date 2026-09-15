/* ===========================================================================
 * THE FLOW GRAPH'S ONE SENTENCE
 * ---------------------------------------------------------------------------
 * `buildSankeyFlow` is arithmetic and `analytics.test.ts` covers the
 * arithmetic. This file covers the one thing in it that is not a number: the
 * name of the shortfall source, which is a claim about somebody's money that
 * appears on their screen.
 *
 * It is here because of `describeFeeDrag`, which shipped telling everybody
 * with cheap funds that they were doing badly while every figure in the
 * sentence was correct to the cent. The rule that came out of it is in
 * CLAUDE.md: where wording depends on a sign, a threshold, a count or a
 * plural, there is a test per branch, and each is written to fail against the
 * old wording before it is kept.
 *
 * This is the second time that rule has been applied to `src/core` rather
 * than to a `describe*` function, and the reason is worth stating: a node
 * name is not overridable. A screen can relabel its own cells — the analytics
 * field does, for exactly this reason — but the Sankey renders the name the
 * engine hands it, so a false name here is false everywhere and no view can
 * intercept it.
 *
 * VERIFIED by breaking it: setting `SHORTFALL_NAME` back to 'Drawn from
 * savings' fails `says nothing about savings` and `is true of a month that
 * only gave money a job`. Removing the assertion that the node appears at all
 * fails nothing, which is why the conservation arm is asserted too.
 * ======================================================================== */

import { describe, expect, it } from 'vitest';
import { minor } from '@/core/money';
import {
  OTHER_ID,
  RESERVES_ID,
  SHORTFALL_NAME,
  SMALL_SLICE_BP,
  buildSankeyFlow,
  type SpendSlice,
} from './sankeyFlow';

/** One income slice, one spend slice, one pot. Amounts in cents. */
function graph(income: number, spend: number, saved: number) {
  return buildSankeyFlow({
    incomes: income > 0 ? [{ accountId: 'a1', name: 'Salary', amount: minor(income) }] : [],
    spends:
      spend > 0
        ? [
            {
              categoryId: 'c1',
              categoryName: 'Food',
              groupId: null,
              groupName: null,
              amount: minor(spend),
              fixed: false,
            },
          ]
        : [],
    savings: saved > 0 ? [{ potId: 'p1', name: 'Insurance', amount: minor(saved) }] : [],
  });
}

const shortfallNode = (income: number, spend: number, saved: number) =>
  graph(income, spend, saved).nodes.find((node) => node.id === RESERVES_ID);

describe('the shortfall source is named for something that is always true', () => {
  /*
   * The branch the old name got wrong.
   *
   * Nothing was spent and nothing left any account. £400 of a £300 month was
   * given a job, which is a budget-book entry and moves no cash -- `assign`
   * says so in one line. The old name announced that savings had been drawn
   * on, to somebody whose savings were untouched.
   */
  it('is true of a month that only gave money a job', () => {
    const node = shortfallNode(30_000, 0, 40_000);

    expect(node, 'earmarking past income has to show as a source').toBeDefined();
    expect(node!.value, 'the shortfall is 40000 - 30000').toBe(minor(10_000));
    expect(node!.name).toBe(SHORTFALL_NAME);
    expect(
      node!.name.toLowerCase(),
      'no cash moved, so this may not say savings were drawn on',
    ).not.toContain('saving');
  });

  it('says nothing about savings in any branch', () => {
    // Real overspend, pure earmarking, and both at once.
    for (const [income, spend, saved] of [
      [30_000, 50_000, 0],
      [30_000, 0, 40_000],
      [30_000, 25_000, 20_000],
    ] as const) {
      const node = shortfallNode(income, spend, saved);
      expect(node, `no source for ${income}/${spend}/${saved}`).toBeDefined();
      expect(node!.name.toLowerCase()).not.toContain('saving');
      expect(node!.name.toLowerCase()).not.toContain('drawn');
    }
  });

  it('is absent on a month that stayed inside its income', () => {
    expect(shortfallNode(50_000, 30_000, 10_000)).toBeUndefined();
    expect(graph(50_000, 30_000, 10_000).drewOnReserves).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * The figures the field and the explanation read.
 *
 * `income`, `spent` and `saved` were computed and discarded until the "where
 * it went" explanation needed them. The point of asserting them here is that
 * `totalIn` and `totalOut` are conservation figures and these three are not,
 * and a screen that confuses the two tells somebody their savings were income.
 * ------------------------------------------------------------------------ */
describe('the three halves are returned separately from the conservation totals', () => {
  it('keeps income apart from everything entering the graph', () => {
    const flow = graph(30_000, 50_000, 0);

    expect(flow.income, 'what actually arrived').toBe(minor(30_000));
    expect(flow.totalIn, 'income plus the shortfall, so the picture balances').toBe(minor(50_000));
    expect(
      flow.totalIn === flow.income,
      'a deficit month is exactly where these two differ',
    ).toBe(false);
  });

  it('splits what left from what was only spoken for', () => {
    const flow = graph(100_000, 60_000, 25_000);

    expect(flow.spent).toBe(minor(60_000));
    expect(flow.saved).toBe(minor(25_000));
    expect(flow.totalOut, 'spent + saved').toBe(minor(85_000));
    expect(flow.retained, 'income - totalOut').toBe(minor(15_000));
  });

  it('returns a negative retained rather than clamping it', () => {
    // The field printed "Nothing" here for a phase. The engine was never the
    // problem: it has always signed this figure, and its own comment says so.
    expect(graph(30_000, 50_000, 0).retained).toBe(minor(-20_000));
  });

  it('is all zero on an empty period', () => {
    const flow = graph(0, 0, 0);

    expect(flow.empty).toBe(true);
    expect([flow.income, flow.spent, flow.saved, flow.retained]).toEqual([
      minor(0),
      minor(0),
      minor(0),
      minor(0),
    ]);
  });
});

/* ---------------------------------------------------------------------------
 * The gathered-up slice.
 *
 * Anything under SMALL_SLICE_BP of the spending gets folded into one leaf so
 * the chart stays readable. It matters to the explanation because the ribbons
 * a person can see no longer name every category, so a `how` step promising
 * "each category shows what you spent there" would be describing a chart the
 * app does not draw. The figures must still reconcile after the fold —
 * hiding a category is a presentation decision and losing its money is a lie.
 * ------------------------------------------------------------------------ */
describe('small categories are gathered up without changing the totals', () => {
  /** One big category and `count` tiny ones, each well under the threshold. */
  function withTiddlers(big: number, count: number, each: number) {
    const spends: SpendSlice[] = [
      {
        categoryId: 'big',
        categoryName: 'Rent',
        groupId: null,
        groupName: null,
        amount: minor(big),
        fixed: true,
      },
    ];
    for (let i = 0; i < count; i++) {
      spends.push({
        categoryId: `small-${i}`,
        categoryName: `Small ${i}`,
        groupId: null,
        groupName: null,
        amount: minor(each),
        fixed: false,
      });
    }
    return buildSankeyFlow({
      incomes: [{ accountId: 'a1', name: 'Salary', amount: minor(big + count * each) }],
      spends,
      savings: [],
    });
  }

  it('folds anything under the threshold into one leaf', () => {
    // Six slices at 0.5% each, against a threshold of 2.5%.
    const flow = withTiddlers(1_000_000, 6, 5_000);
    const other = flow.nodes.find((node) => node.id === OTHER_ID);

    expect(SMALL_SLICE_BP).toBe(250);
    expect(other, 'six slices under the threshold need gathering up').toBeDefined();
    expect(other!.value, 'the folded leaf carries all six').toBe(minor(30_000));
    expect(
      flow.nodes.filter((node) => node.id.startsWith('leaf-cat-small')),
      'a folded category gets no ribbon of its own',
    ).toEqual([]);
  });

  it('keeps the arithmetic whole across the fold', () => {
    const flow = withTiddlers(1_000_000, 6, 5_000);

    expect(flow.spent, 'every slice still counts towards what was spent').toBe(minor(1_030_000));
    expect(flow.totalOut).toBe(flow.spent);
    expect(flow.retained, 'income covered it exactly').toBe(minor(0));
  });

  it('folds nothing when every category is worth its own ribbon', () => {
    const flow = withTiddlers(1_000_000, 2, 400_000);

    expect(flow.nodes.find((node) => node.id === OTHER_ID)).toBeUndefined();
  });
});
