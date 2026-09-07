import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import {
  describePot,
  monthlyPotTotal,
  monthsUntil,
  planFor,
  potStatusLabel,
  reservedForPots,
  suggestCatchUp,
  type PotTarget,
} from './sinkingFund';

const m = (major: number): Minor => minor(Math.round(major * 100));
/* A symbol-free stub. Real formatting is the money module's job, and the
 * currency guard rightly objects to a literal symbol anywhere outside it. */
const fmt = (a: Minor) => `${(a / 100).toFixed(2)}`;
const TODAY = '2026-09-03';

function target(over: Partial<PotTarget> = {}): PotTarget {
  return {
    envelopeId: 'pot-1',
    name: 'Car insurance',
    targetAmount: m(1020),
    currentBalance: m(100),
    kind: 'by_date',
    targetDate: '2027-09-01',
    recurring: true,
    assignedThisCycle: m(0),
    balanceAtCycleStart: m(100),
    ...over,
  };
}

describe('months until a date', () => {
  it('counts whole months only', () => {
    expect(monthsUntil('2026-09-03', '2026-12-03')).toBe(3);
    expect(monthsUntil('2026-09-03', '2027-09-03')).toBe(12);
  });

  it('does not count a month that has not fully passed', () => {
    // The 1st of next month is not a whole month from the 20th.
    expect(monthsUntil('2026-09-20', '2026-10-01')).toBe(0);
    expect(monthsUntil('2026-09-20', '2026-10-25')).toBe(1);
  });

  it('never goes negative on a date in the past', () => {
    expect(monthsUntil('2026-09-03', '2026-01-01')).toBe(0);
  });
});

