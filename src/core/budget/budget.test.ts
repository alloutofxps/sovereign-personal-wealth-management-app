import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  cycleKey,
  daysBetween,
  paycheckCycle,
  shiftCycle,
  type BudgetCadence,
} from '@/core/liquidity';
import {
  applyPosting,
  describeReadyToAssign,
  noMovement,
  planBudget,
  quickAssignToTargets,
  rankCoverSources,
  type BudgetInput,
  type OverspendPolicy,
} from './multiMonth';

const env = (envelopeId: string, assigned: number, activity = 0) => ({
  envelopeId,
  assigned: minor(assigned),
  activity: minor(activity),
});

const plan = (over: Partial<BudgetInput> = {}) =>
  planBudget({
    periods: [{ key: '2026-09', envelopes: [] }],
    liquidCash: minor(0),
    assignedToFuture: minor(0),
    policy: 'deduct_next_rta',
    ...over,
  });

/* ===========================================================================
 * PAYCHECK CYCLES
 * ======================================================================== */

describe('paycheck cycles', () => {
  it('puts a date inside the fortnight that contains it', () => {
    const cycle = paycheckCycle('2026-01-02', 'biweekly', '2026-01-10');
    expect(cycle.start).toBe('2026-01-02');
    expect(cycle.end).toBe('2026-01-15');
    expect(cycle.totalDays).toBe(14);
  });

  it('steps backwards for a date before the anchor', () => {
    // Flooring rather than truncating: a date before the first payday belongs
    // to the cycle before it, not collapsed onto the anchor.
    const cycle = paycheckCycle('2026-01-02', 'biweekly', '2025-12-30');
    expect(cycle.start).toBe('2025-12-19');
    expect(cycle.end).toBe('2026-01-01');
  });

  it('generates exactly 26 fortnightly cycles in a year', () => {
    const starts = new Set<string>();
    for (let day = 0; day < 365; day++) {
      const target = new Date(2026, 0, 1 + day);
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
      const cycle = paycheckCycle('2026-01-02', 'biweekly', iso);
      if (cycle.start >= '2026-01-01' && cycle.start <= '2026-12-31') starts.add(cycle.start);
    }
    expect(starts.size).toBe(26);
  });

  it('produces the two three-paycheck months without any overlap', () => {
    // Twice a year a fortnightly payday lands three times in one month. That
    // is the whole reason calendar-month budgeting misleads people paid this
    // way, so it is asserted rather than assumed.
    const byMonth = new Map<string, string[]>();
    let payday = '2026-01-02';
    while (payday <= '2026-12-31') {
      const month = payday.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), payday]);
      const next = new Date(2026, 0, 2 + (byMonth.size ? 0 : 0));
      void next;
      payday = shiftCycle(
        paycheckCycle('2026-01-02', 'biweekly', payday),
        'biweekly',
        '2026-01-02',
        1,
      ).start;
    }

    const threePaydayMonths = [...byMonth.values()].filter((days) => days.length === 3);
    expect(threePaydayMonths).toHaveLength(2);

    // No date belongs to two cycles.
    const all = [...byMonth.values()].flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('handles semi-monthly on the 15th and the last day', () => {
    // Each cycle starts on a payday and ends the day before the next one, so
    // the mid-month cycle runs to the 27th and the month-end cycle carries
    // over into March. That is what "paid on the 15th and the last day"
    // actually means for a budget period.
    const midMonth = paycheckCycle('2026-01-15', 'semimonthly', '2026-02-20');
    expect(midMonth.start).toBe('2026-02-15');
    expect(midMonth.end).toBe('2026-02-27');

    const monthEnd = paycheckCycle('2026-01-15', 'semimonthly', '2026-03-01');
    expect(monthEnd.start).toBe('2026-02-28');
    expect(monthEnd.end).toBe('2026-03-14');
  });

  it('starts a cycle on the leap day when February has one', () => {
    const leap = paycheckCycle('2028-01-15', 'semimonthly', '2028-02-29');
    expect(leap.start).toBe('2028-02-29');

    // And on the 28th in an ordinary year, with no gap left behind.
    const ordinary = paycheckCycle('2026-01-15', 'semimonthly', '2026-02-28');
    expect(ordinary.start).toBe('2026-02-28');
  });

  it('handles semi-monthly on the 1st and the 15th', () => {
    const cycle = paycheckCycle('2026-03-01', 'semimonthly', '2026-03-04');
    expect(cycle.start).toBe('2026-03-01');
    expect(cycle.end).toBe('2026-03-14');
  });

  it('steps cycles forwards and back without leaving gaps', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<BudgetCadence>('weekly', 'biweekly', 'semimonthly', 'calendar_month'),
        fc.integer({ min: -18, max: 18 }),
        (cadence, by) => {
          const anchor = '2026-01-15';
          const start = paycheckCycle(anchor, cadence, '2026-06-10');
          const moved = shiftCycle(start, cadence, anchor, by);
          const back = shiftCycle(moved, cadence, anchor, -by);

          // A cycle is never empty and never runs backwards.
          expect(moved.totalDays).toBeGreaterThan(0);
          expect(daysBetween(moved.start, moved.end)).toBeGreaterThanOrEqual(0);
          // Stepping there and back lands where it started.
          expect(back.start).toBe(start.start);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('keys months by name and pay cycles by their start', () => {
    const month = paycheckCycle('2026-01-01', 'calendar_month', '2026-09-14');
    expect(cycleKey(month, 'calendar_month')).toBe('2026-09');

    const fortnight = paycheckCycle('2026-01-02', 'biweekly', '2026-09-14');
    expect(cycleKey(fortnight, 'biweekly')).toBe(fortnight.start);
  });
});

/* ===========================================================================
 * MULTI-MONTH PLANNING
 * ======================================================================== */

describe('assigning across periods', () => {
  it('takes money assigned to a future period out of the pool today', () => {
    const before = plan({ liquidCash: minor(100_000) });
    expect(before.readyToAssign).toBe(100_000);

    const after = plan({ liquidCash: minor(100_000), assignedToFuture: minor(50_000) });
    expect(after.readyToAssign).toBe(50_000);
  });

  it('reduces today by exactly what was promised to tomorrow, whatever the numbers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (cash, assignedNow, assignedLater) => {
          const withoutFuture = planBudget({
            periods: [{ key: '2026-09', envelopes: [env('e1', assignedNow)] }],
            liquidCash: minor(cash),
            assignedToFuture: minor(0),
            policy: 'deduct_next_rta',
          });

          const withFuture = planBudget({
            periods: [{ key: '2026-09', envelopes: [env('e1', assignedNow)] }],
            liquidCash: minor(cash),
            assignedToFuture: minor(assignedLater),
            policy: 'deduct_next_rta',
          });

          expect(withoutFuture.readyToAssign - withFuture.readyToAssign).toBe(assignedLater);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('says so when future periods hold more than there is money for', () => {
    const result = plan({ liquidCash: minor(10_000), assignedToFuture: minor(30_000) });
    expect(result.overAssigned).toBe(true);
    expect(result.futureOverReach).toBe(20_000);
  });

  it('carries an unspent balance into the next period', () => {
    const result = planBudget({
      periods: [
        { key: '2026-08', envelopes: [env('groceries', 50_000, 30_000)] },
        { key: '2026-09', envelopes: [env('groceries', 50_000, 10_000)] },
      ],
      liquidCash: minor(200_000),
      assignedToFuture: minor(0),
      policy: 'deduct_next_rta',
    });

    const september = result.periods[1]!.envelopes[0]!;
    expect(september.broughtForward).toBe(20_000); // 50,000 assigned less 30,000 spent
    expect(september.available).toBe(60_000); // 20,000 + 50,000 − 10,000
  });
});

describe('what happens when an envelope goes under', () => {
  const overspent = (policy: OverspendPolicy) =>
    planBudget({
      periods: [
        { key: '2026-08', envelopes: [env('dining', 10_000, 14_500)] },
        { key: '2026-09', envelopes: [env('dining', 10_000, 0)] },
      ],
      liquidCash: minor(100_000),
      assignedToFuture: minor(0),
      policy,
    });

  it('under "deduct from next month", resets the envelope and charges the pool', () => {
    const result = overspent('deduct_next_rta');

    const august = result.periods[0]!.envelopes[0]!;
    expect(august.available).toBe(-4500);
    expect(august.overspent).toBe(true);

    const september = result.periods[1]!;
    // The envelope starts clean.
    expect(september.envelopes[0]!.broughtForward).toBe(0);
    expect(september.envelopes[0]!.available).toBe(10_000);
    // And the deficit is charged to this period rather than the one that
    // caused it.
    expect(september.absorbedFromLastPeriod).toBe(4500);
    // Cash less what the envelopes are holding: 100,000 − 10,000. The August
    // assignment is gone — it was spent, and then some.
    expect(result.heldInEnvelopes).toBe(10_000);
    expect(result.readyToAssign).toBe(90_000);
  });

  it('under "carry the negative", the hole stays with the envelope', () => {
    const result = overspent('carry_negative');

    const september = result.periods[1]!;
    expect(september.envelopes[0]!.broughtForward).toBe(-4500);
    expect(september.envelopes[0]!.available).toBe(5500); // −4,500 + 10,000
    expect(september.absorbedFromLastPeriod).toBe(0);
    // The hole stayed in the envelope, so the envelope holds less and the
    // pool holds correspondingly more than under the other policy.
    expect(result.heldInEnvelopes).toBe(5500);
    expect(result.readyToAssign).toBe(94_500);
  });

  it('keeps an envelope in the shape even in a period where nothing happened', () => {
    const result = planBudget({
      periods: [
        { key: '2026-08', envelopes: [env('holiday', 20_000)] },
        { key: '2026-09', envelopes: [] },
      ],
      liquidCash: minor(50_000),
      assignedToFuture: minor(0),
      policy: 'deduct_next_rta',
    });

    // Dropping it would make 20,000 vanish from the budget without a trace.
    const september = result.periods[1]!.envelopes.find((e) => e.envelopeId === 'holiday');
    expect(september?.available).toBe(20_000);
  });

  it('conserves cash whatever the policy and whatever the numbers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(
          fc.record({
            assigned: fc.integer({ min: 0, max: 100_000 }),
            activity: fc.integer({ min: 0, max: 150_000 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.constantFrom<OverspendPolicy>('deduct_next_rta', 'carry_negative'),
        (cash, rows, policy) => {
          const result = planBudget({
            periods: [
              {
                key: '2026-09',
                envelopes: rows.map((row, i) => env(`e${i}`, row.assigned, row.activity)),
              },
            ],
            liquidCash: minor(cash),
            assignedToFuture: minor(0),
            policy,
          });

          // Invariant I5, restated: every unit of cash is either sitting in
          // an envelope or waiting to be given a job. Nothing is anywhere else.
          expect(result.heldInEnvelopes + result.readyToAssign).toBe(cash);

          // And under the deducting policy no envelope is ever left holding a
          // negative amount into the next period.
          if (policy === 'deduct_next_rta') {
            expect(result.heldInEnvelopes).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('what the ready-to-assign pill says', () => {
  const format = (amount: number) => `€${(amount / 100).toFixed(2)}`;

  it('treats zero as the goal rather than an absence', () => {
    const said = describeReadyToAssign(minor(0), format as never);
    expect(said.tone).toBe('liquid');
    expect(said.detail).toMatch(/This is the goal/);
  });

  it('invites the person to do something with a surplus', () => {
    const said = describeReadyToAssign(minor(45_000), format as never);
    expect(said.headline).toBe('€450.00 left to give a job');
    expect(said.tone).toBe('liquid');
  });

  it('states a deficit without alarm, and says how to fix it', () => {
    const said = describeReadyToAssign(minor(-12_000), format as never);
    expect(said.tone).toBe('deficit');
    expect(said.headline).toBe('€120.00 more assigned than you have');
    expect(said.detail).toMatch(/Take some back from a pot/);
    // Never shouty, never blaming.
    expect(said.detail).not.toMatch(/error|wrong|must|failed/i);
  });
});

describe('the quick-assign helpers', () => {
  it('fills targets in order and stops when the money runs out', () => {
    const assignments = quickAssignToTargets(
      [
        { envelopeId: 'insurance', wanted: minor(8500), available: minor(0) },
        { envelopeId: 'holiday', wanted: minor(20_000), available: minor(5000) },
        { envelopeId: 'car', wanted: minor(10_000), available: minor(0) },
      ],
      minor(20_000),
    );

    // Insurance is filled, holiday gets what is left of its 15,000 shortfall.
    expect(assignments).toEqual([
      { envelopeId: 'insurance', amount: 8500 },
      { envelopeId: 'holiday', amount: 11_500 },
    ]);
    // Nothing is promised twice.
    expect(assignments.reduce((t, a) => t + a.amount, 0)).toBe(20_000);
  });

  it('skips anything already funded', () => {
    const assignments = quickAssignToTargets(
      [{ envelopeId: 'done', wanted: minor(5000), available: minor(5000) }],
      minor(50_000),
    );
    expect(assignments).toEqual([]);
  });

  it('never assigns money that is not there', () => {
    expect(
      quickAssignToTargets([{ envelopeId: 'x', wanted: minor(500), available: minor(0) }], minor(0)),
    ).toEqual([]);
  });

  it('ranks where to borrow from, most room first', () => {
    const ranked = rankCoverSources(
      [
        { envelopeId: 'a', name: 'Fun', available: minor(2000) },
        { envelopeId: 'b', name: 'Holiday', available: minor(40_000) },
        { envelopeId: 'c', name: 'Empty', available: minor(0) },
      ],
      minor(4500),
    );

    expect(ranked.map((r) => r.source.name)).toEqual(['Holiday', 'Fun']);
    expect(ranked[0]?.covers).toBe(true);
    expect(ranked[0]?.leaves).toBe(35_500);
    // One that cannot cover it is still offered, marked as partial.
    expect(ranked[1]?.covers).toBe(false);
  });
});

/* ===========================================================================
 * READING THE JOURNAL INTO COLUMNS
 * ---------------------------------------------------------------------------
 * The grid's "in" and "out" columns are a claim about intent, not about
 * direction, and getting that wrong is invisible in the arithmetic — both
 * columns simply read too high while every balance stays correct.
 * ======================================================================== */

describe('deciding which column a posting belongs in', () => {
  it('counts money put into a pot as assigned, not as spending', () => {
    // Credit-normal: money arriving in an envelope is a negative posting.
    const after = applyPosting(noMovement(), 'ASSIGN', minor(-50000));
    expect(after).toEqual({ assigned: minor(50000), activity: minor(0) });
  });

  it('takes an assignment back out of the same column it went into', () => {
    const given = applyPosting(noMovement(), 'ASSIGN', minor(-50000));
    const returned = applyPosting(given, 'ASSIGN', minor(50000));

    // Not 500 in and 500 out — the pot was never touched.
    expect(returned).toEqual({ assigned: minor(0), activity: minor(0) });
  });

  it('counts spending as activity however the envelope was funded', () => {
    const funded = applyPosting(noMovement(), 'ASSIGN', minor(-50000));
    const spent = applyPosting(funded, 'SPEND', minor(54000));

    expect(spent).toEqual({ assigned: minor(50000), activity: minor(54000) });
  });

  it('leaves both columns alone when money only moves between pots', () => {
    // A cover move debits one envelope and credits another under one entry.
    const donor = applyPosting({ assigned: minor(20000), activity: minor(0) }, 'ASSIGN', minor(4000));
    const receiver = applyPosting({ assigned: minor(50000), activity: minor(54000) }, 'ASSIGN', minor(-4000));

    expect(donor.assigned).toBe(16000);
    expect(receiver.assigned).toBe(54000);
    // Neither pot has spent anything by being lent from or lent to.
    expect(donor.activity).toBe(0);
    expect(receiver.activity).toBe(54000);
  });

  it('treats a reversal as what it reverses, not as fresh spending', () => {
    const spent = applyPosting(noMovement(), 'SPEND', minor(54000));
    const undone = applyPosting(spent, 'REVERSAL', minor(-54000));

    expect(undone.activity).toBe(0);
  });
});
