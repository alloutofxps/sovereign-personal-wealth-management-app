/* ===========================================================================
 * GIVING EVERY UNIT A JOB, ACROSS MONTHS
 * ---------------------------------------------------------------------------
 * The arithmetic behind a zero-based budget that spans more than one period.
 *
 * Two things make this harder than it looks, and both are the same mistake in
 * different clothing: treating a period as though it were sealed off from the
 * ones around it.
 *
 *   · Money assigned to next month is spent *now*. It leaves the pool the
 *     moment it is promised, not when next month arrives, or somebody can
 *     promise the same fifty pounds to three different months and the budget
 *     will agree with all three.
 *
 *   · An envelope ending a period below zero does not simply start the next
 *     one below zero. What happens next is a policy the person chooses, and
 *     both answers are defensible, so both are implemented rather than one
 *     being assumed.
 *
 * Everything here is pure and works on plain integers. Allocations arrive as
 * dated facts read from the journal; this file never decides what an
 * allocation *is*, only what a set of them adds up to.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

export type OverspendPolicy = 'deduct_next_rta' | 'carry_negative';

/** What one envelope did in one period. */
export interface EnvelopePeriod {
  envelopeId: string;
  /** Assigned in this period alone. */
  assigned: Minor;
  /** Spent in this period alone. Positive means money left the envelope. */
  activity: Minor;
}

export interface PeriodInput {
  /** 'YYYY-MM' for months, or the cycle's start date. */
  key: string;
  envelopes: readonly EnvelopePeriod[];
}

export interface BudgetInput {
  /** Oldest first, contiguous. The last one is the period being looked at. */
  periods: readonly PeriodInput[];
  /** On-budget liquid cash, right now. */
  liquidCash: Minor;
  /** Assigned to periods after the last one in `periods`. */
  assignedToFuture: Minor;
  policy: OverspendPolicy;
}

export interface EnvelopeState {
  envelopeId: string;
  assigned: Minor;
  activity: Minor;
  /** What is left in the envelope at the end of this period. */
  available: Minor;
  /** What it started the period with, after last period's policy was applied. */
  broughtForward: Minor;
  overspent: boolean;
}

export interface PeriodState {
  key: string;
  envelopes: EnvelopeState[];
  /** Everything assigned in this period. */
  totalAssigned: Minor;
  /** Deficits absorbed from the period before, under `deduct_next_rta`. */
  absorbedFromLastPeriod: Minor;
}

export interface BudgetPlan {
  periods: PeriodState[];
  /** The period being looked at — the last one given. */
  current: PeriodState;
  /**
   * What is left to give a job.
   *
   * Cash, less everything assigned anywhere (including future periods), less
   * deficits carried in. Global rather than per-period, because a pound is a
   * pound whichever month it was promised to.
   */
  readyToAssign: Minor;
  /** True when more has been promised than exists. */
  overAssigned: boolean;
  /** Set when future periods hold more than there is cash for. */
  futureOverReach: Minor;
  /**
   * Deficits closed out of the last period, which the next one will absorb.
   *
   * Under `deduct_next_rta` this is money already spent that no envelope is
   * holding any more, so it has already come out of Ready-to-Assign above.
   */
  carriedOut: Minor;
  /** What the envelopes are holding, after the policy has been applied. */
  heldInEnvelopes: Minor;
}

const sum = <T>(items: readonly T[], pick: (item: T) => number): number =>
  items.reduce((total, item) => total + pick(item), 0);

/**
 * Roll a run of periods forward, applying the overspend policy at each border.
 *
 * The periods must be contiguous and in order; each one's opening balances are
 * the previous one's closing balances, which is the only way a carried deficit
 * can be attributed to the period that actually caused it.
 */