describe('what a pot needs each month', () => {
  it('spreads the remainder over the months left', () => {
    // (1020 − 100) over 11 whole months to 1 Sep 2027 = 83.64 a month.
    const plan = planFor(target(), TODAY);
    expect(plan.monthsRemaining).toBe(11);
    expect(plan.monthlyAllocation).toBe(8364);
    expect(plan.outstanding).toBe(m(920));
  });

  it('rounds up, so the last month is never a penny short', () => {
    const plan = planFor(
      target({ targetAmount: m(100), currentBalance: m(0), balanceAtCycleStart: m(0), targetDate: '2026-12-03' }),
      TODAY,
    );
    // 10000 over 3 months is 3333.33; three payments of 3334 clear it.
    expect(plan.monthlyAllocation).toBe(3334);
    expect(plan.monthlyAllocation * plan.monthsRemaining).toBeGreaterThanOrEqual(plan.outstanding);
  });

  it("holds the month's target still while you pay into it", () => {
    // The case that made this rule necessary: asked for 83.64, you pay it,
    // and the ask must not immediately drop to 77.92 as though the target
    // moved the moment you reached it.
    const beforePaying = planFor(
      target({ currentBalance: m(100), balanceAtCycleStart: m(100), assignedThisCycle: m(0) }),
      TODAY,
    );
    const afterPaying = planFor(
      target({
        currentBalance: m(183.64),
        balanceAtCycleStart: m(100),
        assignedThisCycle: m(83.64),
      }),
      TODAY,
    );

    expect(afterPaying.monthlyAllocation).toBe(beforePaying.monthlyAllocation);
    expect(afterPaying.stillNeededThisCycle).toBe(0);
    expect(afterPaying.status).toBe('on_track');
  });

  it('works the new share out from where the pot actually got to, at rollover', () => {
    const thisMonth = planFor(
      target({ currentBalance: m(100), balanceAtCycleStart: m(100) }),
      TODAY,
    );
    const nextMonthAfter = (balance: number) =>
      planFor(
        target({
          currentBalance: m(balance),
          balanceAtCycleStart: m(balance),
          assignedThisCycle: m(0),
        }),
        '2026-10-03',
      ).monthlyAllocation;

    // Pay exactly what was asked and the pace holds steady — the point of
    // spreading a target evenly is that keeping up changes nothing.
    expect(nextMonthAfter(183.64)).toBe(thisMonth.monthlyAllocation);
    // Pay more than asked and next month asks for less.
    expect(nextMonthAfter(400)).toBeLessThan(thisMonth.monthlyAllocation);
    // Skip the month entirely and next month picks up the slack.
    expect(nextMonthAfter(100)).toBeGreaterThan(thisMonth.monthlyAllocation);
  });

  it('stops asking the moment a pot is full, even mid-month', () => {
    const plan = planFor(
      target({ currentBalance: m(1020), balanceAtCycleStart: m(100), assignedThisCycle: m(920) }),
      TODAY,
    );
    expect(plan.status).toBe('funded');
    expect(plan.monthlyAllocation).toBe(0);
    expect(plan.stillNeededThisCycle).toBe(0);
  });

  it('recalculates upward after a month is missed', () => {
    const behind = planFor(
      target({ currentBalance: m(100), targetDate: '2026-12-03' }),
      TODAY,
    );
    const further = planFor(
      target({ currentBalance: m(100), targetDate: '2026-11-03' }),
      TODAY,
    );
    // Fewer months left for the same shortfall means a bigger monthly share.
    expect(further.monthlyAllocation).toBeGreaterThan(behind.monthlyAllocation);
  });

  it('asks for nothing once the pot is full', () => {
    const plan = planFor(target({ currentBalance: m(1020), balanceAtCycleStart: m(1020) }), TODAY);
    expect(plan.status).toBe('funded');
    expect(plan.monthlyAllocation).toBe(0);
    expect(plan.stillNeededThisCycle).toBe(0);
    expect(plan.percentFunded).toBe(100);
  });

  it('counts what has already gone in this month', () => {
    const plan = planFor(target({ assignedThisCycle: m(90) }), TODAY);
    expect(plan.stillNeededThisCycle).toBe(0);
    expect(plan.status).toBe('on_track');
  });

  it('asks only for the difference when part of it has gone in', () => {
    const plan = planFor(target({ assignedThisCycle: m(50) }), TODAY);
    expect(plan.stillNeededThisCycle).toBe(8364 - 5000);
    expect(plan.status).toBe('behind');
  });

  it('asks for the whole remainder once the date has passed', () => {
    const plan = planFor(target({ targetDate: '2026-08-01' }), TODAY);
    expect(plan.status).toBe('overdue');
    expect(plan.monthsRemaining).toBe(1);
    expect(plan.monthlyAllocation).toBe(m(920));
  });

  it('requires nothing of a pot with no deadline', () => {
    const plan = planFor(target({ targetDate: null }), TODAY);
    expect(plan.status).toBe('open_ended');
    expect(plan.monthlyAllocation).toBe(0);
    expect(plan.stillNeededThisCycle).toBe(0);
  });

  it('never asks for a negative amount, whatever the inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        (targetAmount, balance, assigned) => {
          const plan = planFor(
            target({
              targetAmount: minor(targetAmount),
              currentBalance: minor(balance),
              assignedThisCycle: minor(assigned),
            }),
            TODAY,
          );
          expect(plan.monthlyAllocation).toBeGreaterThanOrEqual(0);
          expect(plan.stillNeededThisCycle).toBeGreaterThanOrEqual(0);
          expect(plan.outstanding).toBeGreaterThanOrEqual(0);
          expect(Number.isSafeInteger(plan.monthlyAllocation)).toBe(true);
        },
      ),
    );
  });
});

