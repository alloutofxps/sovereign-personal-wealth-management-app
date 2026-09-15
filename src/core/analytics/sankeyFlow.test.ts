/* ===========================================================================
 * THE FLOW GRAPH'S SENTENCES, AND THE SCALARS A SCREEN READS
 * ---------------------------------------------------------------------------
 * `buildSankeyFlow` is arithmetic and `analytics.test.ts` covers the
 * arithmetic. This file covers the two things in it that are not numbers —
 * the names of the shortfall source and the retained leaf — and the six
 * scalars the analytics field and the `where-it-went` explanation read.
 *
 * Both names were claims the arithmetic could not support:
 *
 *   'Drawn from savings'      fired whenever `spent + saved > income`, and
 *                             `saved` is budget-book only, so a month that
 *                             spent nothing and merely earmarked past its
 *                             income announced that savings were drawn on.
 *   'Still in your account'   is `income - spent - saved`, so earmarked money
 *                             had been subtracted from it — and earmarked
 *                             money is exactly what is still in the account.
 *                             True only where `saved` is zero.
 *
 * Both are `describeFeeDrag` again: every figure correct to the cent, the
 * words in front of them assuming something not established. CLAUDE.md's rule
 * is a test per branch, each written to fail against the old wording first.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE GUARDS STAY NOW THAT NOTHING DRAWS THE GRAPH
 *
 * Phase 9 removed the Sankey, so as of today **these two names render
 * nowhere**. That is worth stating rather than implying, because a guard on an
 * invisible string is exactly the kind of test that looks like cargo later.
 *
 * They stay for two reasons. The nodes still exist and still carry
 * user-facing strings, so anything that renders this graph again inherits
 * whatever they say — and the original defect survived a phase precisely
 * because it was only read on months where it happened to be true. And the
 * scalar arms below are not about names at all: they are what the field and
 * the explanation now read, with no picture beside them to contradict them,
 * which makes them *more* load-bearing than they were when a chart could have
 * shown the disagreement.
 *
 * VERIFIED by breaking each one. `SHORTFALL_NAME` back to 'Drawn from
 * savings' fails two arms; `RETAINED_NAME` back to 'Still in your account'
 * fails two arms.
 * ======================================================================== */

import { describe, expect, it } from 'vitest';
import { minor } from '@/core/money';
import {
  OTHER_ID,
  RESERVES_ID,
  RETAINED_ID,
  RETAINED_NAME,
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
 * The retained node's name, which was the same defect one node along.
 *
 * It read "Still in your account". `retained` is `income - spent - saved`, so
 * money earmarked for a pot has been taken off it — and that money has not
 * moved, which is the one thing `assign` is explicit about. The sentence was
 * true only where `saved` is zero, and that is the shape of the month it was
 * read against, which is how it survived a phase.
 *
 * The branch below is the one that matters and the one no screen exercised:
 * a period with a pot contribution, where the node's figure is strictly less
 * than what is in the account.
 *
 * VERIFIED by breaking it: setting `RETAINED_NAME` back to 'Still in your
 * account' fails `does not claim to be the account balance` on both arms.
 * ------------------------------------------------------------------------ */
describe('the retained node is named for what the figure is', () => {
  const retainedNode = (income: number, spend: number, saved: number) =>
    graph(income, spend, saved).nodes.find((node) => node.id === RETAINED_ID);

  it('does not claim to be the account balance', () => {
    // 1000 in, 300 spent, 200 earmarked. 700 is still in the account; the
    // node's figure is 500, and the old name asserted those were the same.
    const node = retainedNode(100_000, 30_000, 20_000);

    expect(node, 'a surplus period has a retained node').toBeDefined();
    expect(node!.value, 'income - spent - saved').toBe(minor(50_000));
    expect(node!.name).toBe(RETAINED_NAME);

    const lower = node!.name.toLowerCase();
    expect(lower, 'earmarked money is still in the account').not.toContain('account');
    expect(lower, 'nor is it a balance').not.toContain('balance');
  });

  it('is worded the same way on a period with nothing set aside', () => {
    // The branch the old name was accidentally right on. It has to take the
    // same wording, or the node would tell two different stories about one
    // figure depending on whether a pot happened to be funded.
    const node = retainedNode(100_000, 30_000, 0);

    expect(node!.value).toBe(minor(70_000));
    expect(node!.name).toBe(RETAINED_NAME);
    expect(node!.name.toLowerCase()).not.toContain('account');
  });

  it('agrees with the figure the graph returns', () => {
    const flow = graph(100_000, 30_000, 20_000);

    expect(retainedNode(100_000, 30_000, 20_000)!.value).toBe(flow.retained);
  });

  it('is absent when there is nothing left over', () => {
    expect(retainedNode(50_000, 50_000, 0)).toBeUndefined();
    expect(retainedNode(30_000, 50_000, 0), 'nor on a deficit').toBeUndefined();
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
 * Anything under SMALL_SLICE_BP of the spending is folded into one leaf. It
 * was a presentation decision of the Sankey, which phase 9 removed, and these
 * tests were written for it — they are kept because what they actually assert
 * is an engine property that outlived the chart: **the fold changes which
 * nodes exist and must not change what anything cost.**
 *
 * That is worth a guard on its own. Folding is the only place in this engine
 * where a slice stops having its own node, so it is the only place where the
 * node totals and the scalar totals could drift apart — and the scalars are
 * what the field and the explanation now read, with no picture beside them to
 * contradict. Hiding a category is a presentation decision; losing its money
 * is a lie, and after phase 9 nothing on screen would show it happening.
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
