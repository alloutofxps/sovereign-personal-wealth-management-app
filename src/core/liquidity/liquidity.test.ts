import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import { addDays, cycleDays, daysBetween, monthCycle } from './period';
import { calculateSafeToSpend, runwayInDays, type Commitment } from './safeToSpend';
import { calculatePacing, paceLabel } from './pacing';

const m = (major: number): Minor => minor(Math.round(major * 100));

/* --- cycles -------------------------------------------------------------- */

describe('the spending cycle', () => {
  it('covers the whole calendar month', () => {
    const cycle = monthCycle('2026-09-15');
    expect(cycle.start).toBe('2026-09-01');
    expect(cycle.end).toBe('2026-09-30');
    expect(cycle.totalDays).toBe(30);
    expect(cycle.elapsedDays).toBe(15);
    expect(cycle.remainingDays).toBe(16); // today counts as still to come
  });

  it('handles February, including a leap year', () => {
    expect(monthCycle('2026-02-10').totalDays).toBe(28);
    expect(monthCycle('2028-02-10').totalDays).toBe(29);
  });

  it('is right on the first and last day', () => {
    const first = monthCycle('2026-09-01');
    expect(first.elapsedDays).toBe(1);
    expect(first.remainingDays).toBe(30);

    const last = monthCycle('2026-09-30');
    expect(last.elapsedDays).toBe(30);
    expect(last.remainingDays).toBe(1);
  });

  it('lists every day exactly once', () => {
    const cycle = monthCycle('2026-09-15');
    const days = cycleDays(cycle);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-09-01');
    expect(days[29]).toBe('2026-09-30');
    expect(new Set(days).size).toBe(30);
  });

  it('counts days across a month boundary', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

/* --- safe to spend ------------------------------------------------------- */

const cycle = monthCycle('2026-09-10'); // 30 days, 21 remaining

describe('what is safe to spend', () => {
  const bills: Commitment[] = [
    { label: 'Rent', amount: m(1200), kind: 'bill', dueDate: '2026-09-28' },
    { label: 'Energy', amount: m(85), kind: 'bill', dueDate: '2026-09-20' },
  ];
  const cards: Commitment[] = [{ label: 'Your credit card', amount: m(42.35), kind: 'card' }];

  it('takes off everything already promised', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(2481.01),
      bills,
      cardBalances: cards,
      buffer: m(200),
      goalFunding: m(50),
      cycle,
    });

    // 2481.01 − 1285 bills − 42.35 card − 200 cushion − 50 set aside
    expect(result.safeToSpend).toBe(m(903.66));
    expect(result.committed).toBe(m(1327.35));
  });

  it('names every subtraction, so the figure can be opened up', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(2000),
      bills,
      cardBalances: cards,
      buffer: m(200),
      goalFunding: m(50),
      cycle,
    });

    expect(result.breakdown.map((b) => b.label)).toEqual([
      'Your credit card',
      'Rent',
      'Energy',
      'Your safety cushion',
      'Money you have already set aside',
    ]);
    // Nothing is hidden: the parts account for the whole difference.
    const subtracted = result.breakdown.reduce((s, b) => s + b.amount, 0);
    expect(result.liquidCash - subtracted).toBe(result.safeToSpend);
  });

  it('leaves out anything that is zero rather than listing a blank line', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(500),
      bills: [{ label: 'Nothing due', amount: minor(0), kind: 'bill' }],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle,
    });
    expect(result.breakdown).toEqual([]);
    expect(result.safeToSpend).toBe(m(500));
  });

  it('spreads what is left across the days that remain', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(210),
      bills: [],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle, // 21 days remaining
    });
    expect(result.dailyPace).toBe(m(10));
  });

  it('paces to payday when that comes first', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(100),
      bills: [],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle,
      daysUntilIncome: 5,
    });
    expect(result.dailyPace).toBe(m(20));
  });

  it('reports the days it actually paced over, not the days in the cycle', () => {
    // The defect this exists for: the home screen said "€20 a day for the
    // next 21 days" while the €20 had been struck over 5. Multiplied out,
    // that is £420 offered against £100 of actual money.
    const result = calculateSafeToSpend({
      liquidCash: m(100),
      bills: [],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle, // 21 days remaining
      daysUntilIncome: 5,
    });

    expect(result.paceDays).toBe(5);
    expect(result.daysRemaining).toBe(21);
    // The two figures a sentence puts together have to multiply back.
    expect(result.dailyPace * result.paceDays).toBe(result.safeToSpend);
  });

  it('paces over the whole cycle when nothing arrives before it ends', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(210),
      bills: [],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle,
    });
    expect(result.paceDays).toBe(result.daysRemaining);
  });

  it('paces over the cycle when payday falls after it anyway', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(210),
      bills: [],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle, // 21 days remaining
      daysUntilIncome: 40,
    });
    expect(result.paceDays).toBe(21);
  });

  it('never paces over nothing, even on the last day', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(210),
      bills: [],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle,
      daysUntilIncome: 0,
    });
    expect(result.paceDays).toBeGreaterThanOrEqual(1);
  });

  it('says nothing is left rather than offering a negative daily amount', () => {
    const result = calculateSafeToSpend({
      liquidCash: m(100),
      bills: [{ label: 'Rent', amount: m(900), kind: 'bill' }],
      cardBalances: [],
      buffer: minor(0),
      goalFunding: minor(0),
      cycle,
    });
    expect(result.safeToSpend).toBe(m(-800));
    expect(result.dailyPace).toBe(0);
  });

  it('never loses or invents money, whatever the inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 500_000 }), { maxLength: 8 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (cash, billAmounts, buffer, goals) => {
          const result = calculateSafeToSpend({
            liquidCash: minor(cash),
            bills: billAmounts.map((a, i) => ({
              label: `Bill ${i}`,
              amount: minor(a),
              kind: 'bill' as const,
            })),
            cardBalances: [],
            buffer: minor(buffer),
            goalFunding: minor(goals),
            cycle,
          });
          const total = billAmounts.reduce((s, a) => s + a, 0);
          expect(result.safeToSpend).toBe(minor(cash - total - buffer - goals));
          expect(Number.isSafeInteger(result.safeToSpend)).toBe(true);
        },
      ),
    );
  });
});