describe('what pots take out of what is safe to spend', () => {
  it('reserves what is in the pot and what still has to go in', () => {
    const plan = planFor(target({ currentBalance: m(100), assignedThisCycle: m(0) }), TODAY);
    // 100 already there, plus 83.64 promised this month.
    expect(reservedForPots([plan])).toBe(m(100) + 8364);
  });

  it('stops reserving twice once the month is covered', () => {
    const before = planFor(target({ currentBalance: m(100), assignedThisCycle: m(0) }), TODAY);
    const after = planFor(
      target({ currentBalance: m(183.64), assignedThisCycle: m(83.64) }),
      TODAY,
    );
    // Moving money into the pot must not increase the total reservation:
    // it shifts from "still to find" into "already there".
    expect(reservedForPots([after])).toBeLessThanOrEqual(reservedForPots([before]) + 1);
  });

  it('reserves nothing for an empty open-ended pot', () => {
    const plan = planFor(target({ targetDate: null, currentBalance: m(0), balanceAtCycleStart: m(0) }), TODAY);
    expect(reservedForPots([plan])).toBe(0);
  });

  it('adds up the monthly share across pots', () => {
    const a = planFor(target(), TODAY);
    const b = planFor(target({ envelopeId: 'p2', targetAmount: m(600), currentBalance: m(0), balanceAtCycleStart: m(0) }), TODAY);
    expect(monthlyPotTotal([a, b])).toBe(a.monthlyAllocation + b.monthlyAllocation);
  });
});

describe('catching up', () => {
  it('puts a lump sum into the pots that are furthest behind first', () => {
    const a = planFor(target({ envelopeId: 'a', currentBalance: m(0), balanceAtCycleStart: m(0) }), TODAY); // needs more
    const b = planFor(
      target({ envelopeId: 'b', targetAmount: m(120), currentBalance: m(0), balanceAtCycleStart: m(0) }),
      TODAY,
    );
    const split = suggestCatchUp([a, b], m(100));
    expect([...split.keys()][0]).toBe('a');
    expect([...split.values()].reduce((s, v) => s + v, 0)).toBe(m(100));
  });

  it('never suggests more than a pot actually needs', () => {
    const a = planFor(target({ envelopeId: 'a', currentBalance: m(0), balanceAtCycleStart: m(0) }), TODAY);
    const split = suggestCatchUp([a], m(10_000));
    expect(split.get('a')).toBe(a.stillNeededThisCycle);
  });

  it('suggests nothing when everything is on track', () => {
    const a = planFor(target({ assignedThisCycle: m(500) }), TODAY);
    expect(suggestCatchUp([a], m(100)).size).toBe(0);
  });
});

describe('what the card says', () => {
  it('speaks in complete sentences with no jargon', () => {
    for (const plan of [
      planFor(target(), TODAY),
      planFor(target({ assignedThisCycle: m(90) }), TODAY),
      planFor(target({ currentBalance: m(1020), balanceAtCycleStart: m(1020) }), TODAY),
      planFor(target({ targetDate: '2026-08-01' }), TODAY),
      planFor(target({ targetDate: null }), TODAY),
    ]) {
      const message = describePot(plan, fmt);
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/[.!]$/);
      expect(message).not.toMatch(
        /allocation|amortis|envelope|debit|credit|variance|deficit|liabilit/i,
      );
      expect(potStatusLabel(plan.status).length).toBeGreaterThan(2);
    }
  });

  it('tells someone what to do when they are behind, not that they failed', () => {
    const message = describePot(planFor(target({ assignedThisCycle: m(20) }), TODAY), fmt);
    expect(message).toMatch(/keep you on track|Tap to/);
    expect(message).not.toMatch(/failed|behind schedule|over budget|warning/i);
  });
});

/* ===========================================================================
 * A POT THAT REFILLS EVERY MONTH
 * ---------------------------------------------------------------------------
 * The kind that could not be expressed before v17. Fifty a month towards the
 * car, indefinitely: the target is the monthly share, not a finishing line,
 * and the balance is beside the point — what matters is whether this month's
 * has gone in.
 * ======================================================================== */

