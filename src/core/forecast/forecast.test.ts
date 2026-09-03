import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, basisPoints, type Minor } from '@/core/money';
import { describeProjection, project, type ProjectedEvent } from './projection';
import { calculateRunway, describeDuration, describeRunway, guessOptional } from './runway';
import { comparePayoff, orderFor, simulatePayoff, totalMinimum, type DebtAccount } from '@/core/simulate/debt';
import { monthsToReach, projectFire, targetFor } from '@/core/simulate/fire';

const m = (major: number): Minor => minor(Math.round(major * 100));
const fmt = (a: Minor) => `${(a / 100).toFixed(2)}`;
const TODAY = '2026-09-03';

/* --- the daily projection ------------------------------------------------ */

describe('projecting the balance forward', () => {
  const bills: ProjectedEvent[] = [
    { date: '2026-09-10', name: 'Rent', amount: m(-1200), kind: 'bill' },
    { date: '2026-09-25', name: 'Pay from work', amount: m(2500), kind: 'income' },
  ];

  it('walks day by day and applies what falls on each', () => {
    const p = project({ today: TODAY, days: 30, startingCash: m(2000), events: bills, buffer: m(200) });

    expect(p.points).toHaveLength(31);
    expect(p.points[0]?.balance).toBe(m(2000));
    expect(p.points[7]?.balance).toBe(m(800)); // 10 Sep, after rent
    expect(p.endBalance).toBe(m(3300)); // after payday
  });

  it('finds the tightest point and the first dip below the cushion', () => {
    const p = project({ today: TODAY, days: 30, startingCash: m(1300), events: bills, buffer: m(200) });
    expect(p.lowest.balance).toBe(m(100));
    expect(p.firstBelowBuffer?.date).toBe('2026-09-10');
    expect(p.firstBelowZero).toBeNull();
  });

  it('spots the day the account would run out', () => {
    const p = project({ today: TODAY, days: 30, startingCash: m(500), events: bills, buffer: m(200) });
    expect(p.firstBelowZero?.date).toBe('2026-09-10');
    expect(p.points.at(-1)?.balance).toBe(m(1800));
  });

  it('leaves out anything beyond the horizon rather than piling it on the edge', () => {
    const far: ProjectedEvent[] = [
      { date: '2027-05-01', name: 'Next year', amount: m(-5000), kind: 'bill' },
    ];
    const p = project({ today: TODAY, days: 30, startingCash: m(1000), events: far, buffer: m(0) });
    expect(p.endBalance).toBe(m(1000));
  });

  it('never loses a penny across the whole projection', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: -50_000, max: 50_000 }).filter((n) => n !== 0), { maxLength: 20 }),
        (start, amounts) => {
          const events: ProjectedEvent[] = amounts.map((amount, index) => ({
            date: `2026-09-${String((index % 27) + 3).padStart(2, '0')}`,
            name: `Event ${index}`,
            amount: minor(amount),
            kind: 'bill' as const,
          }));
          const p = project({
            today: TODAY,
            days: 30,
            startingCash: minor(start),
            events,
            buffer: minor(0),
          });
          expect(p.endBalance).toBe(minor(start + amounts.reduce((s, a) => s + a, 0)));
        },
      ),
    );
  });

  it('describes what it found without alarming anybody', () => {
    const tight = project({ today: TODAY, days: 30, startingCash: m(1300), events: bills, buffer: m(200) });
    const message = describeProjection(tight, TODAY, fmt, (iso) => iso);
    expect(message).toMatch(/Nothing is wrong/);
    expect(message).not.toMatch(/danger|alert|failed|warning/i);

    const fine = project({ today: TODAY, days: 30, startingCash: m(5000), events: bills, buffer: m(200) });
    expect(describeProjection(fine, TODAY, fmt, (iso) => iso)).toMatch(/stays above your cushion/);
  });
});

/* --- runway -------------------------------------------------------------- */