export function planBudget(input: BudgetInput): BudgetPlan {
  const carried = new Map<string, number>();
  const periods: PeriodState[] = [];
  // Deficits closed out of the previous period, waiting to be charged to this
  // one. Attributed forwards, because the period that pays for a hole is the
  // one after the period that dug it.
  let absorbedIntoThisPeriod = 0;

  for (const period of input.periods) {
    const absorbed = absorbedIntoThisPeriod;
    absorbedIntoThisPeriod = 0;
    const envelopes: EnvelopeState[] = [];

    // Every envelope seen so far stays in the shape, even in a period where it
    // did nothing, or a balance carried into it would silently disappear.
    const ids = new Set<string>([...carried.keys(), ...period.envelopes.map((e) => e.envelopeId)]);

    for (const envelopeId of ids) {
      const row = period.envelopes.find((e) => e.envelopeId === envelopeId);
      const assigned = row?.assigned ?? 0;
      const activity = row?.activity ?? 0;
      const broughtForward = carried.get(envelopeId) ?? 0;

      const available = broughtForward + assigned - activity;

      envelopes.push({
        envelopeId,
        assigned: minor(assigned),
        activity: minor(activity),
        available: minor(available),
        broughtForward: minor(broughtForward),
        overspent: available < 0,
      });
    }

    // Close the period: decide what each envelope takes into the next one.
    for (const envelope of envelopes) {
      if (envelope.available >= 0) {
        carried.set(envelope.envelopeId, envelope.available);
        continue;
      }

      if (input.policy === 'carry_negative') {
        // The hole stays with the envelope that dug it, and has to be filled
        // before that category is healthy again.
        carried.set(envelope.envelopeId, envelope.available);
      } else {
        // The hole is filled from the pool instead: the envelope starts clean
        // and everything else has that much less to go round.
        absorbedIntoThisPeriod += -envelope.available;
        carried.set(envelope.envelopeId, 0);
      }
    }

    periods.push({
      key: period.key,
      envelopes: envelopes.sort((a, b) => a.envelopeId.localeCompare(b.envelopeId)),
      totalAssigned: minor(sum(envelopes, (e) => e.assigned)),
      absorbedFromLastPeriod: minor(absorbed),
    });
  }

  const current = periods.at(-1) ?? {
    key: '',
    envelopes: [],
    totalAssigned: minor(0),
    absorbedFromLastPeriod: minor(0),
  };

  /* --- what is left to give a job -----------------------------------------
   * Stated as invariant I5 rather than as a running total of allocations:
   * cash is envelopes plus Ready-to-Assign, so Ready-to-Assign is cash less
   * what the envelopes are holding.
   *
   * Subtracting every allocation ever made instead — the obvious reading of
   * "cash minus allocated" — counts each assignment twice over as soon as its
   * money is spent, because `liquidCash` has already fallen by the spending.
   * Deriving it from what the envelopes still hold cannot drift from the
   * ledger, and makes I5 true by construction rather than by agreement.
   *
   * The policy shows up here: `deduct_next_rta` floors each envelope at zero,
   * so an overspent one is holding nothing and the hole comes out of the pool.
   * `carry_negative` lets the negative stand, so the hole stays in the
   * envelope and the pool is untouched.
   * ---------------------------------------------------------------------- */
  const held = [...carried.values()].reduce(
    (total, balance) => total + (input.policy === 'deduct_next_rta' ? Math.max(0, balance) : balance),
    0,
  );

  const readyToAssign = input.liquidCash - held - input.assignedToFuture;

  return {
    periods,
    current,
    readyToAssign: minor(readyToAssign),
    overAssigned: readyToAssign < 0,
    futureOverReach: minor(Math.max(0, input.assignedToFuture - Math.max(0, input.liquidCash))),
    carriedOut: minor(absorbedIntoThisPeriod),
    heldInEnvelopes: minor(held),
  };
}

/**
 * What the Ready-to-Assign pill says.
 *
 * Three states, three different jobs. Zero is the goal and should feel like an
 * achievement rather than an absence; a surplus is an invitation; a deficit is
 * a thing to fix, said without alarm because over-assigning is a normal step
 * in the middle of budgeting rather than a mistake.
 */
