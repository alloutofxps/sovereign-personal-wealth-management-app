/* ===========================================================================
 * WHERE THE MONEY WENT
 * ---------------------------------------------------------------------------
 * Turns a period of the ledger into a directed acyclic graph: income on the
 * left, what it was for in the middle, individual categories and pots on the
 * right.
 *
 * The one property that has to hold is conservation. Every unit that enters
 * the graph leaves it or is retained as cash, and every node's inbound total
 * equals its outbound total. A Sankey whose ribbons do not add up is not a
 * chart with a rounding problem — it is a picture that tells somebody a
 * confident lie about their own money, and it looks exactly as convincing as
 * a correct one.
 *
 * So two things are deliberate here. Doing more with a month's money than
 * arrived in it becomes an explicit source rather than an inverted ribbon,
 * because it is a real thing that happened and hiding it in negative geometry
 * makes the arithmetic unfalsifiable. And every amount stays an integer of
 * minor units from end to end: no percentage is ever multiplied back out into
 * a value.
 *
 * That source is named 'From money you already had' and the name is load
 * bearing. It used to read 'Drawn from savings', which is a claim the
 * arithmetic cannot support: the shortfall is `spent + saved - income`, and
 * `saved` is budget-book only, so a month that merely gave money a job can
 * trip it without drawing on anything. See `SHORTFALL_NAME`.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

/* --- what goes in --------------------------------------------------------- */

export interface IncomeSlice {
  accountId: string;
  name: string;
  amount: Minor;
}

export interface SpendSlice {
  categoryId: string;
  categoryName: string;
  /** The group it belongs to, or null when it is not in one. */
  groupId: string | null;
  groupName: string | null;
  amount: Minor;
  /** Contractual: rent, loan payments, the card bill. Not discretionary. */
  fixed?: boolean;
}

export interface SavingSlice {
  potId: string;
  name: string;
  amount: Minor;
}

export interface FlowInput {
  incomes: readonly IncomeSlice[];
  spends: readonly SpendSlice[];
  savings: readonly SavingSlice[];
}

/* --- what comes out ------------------------------------------------------- */

export type NodeKind =
  | 'income'
  | 'reserves'
  | 'stage'
  | 'category'
  | 'pot'
  | 'retained'
  | 'other';

export interface FlowNode {
  id: string;
  name: string;
  kind: NodeKind;
  /** Which vertical column it sits in: 0 sources, 1 stages, 2 leaves. */
  column: number;
  /** Everything through it. In equals out for every node but the ends. */
  value: Minor;
  /** For the aggregate node: what was folded into it. */
  members?: { id: string; name: string; amount: Minor }[];
}

export interface FlowLink {
  source: string;
  target: string;
  value: Minor;
  /** Decides the ribbon's colour. */
  tone: 'income' | 'fixed' | 'discretionary' | 'saving' | 'deficit';
}

export interface SankeyGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  /**
   * Everything entering the graph, which is **not** the same as income.
   *
   * It is `income + shortfall`, and the shortfall is the `SHORTFALL_NAME`
   * source added below so no ribbon has to run backwards. Use it to check the
   * picture adds up; use `income` to tell somebody what came in. Labelling
   * this one "money in" is wrong on every month that outspent its income.
   */
  totalIn: Minor;
  /** Everything leaving it: `spent + saved`. */
  totalOut: Minor;
  /** What actually arrived in the period. */
  income: Minor;
  /** What was spent. */
  spent: Minor;
  /**
   * What was given a job in a pot, which is **not** money that moved.
   *
   * `assign` is budget-book only — "Give money a job. Budget book only, no
   * cash actually moves" — and this figure is read from the BUDGET book's goal
   * and sinking-fund envelopes, while `income` and `spent` are read from the
   * FINANCIAL book. So `totalOut` deliberately adds a figure from one book to
   * a figure from the other.
   *
   * That is right for the question this graph answers, which is what happened
   * to the month's money rather than where the cash physically sits: money
   * earmarked for next year's insurance is spoken for even though it is still
   * in the current account. It is wrong for any sentence of the form "this is
   * what is left in your accounts" — the cash still there is `income - spent`,
   * and this figure is a label on part of it.
   *
   * Two things follow for callers, and both have already been got wrong once:
   * a screen may not say "went out" and mean both halves, and `drewOnReserves`
   * can be true on a month that drew on nothing, because assigning enough to
   * pots is sufficient to push `totalOut` past `income`.
   */
  saved: Minor;
  /** Income less everything that left. Negative means savings were drawn on. */
  retained: Minor;
  /** True when spending outran income and a reserves source was added. */
  drewOnReserves: boolean;
  /** True when there is nothing at all to draw. */
  empty: boolean;
}