describe('how long the money would last', () => {
  const categories = [
    { id: 'food', name: 'Food shopping', monthly: m(400), optional: false },
    { id: 'out', name: 'Eating out', monthly: m(200), optional: true },
    { id: 'fun', name: 'Fun', monthly: m(150), optional: true },
  ];

  it('divides what you have by what a month costs', () => {
    const r = calculateRunway({ usableCash: m(6000), fixedMonthly: m(1250), categories });
    expect(r.monthlyNeed).toBe(m(2000));
    expect(r.months).toBe(3);
    expect(r.days).toBe(90);
  });

  it('stretches further once the optional things come off', () => {
    const asYouAre = calculateRunway({ usableCash: m(6000), fixedMonthly: m(1250), categories });
    const bareBones = calculateRunway({
      usableCash: m(6000),
      fixedMonthly: m(1250),
      categories,
      excludedIds: ['out', 'fun'],
    });
    expect(bareBones.monthlyNeed).toBe(m(1650));
    expect(bareBones.days).toBeGreaterThan(asYouAre.days!);
  });

  it('says so rather than dividing by zero when nothing goes out', () => {
    const r = calculateRunway({ usableCash: m(6000), fixedMonthly: minor(0), categories: [] });
    expect(r.days).toBeNull();
    expect(describeDuration(r.days)).toBe('as long as you like');
  });

  it('is zero when there is nothing spare', () => {
    const r = calculateRunway({ usableCash: m(-50), fixedMonthly: m(1000), categories: [] });
    expect(r.days).toBe(0);
  });

  it('says durations the way people say them', () => {
    expect(describeDuration(5)).toBe('about 5 days');
    expect(describeDuration(21)).toBe('about 3 weeks');
    expect(describeDuration(180)).toBe('about 6 months');
    expect(describeDuration(1095)).toBe('about 3 years');
  });

  it('guesses what is optional, and can be overruled', () => {
    expect(guessOptional('Eating out')).toBe(true);
    expect(guessOptional('Fun')).toBe(true);
    expect(guessOptional('Rent')).toBe(false);
    expect(guessOptional('Food shopping')).toBe(false);
  });

  it('puts both figures in one sentence', () => {
    const asYouAre = calculateRunway({ usableCash: m(6000), fixedMonthly: m(1250), categories });
    const bareBones = calculateRunway({
      usableCash: m(6000),
      fixedMonthly: m(1250),
      categories,
      excludedIds: ['out', 'fun'],
    });
    const message = describeRunway(asYouAre, bareBones, fmt);
    expect(message).toMatch(/would last/);
    expect(message).toMatch(/stretch to/);
  });
});

/* --- paying off debt ----------------------------------------------------- */