export function describeReadyToAssign(
  readyToAssign: Minor,
  format: (amount: Minor) => string,
  /**
   * What the envelopes are holding. Nought with nought left to assign is not
   * the same state as nought with everything assigned, and the difference is
   * the whole of what this sentence is for.
   */
  heldInEnvelopes: Minor = minor(0),
): { tone: 'liquid' | 'deficit'; headline: string; detail: string } {
  if (readyToAssign === 0 && heldInEnvelopes === 0) {
    return {
      tone: 'liquid',
      headline: 'Nothing to give a job yet',
      detail:
        'When money arrives it turns up here first, waiting for you to say what it is for.',
    };
  }

  if (readyToAssign === 0) {
    return {
      tone: 'liquid',
      headline: `${format(minor(0))} left to give a job`,
      detail: 'Every unit of your money has a purpose. This is the goal.',
    };
  }

  if (readyToAssign > 0) {
    return {
      tone: 'liquid',
      headline: `${format(readyToAssign)} left to give a job`,
      detail: 'Money without a job tends to get spent on nothing in particular.',
    };
  }

  return {
    tone: 'deficit',
    headline: `${format(minor(-readyToAssign))} more assigned than you have`,
    detail:
      'You have given the same money more than one job. Take some back from a pot to ' +
      'balance it.',
  };
}

/* --- quick assign --------------------------------------------------------- */

export interface QuickAssignTarget {
  envelopeId: string;
  /** What this envelope wants this period. */
  wanted: Minor;
  /** What it already has. */
  available: Minor;
}

/**
 * Work out what to assign to meet targets, without over-committing.
 *
 * Envelopes are filled in the order given until the money runs out, rather
 * than each getting a proportional slice. A half-funded insurance pot is not
 * half as useful as a funded one — partial funding across the board leaves
 * everything short, where filling in priority order leaves a clear boundary
 * between what is covered and what is not.
 */
export function quickAssignToTargets(
  targets: readonly QuickAssignTarget[],
  available: Minor,
): { envelopeId: string; amount: Minor }[] {
  let left = Math.max(0, available);
  const out: { envelopeId: string; amount: Minor }[] = [];

  for (const target of targets) {
    if (left <= 0) break;
    const shortfall = Math.max(0, target.wanted - target.available);
    if (shortfall === 0) continue;

    const give = Math.min(shortfall, left);
    left -= give;
    out.push({ envelopeId: target.envelopeId, amount: minor(give) });
  }

  return out;
}

/* --- covering an overspend ------------------------------------------------ */

export interface CoverSource {
  envelopeId: string;
  name: string;
  available: Minor;
}

/**
 * Where the money to fix an overspend could come from, best first.
 *
 * Ranked by what is left rather than by name: the envelope with the most room
 * is the one least likely to be pushed into the same trouble by helping.
 */
export function rankCoverSources(
  sources: readonly CoverSource[],
  needed: Minor,
): { source: CoverSource; covers: boolean; leaves: Minor }[] {
  return sources
    .filter((source) => source.available > 0)
    .sort((a, b) => b.available - a.available)
    .map((source) => ({
      source,
      covers: source.available >= needed,
      leaves: minor(Math.max(0, source.available - needed)),
    }));
}

/* --- reading the journal into columns ------------------------------------- */

export interface EnvelopeMovement {
  assigned: Minor;
  activity: Minor;
}

/**
 * Which column a single budget-book posting belongs in.
 *
 * The question is *why* the money moved, not which way it went. Deciding on
 * the sign alone files taking money back out of a pot as though it had been
 * spent, so both columns climb and neither is true — an envelope that was
 * given 500 and then emptied again would read as 500 in and 500 out rather
 * than as untouched.
 *
 * An envelope is credit-normal: money arriving is a credit (negative), money
 * leaving is a debit (positive). The grid speaks in plain positives, so the
 * sign is flipped once, here.
 */
export function applyPosting(
  movement: EnvelopeMovement,
  entryKind: string,
  amount: Minor,
): EnvelopeMovement {
  return entryKind === 'ASSIGN'
    ? { assigned: minor(movement.assigned - amount), activity: movement.activity }
    : { assigned: movement.assigned, activity: minor(movement.activity + amount) };
}

/** An empty pair of columns, for folding postings into. */
export function noMovement(): EnvelopeMovement {
  return { assigned: minor(0), activity: minor(0) };
}