/** Anything smaller than this share of spending is folded together. */
export const SMALL_SLICE_BP = 250; // 2.5%

export const STAGE_IDS = {
  fixed: 'stage-fixed',
  discretionary: 'stage-discretionary',
  savings: 'stage-savings',
} as const;

export const RESERVES_ID = 'source-reserves';

/**
 * What the shortfall source is called on screen.
 *
 * Exported so the test that holds this wording can name it, and so nothing
 * has to re-type a user-visible string to assert against it. It is a sentence
 * about somebody's money rather than a label, which is why it is tested at
 * all: see `sankeyFlow.test.ts`, and the second entry under sentences in
 * `PLAN.md`.
 */
export const SHORTFALL_NAME = 'From money you already had';
export const RETAINED_ID = 'leaf-retained';
export const OTHER_ID = 'leaf-other';

const sumOf = <T>(items: readonly T[], pick: (item: T) => number): number =>
  items.reduce((total, item) => total + pick(item), 0);

/**
 * Build the flow graph for a period.
 *
 * Nothing is inferred about dates here — the caller has already decided what
 * falls inside the window. This is arithmetic and layout, and it is pure so
 * the conservation property can be tested over hundreds of random ledgers.
 */
export function buildSankeyFlow(input: FlowInput): SankeyGraph {
  const incomes = input.incomes.filter((slice) => slice.amount > 0);
  const spends = input.spends.filter((slice) => slice.amount > 0);
  const savings = input.savings.filter((slice) => slice.amount > 0);

  const totalIncome = sumOf(incomes, (i) => i.amount);
  const totalSpend = sumOf(spends, (s) => s.amount);
  const totalSaved = sumOf(savings, (s) => s.amount);
  const totalOut = totalSpend + totalSaved;

  if (totalIncome === 0 && totalOut === 0) {
    return {
      nodes: [],
      links: [],
      totalIn: minor(0),
      totalOut: minor(0),
      income: minor(0),
      spent: minor(0),
      saved: minor(0),
      retained: minor(0),
      drewOnReserves: false,
      empty: true,
    };
  }

  // Spending beyond income has to come from somewhere. Naming it keeps the
  // graph balanced without any ribbon having to run backwards.
  const shortfall = Math.max(0, totalOut - totalIncome);
  const retained = totalIncome - totalOut;
  const totalIn = totalIncome + shortfall;

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];

  /* --- column 0: where the money came from ------------------------------- */

  for (const income of incomes) {
    nodes.push({
      id: `income-${income.accountId}`,
      name: income.name,
      kind: 'income',
      column: 0,
      value: income.amount,
    });
  }

  if (shortfall > 0) {
    nodes.push({
      id: RESERVES_ID,
      name: SHORTFALL_NAME,
      kind: 'reserves',
      column: 0,
      value: minor(shortfall),
    });
  }

  /* --- column 1: what it was for ----------------------------------------- */

  const fixed = spends.filter((slice) => slice.fixed);
  const discretionary = spends.filter((slice) => !slice.fixed);

  const totalFixed = sumOf(fixed, (s) => s.amount);
  const totalDiscretionary = sumOf(discretionary, (s) => s.amount);

  const stages: { id: string; name: string; value: number; tone: FlowLink['tone'] }[] = [];
  if (totalFixed > 0) {
    stages.push({
      id: STAGE_IDS.fixed,
      name: 'Bills and commitments',
      value: totalFixed,
      tone: 'fixed',
    });
  }
  if (totalDiscretionary > 0) {
    stages.push({
      id: STAGE_IDS.discretionary,
      name: 'Day-to-day spending',
      value: totalDiscretionary,
      tone: 'discretionary',
    });
  }
  if (totalSaved > 0) {
    stages.push({
      id: STAGE_IDS.savings,
      name: 'Put by',
      value: totalSaved,
      tone: 'saving',
    });
  }

  for (const stage of stages) {
    nodes.push({
      id: stage.id,
      name: stage.name,
      kind: 'stage',
      column: 1,
      value: minor(stage.value),
    });
  }

  /* --- sources into stages ------------------------------------------------
   * Cut as one stream rather than shared out pro rata; see `streamLinks` for
   * why proportional rounding cannot keep both margins exact.
   * --------------------------------------------------------------------- */

  const sources = [
    ...incomes.map((income) => ({
      id: `income-${income.accountId}`,
      value: income.amount as number,
      tone: 'income' as const,
    })),
    ...(shortfall > 0
      ? [{ id: RESERVES_ID, value: shortfall, tone: 'deficit' as const }]
      : []),
  ];

  // Money kept rather than spent leaves as its own leaf, so the sources still
  // add up to everything that came in.
  const stageTargets = [
    ...stages.map((stage) => ({ id: stage.id, value: stage.value })),
    ...(retained > 0 ? [{ id: RETAINED_ID, value: retained }] : []),
  ];

  if (retained > 0) {
    nodes.push({
      id: RETAINED_ID,
      name: 'Still in your account',
      kind: 'retained',
      column: 1,
      value: minor(retained),
    });
  }

  for (const link of streamLinks(sources, stageTargets)) {
    const source = sources.find((s) => s.id === link.source);
    links.push({ ...link, tone: source?.tone ?? 'income' });
  }

  /* --- column 2: the leaves ---------------------------------------------- */

  // Small categories are folded together so a phone screen does not turn into
  // forty threads of one pixel each.
  const { kept, folded } = foldSmallSlices(discretionary, totalSpend + totalSaved);

  const leafFor = (slice: SpendSlice) => `category-${slice.categoryId}`;

  for (const slice of fixed) {
    nodes.push({
      id: leafFor(slice),
      name: slice.categoryName,
      kind: 'category',
      column: 2,
      value: slice.amount,
    });
    links.push({
      source: STAGE_IDS.fixed,
      target: leafFor(slice),
      value: slice.amount,
      tone: 'fixed',
    });
  }

  for (const slice of kept) {
    nodes.push({
      id: leafFor(slice),
      name: slice.categoryName,
      kind: 'category',
      column: 2,
      value: slice.amount,
    });
    links.push({
      source: STAGE_IDS.discretionary,
      target: leafFor(slice),
      value: slice.amount,
      tone: 'discretionary',
    });
  }

  if (folded.length > 0) {
    const total = sumOf(folded, (slice) => slice.amount);
    nodes.push({
      id: OTHER_ID,
      name: 'Everything else',
      kind: 'other',
      column: 2,
      value: minor(total),
      members: folded.map((slice) => ({
        id: slice.categoryId,
        name: slice.categoryName,
        amount: slice.amount,
      })),
    });
    links.push({
      source: STAGE_IDS.discretionary,
      target: OTHER_ID,
      value: minor(total),
      tone: 'discretionary',
    });
  }

  for (const pot of savings) {
    nodes.push({
      id: `pot-${pot.potId}`,
      name: pot.name,
      kind: 'pot',
      column: 2,
      value: pot.amount,
    });
    links.push({
      source: STAGE_IDS.savings,
      target: `pot-${pot.potId}`,
      value: pot.amount,
      tone: 'saving',
    });
  }

  return {
    nodes,
    links,
    totalIn: minor(totalIn),
    totalOut: minor(totalOut),
    income: minor(totalIncome),
    spent: minor(totalSpend),
    saved: minor(totalSaved),
    retained: minor(retained),
    drewOnReserves: shortfall > 0,
    empty: false,
  };
}