describe('paying off what you owe', () => {
  const debts: DebtAccount[] = [
    { id: 'card', name: 'Credit card', balance: m(2000), apr: basisPoints(1999), minimumPayment: m(50) },
    { id: 'store', name: 'Store card', balance: m(400), apr: basisPoints(2499), minimumPayment: m(20) },
    { id: 'loan', name: 'Car loan', balance: m(5000), apr: basisPoints(699), minimumPayment: m(150) },
  ];

  it('orders by balance one way and by rate the other', () => {
    expect(orderFor('smallest_first', debts).map((d) => d.id)).toEqual(['store', 'card', 'loan']);
    expect(orderFor('costliest_first', debts).map((d) => d.id)).toEqual(['store', 'card', 'loan']);
  });

  it('adds up the minimum you cannot go below', () => {
    expect(totalMinimum(debts)).toBe(m(220));
  });

  it('clears everything and reports when', () => {
    const plan = simulatePayoff(debts, m(600), 'costliest_first');
    expect(plan.months).not.toBeNull();
    expect(plan.months!).toBeGreaterThan(10);
    expect(plan.clearedOrder).toHaveLength(3);
    // Every balance is gone at the end.
    const last = plan.timeline.at(-1)!;
    expect(Object.values(last.balances).every((b) => b === 0)).toBe(true);
  });

  it('charges less interest going after the most expensive first', () => {
    const c = comparePayoff(debts, m(600));
    expect(c.costliestFirst.totalInterest).toBeLessThanOrEqual(c.smallestFirst.totalInterest);
    expect(c.extraInterest).toBeGreaterThanOrEqual(0);
  });

  it('clears the smallest balance sooner going smallest first', () => {
    const smallest = simulatePayoff(debts, m(600), 'smallest_first');
    const costliest = simulatePayoff(debts, m(600), 'costliest_first');
    const firstOf = (plan: typeof smallest) => plan.clearedOrder[0]?.monthIndex ?? Infinity;
    expect(firstOf(smallest)).toBeLessThanOrEqual(firstOf(costliest));
  });

  it('says plainly when the budget will not cover the minimums', () => {
    const c = comparePayoff(debts, m(100));
    expect(c.budgetTooLow).toBe(true);
  });

  it('does not spin forever when the budget never clears the interest', () => {
    const hopeless: DebtAccount[] = [
      { id: 'x', name: 'Card', balance: m(10_000), apr: basisPoints(3000), minimumPayment: minor(0) },
    ];
    const plan = simulatePayoff(hopeless, minor(0), 'costliest_first');
    expect(plan.months).toBeNull();
  });

  it('never pays more than is owed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 30_000, max: 200_000 }), (budget) => {
        const plan = simulatePayoff(debts, minor(budget), 'costliest_first');
        const last = plan.timeline.at(-1);
        if (!last) return;
        expect(Object.values(last.balances).every((b) => b >= 0)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});

/* --- when you could stop ------------------------------------------------- */

describe('when you could stop', () => {
  it('turns a withdrawal rate into a multiple of a year', () => {
    expect(targetFor(m(30_000), basisPoints(400))).toBe(m(750_000)); // 25x
    expect(targetFor(m(30_000), basisPoints(300))).toBe(m(1_000_000)); // 33.3x
  });

  it('takes longer at a lower withdrawal rate, because the target is bigger', () => {
    const base = {
      invested: m(100_000),
      monthlyContribution: m(1500),
      annualSpending: m(30_000),
      realReturn: basisPoints(500),
    };
    const at4 = projectFire({ ...base, withdrawalRate: basisPoints(400) });
    const at3 = projectFire({ ...base, withdrawalRate: basisPoints(300) });

    const full = (r: typeof at4) => r.milestones.find((x) => x.kind === 'full')!.months!;
    expect(full(at3)).toBeGreaterThan(full(at4));
    expect(at4.multiple).toBe(25);
  });

  it('knows when a target is already met', () => {
    const r = projectFire({
      invested: m(2_000_000),
      monthlyContribution: m(0),
      annualSpending: m(30_000),
      realReturn: basisPoints(500),
      withdrawalRate: basisPoints(400),
    });
    expect(r.milestones.every((milestone) => milestone.reached)).toBe(true);
  });

  it('says so rather than looping forever when a target is out of reach', () => {
    expect(monthsToReach(m(100), m(1_000_000), minor(0), basisPoints(0))).toBeNull();
  });

  it('grows the trajectory year on year', () => {
    const r = projectFire({
      invested: m(10_000),
      monthlyContribution: m(500),
      annualSpending: m(24_000),
      realReturn: basisPoints(500),
      withdrawalRate: basisPoints(400),
    });
    expect(r.trajectory[0]?.balance).toBe(m(10_000));
    for (let i = 1; i < r.trajectory.length; i++) {
      expect(r.trajectory[i]!.balance).toBeGreaterThan(r.trajectory[i - 1]!.balance);
    }
  });

  it('asks for less to coast than to stop outright', () => {
    const r = projectFire({
      invested: m(50_000),
      monthlyContribution: m(1000),
      annualSpending: m(30_000),
      realReturn: basisPoints(500),
      withdrawalRate: basisPoints(400),
      currentAge: 35,
      retirementAge: 65,
    });
    const coast = r.milestones.find((x) => x.kind === 'coast')!;
    const full = r.milestones.find((x) => x.kind === 'full')!;
    expect(coast.target).toBeLessThan(full.target);
  });
});