const monthly = (over: Partial<PotTarget> = {}): PotTarget =>
  target({
    name: 'Car running costs',
    kind: 'monthly',
    targetDate: null,
    recurring: false,
    targetAmount: m(50),
    currentBalance: m(0),
    balanceAtCycleStart: m(0),
    assignedThisCycle: m(0),
    ...over,
  });

describe('a monthly pot', () => {
  it('asks for the same amount every month', () => {
    expect(planFor(monthly(), TODAY).monthlyAllocation).toBe(m(50));
  });

  it('is satisfied once this month has gone in', () => {
    const plan = planFor(monthly({ assignedThisCycle: m(50) }), TODAY);
    expect(plan.stillNeededThisCycle).toBe(m(0));
    expect(plan.status).toBe('on_track');
  });

  it('counts a part payment towards the month', () => {
    const plan = planFor(monthly({ assignedThisCycle: m(20) }), TODAY);
    expect(plan.stillNeededThisCycle).toBe(m(30));
    expect(plan.status).toBe('behind');
  });

  it('never calls itself finished, however much has built up', () => {
    // Six months of paying in leaves 300 in the pot. That is not "done" —
    // next month still wants its fifty, and treating a full pot as finished
    // would quietly stop holding the money back.
    const plan = planFor(monthly({ currentBalance: m(300), balanceAtCycleStart: m(300) }), TODAY);
    expect(plan.status).not.toBe('funded');
    expect(plan.monthlyAllocation).toBe(m(50));
    expect(plan.stillNeededThisCycle).toBe(m(50));
  });

  it('has no date, and does not go overdue', () => {
    const plan = planFor(monthly({ targetDate: '2020-01-01' }), TODAY);
    expect(plan.status).toBe('behind');
    expect(plan.monthsRemaining).toBe(0);
  });

  it('reads what is outstanding as this month, not a lifetime total', () => {
    const plan = planFor(monthly({ assignedThisCycle: m(20) }), TODAY);
    expect(plan.outstanding).toBe(m(30));
  });

  it('holds back this month, and whatever has built up so far', () => {
    // Both halves belong in safe-to-spend: the balance is sitting in the bank
    // account, and this month's share is promised even though it has not moved.
    const plan = planFor(monthly({ currentBalance: m(120), balanceAtCycleStart: m(120) }), TODAY);
    expect(reservedForPots([plan])).toBe(m(170));
  });

  it('takes an overpayment as done rather than as a negative', () => {
    const plan = planFor(monthly({ assignedThisCycle: m(80) }), TODAY);
    expect(plan.stillNeededThisCycle).toBe(m(0));
    expect(plan.percentFunded).toBe(100);
  });

  it('says what it means without promising an ending', () => {
    const waiting = describePot(planFor(monthly(), TODAY), fmt);
    const done = describePot(planFor(monthly({ assignedThisCycle: m(50) }), TODAY), fmt);

    expect(waiting).toContain('every month');
    expect(done).toContain("this month's is in");
    // Nothing here may talk about a total left to find. There is no total.
    for (const sentence of [waiting, done]) {
      expect(sentence).not.toMatch(/in total|by [A-Z]/);
    }
  });
});

describe('a pot with no deadline', () => {
  it('is open-ended whether it says so or has simply lost its date', () => {
    const said = planFor(target({ kind: 'open', targetDate: null }), TODAY);
    const lost = planFor(target({ kind: 'by_date', targetDate: null }), TODAY);
    expect(said.status).toBe('open_ended');
    expect(lost.status).toBe('open_ended');
    expect(lost.monthlyAllocation).toBe(m(0));
  });

  it('ignores a date it is not meant to be reading', () => {
    // A pot switched from "by March" to "no rush" keeps nothing of the old
    // deadline: the repository nulls the column, and the engine would not
    // read it anyway.
    const plan = planFor(target({ kind: 'open', targetDate: '2027-03-01' }), TODAY);
    expect(plan.monthlyAllocation).toBe(m(0));
    expect(plan.status).toBe('open_ended');
  });
});