/**
 * Lay the sources end to end, lay the targets end to end, and cut where they
 * meet.
 *
 * The obvious approach — give each target its pro-rata share of each source —
 * does not survive contact with integers. Rounding each source's share
 * independently makes every *source* total come out right while leaving the
 * *target* totals a unit or two adrift, because the roundings do not have to
 * cancel. The property test found exactly that: a stage taking in 26,509 and
 * sending out 26,510.
 *
 * This instead treats the whole inflow as one stream and cuts it at both sets
 * of boundaries, so both margins are exact by construction with no rounding
 * anywhere. The cost is that attribution becomes ordinal rather than
 * proportional — the first income fills the first stage before the second
 * income contributes anything. That is a fair trade: money is fungible, so
 * *any* claim about which pound paid which bill is a convention rather than a
 * fact, and this is the convention that cannot be arithmetically wrong.
 */
function streamLinks(
  sources: readonly { id: string; value: number }[],
  targets: readonly { id: string; value: number }[],
): { source: string; target: string; value: Minor }[] {
  const out: { source: string; target: string; value: Minor }[] = [];

  let si = 0;
  let ti = 0;
  let fromSource = sources[0]?.value ?? 0;
  let intoTarget = targets[0]?.value ?? 0;

  while (si < sources.length && ti < targets.length) {
    const take = Math.min(fromSource, intoTarget);

    if (take > 0) {
      out.push({ source: sources[si]!.id, target: targets[ti]!.id, value: minor(take) });
      fromSource -= take;
      intoTarget -= take;
    }

    // A zero-valued source or target would otherwise spin here forever.
    if (fromSource === 0) {
      si += 1;
      fromSource = sources[si]?.value ?? 0;
    }
    if (intoTarget === 0) {
      ti += 1;
      intoTarget = targets[ti]?.value ?? 0;
    }
  }

  return out;
}