describe('how long the money would last', () => {
  it('answers in whole days', () => {
    expect(runwayInDays(m(3000), m(1500))).toBe(60);
    expect(runwayInDays(m(500), m(1500))).toBe(10);
  });

  it('says nothing rather than dividing by zero', () => {
    expect(runwayInDays(m(3000), minor(0))).toBeNull();
  });

  it('is zero when there is nothing spare', () => {
    expect(runwayInDays(m(-50), m(1500))).toBe(0);
  });
});

/* --- pacing -------------------------------------------------------------- */

describe('how fast the money is going', () => {
  const spend = (entries: [string, number][]) =>
    new Map(entries.map(([date, amount]) => [date, m(amount)]));

  it('compares time passed against money spent', () => {
    // Halfway through the month, with half the money gone.
    const result = calculatePacing({
      cycle: monthCycle('2026-09-15'),
      spendByDay: spend([['2026-09-05', 250]]),
      remaining: m(250),
      today: '2026-09-15',
    });

    expect(result.spent).toBe(m(250));
    expect(result.allowance).toBe(m(500));
    expect(result.spentPercent).toBe(50);
    expect(result.elapsedPercent).toBe(50);
    expect(result.status).toBe('on_track');
    expect(result.message).toContain('right on track');
  });

  it('says so calmly when spending is running fast', () => {
    const result = calculatePacing({
      cycle: monthCycle('2026-09-10'),
      spendByDay: spend([['2026-09-02', 800]]),
      remaining: m(200),
      today: '2026-09-10',
    });

    expect(result.status).toBe('fast');
    expect(paceLabel(result.status)).toBe('Running a bit fast');
    // Calm, forward-looking, and no scolding anywhere in it.
    expect(result.message).toMatch(/adjusted to fit/);
    expect(result.message).not.toMatch(/over budget|overspent|warning|failed/i);
  });

  it('notices when there is more room than usual', () => {
    const result = calculatePacing({
      cycle: monthCycle('2026-09-25'),
      spendByDay: spend([['2026-09-02', 100]]),
      remaining: m(900),
      today: '2026-09-25',
    });
    expect(result.status).toBe('ahead');
    expect(result.message).toContain('more slowly');
  });

  it('does not pretend to have a plan before there is one', () => {
    const result = calculatePacing({
      cycle: monthCycle('2026-09-10'),
      spendByDay: new Map(),
      remaining: minor(0),
      today: '2026-09-10',
    });
    expect(result.status).toBe('no_plan');
    expect(result.spentPercent).toBe(0);
  });

  it('builds a curve that only rises on days that have happened', () => {
    const result = calculatePacing({
      cycle: monthCycle('2026-09-10'),
      spendByDay: spend([
        ['2026-09-02', 40],
        ['2026-09-05', 60],
      ]),
      remaining: m(400),
      today: '2026-09-10',
    });

    expect(result.curve).toHaveLength(30);
    expect(result.curve[0]?.cumulative).toBe(0);
    expect(result.curve[1]?.cumulative).toBe(m(40));
    expect(result.curve[4]?.cumulative).toBe(m(100));
    // Flat from today onwards — the future is not guessed at.
    expect(result.curve[9]?.cumulative).toBe(m(100));
    expect(result.curve[29]?.cumulative).toBe(m(100));
    expect(result.curve[9]?.actual).toBe(true);
    expect(result.curve[10]?.actual).toBe(false);
  });

  it('draws an even-spread line that reaches the allowance on the last day', () => {
    const result = calculatePacing({
      cycle: monthCycle('2026-09-10'),
      spendByDay: spend([['2026-09-02', 100]]),
      remaining: m(500),
      today: '2026-09-10',
    });
    expect(result.curve.at(-1)?.target).toBe(result.allowance);
    expect(result.curve[0]?.target).toBe(m(20)); // 600 over 30 days
  });

  it('never rises after today, whatever is recorded in the future', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 50_000 }), { maxLength: 30 }), (amounts) => {
        const cyc = monthCycle('2026-09-15');
        const days = cycleDays(cyc);
        const byDay = new Map(amounts.map((a, i) => [days[i] ?? days[0]!, minor(a)]));
        const result = calculatePacing({
          cycle: cyc,
          spendByDay: byDay,
          remaining: m(100),
          today: '2026-09-15',
        });
        const future = result.curve.filter((p) => !p.actual);
        for (const point of future) {
          expect(point.cumulative).toBe(result.spent);
        }
      }),
    );
  });
});