/** Split the leaves into the ones worth their own ribbon and the rest. */
export function foldSmallSlices(
  slices: readonly SpendSlice[],
  totalSpend: number,
): { kept: SpendSlice[]; folded: SpendSlice[] } {
  if (totalSpend <= 0) return { kept: [...slices], folded: [] };

  const kept: SpendSlice[] = [];
  const folded: SpendSlice[] = [];

  for (const slice of slices) {
    const shareBp = (slice.amount * 10_000) / totalSpend;
    if (shareBp < SMALL_SLICE_BP) folded.push(slice);
    else kept.push(slice);
  }

  // Folding one thing into "everything else" is just renaming it, which is
  // worse than leaving it alone.
  if (folded.length === 1) {
    kept.push(folded[0]!);
    return { kept, folded: [] };
  }

  return { kept, folded };
}

/**
 * Does every node's inbound equal its outbound?
 *
 * Exported so the property test can assert it over generated ledgers, and so
 * the view can refuse to draw a graph that does not add up rather than
 * rendering a convincing wrong picture.
 */
export function conservationErrors(graph: SankeyGraph): string[] {
  const problems: string[] = [];
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();

  for (const link of graph.links) {
    outbound.set(link.source, (outbound.get(link.source) ?? 0) + link.value);
    inbound.set(link.target, (inbound.get(link.target) ?? 0) + link.value);
  }

  for (const node of graph.nodes) {
    const into = inbound.get(node.id) ?? 0;
    const outOf = outbound.get(node.id) ?? 0;

    if (node.column === 0 && outOf !== node.value) {
      problems.push(`${node.name} sends ${outOf} but is worth ${node.value}.`);
    }
    if (node.column === 1 && into !== outOf && node.kind !== 'retained') {
      problems.push(`${node.name} takes in ${into} and sends out ${outOf}.`);
    }
    if (node.column === 2 && into !== node.value) {
      problems.push(`${node.name} receives ${into} but is worth ${node.value}.`);
    }
  }

  const sourceTotal = graph.nodes
    .filter((n) => n.column === 0)
    .reduce((total, n) => total + n.value, 0);
  if (sourceTotal !== graph.totalIn) {
    problems.push(`Sources total ${sourceTotal} against an inflow of ${graph.totalIn}.`);
  }

  return problems;
}
