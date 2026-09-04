import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  MILESTONE_MAJORS,
  buildNetWorthHistory,
  describeMilestone,
  describeTrajectory,
  endOfMonth,
  findMilestones,
  latestMilestone,
  monthsBetween,
  reachedMilestones,
  summariseTrajectory,
  type HistoryPosting,
} from './index';

const asset = (date: string, amount: number): HistoryPosting => ({
  date,
  baseAmount: minor(amount),
  side: 'ASSET',
});

/** Liabilities carry credit balances, so borrowing is a negative posting. */
const liability = (date: string, amount: number): HistoryPosting => ({
  date,
  baseAmount: minor(amount),
  side: 'LIABILITY',
});

/** A stand-in for the household's formatter, grouped the way a real one is. */
const euro = (amount: number) =>
  `€${(amount / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe('walking the months', () => {
  it('lists every month in the range, inclusive', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('handles a single month and an inverted range', () => {
    expect(monthsBetween('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(monthsBetween('2026-05', '2026-03')).toEqual([]);
  });

  it('knows how long each month is, leap years included', () => {
    expect(endOfMonth('2026-02')).toBe('2026-02-28');
    expect(endOfMonth('2028-02')).toBe('2028-02-29');
    expect(endOfMonth('2026-04')).toBe('2026-04-30');
    expect(endOfMonth('2026-12')).toBe('2026-12-31');
  });
});

describe('the net worth line', () => {
  it('has nothing to draw from nothing', () => {
    expect(buildNetWorthHistory([])).toEqual([]);
  });

  it('accumulates, so each month carries everything before it', () => {
    const points = buildNetWorthHistory([
      asset('2026-01-15', 100_000),
      asset('2026-02-10', 50_000),
      asset('2026-03-01', 25_000),
    ]);

    expect(points.map((p) => p.netWorth)).toEqual([100_000, 150_000, 175_000]);
    expect(points.map((p) => p.month)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('reports what is owed as a positive number, the way people say it', () => {
    const points = buildNetWorthHistory([
      asset('2026-01-15', 30_000_000),
      liability('2026-01-15', -20_000_000),
    ]);

    expect(points[0]!.assets).toBe(30_000_000);
    expect(points[0]!.liabilities).toBe(20_000_000);
    expect(points[0]!.netWorth).toBe(10_000_000);
  });

  it('draws a point for a quiet month rather than leaving a gap', () => {
    const points = buildNetWorthHistory([asset('2026-01-15', 100_000), asset('2026-04-01', 50_000)]);

    expect(points).toHaveLength(4);
    expect(points[1]!.month).toBe('2026-02');
    expect(points[1]!.netWorth).toBe(100_000);
    expect(points[1]!.change).toBe(0);
  });

  it('records the change from the month before', () => {
    const points = buildNetWorthHistory([
      asset('2026-01-15', 100_000),
      asset('2026-02-10', 50_000),
      asset('2026-03-01', -20_000),
    ]);

    expect(points.map((p) => p.change)).toEqual([0, 50_000, -20_000]);
  });

  it('carries everything before the window into its first point', () => {
    // A chart starting in 2026 must not forget a house bought in 2019.
    const points = buildNetWorthHistory(
      [asset('2019-06-01', 25_000_000), asset('2026-02-01', 100_000)],
      { from: '2026-01-01' },
    );

    expect(points[0]!.month).toBe('2026-01');
    expect(points[0]!.netWorth).toBe(25_000_000);
    expect(points[1]!.netWorth).toBe(25_100_000);
  });

  it('runs on to a month asked for even when nothing happened in it', () => {
    const points = buildNetWorthHistory([asset('2026-01-15', 100_000)], { through: '2026-06-30' });

    expect(points).toHaveLength(6);
    expect(points[5]!.month).toBe('2026-06');
    expect(points[5]!.netWorth).toBe(100_000);
  });

  it('dates each point at the end of its month', () => {
    const points = buildNetWorthHistory([asset('2026-02-03', 100_000)]);
    expect(points[0]!.asOf).toBe('2026-02-28');
  });
});

describe('what the line did', () => {
  const points = buildNetWorthHistory([
    asset('2026-01-15', 1_000_000),
    asset('2026-02-10', 200_000),
    asset('2026-03-01', -50_000),
    asset('2026-04-01', 350_000),
  ]);

  it('sums the whole window and averages the months in it', () => {
    const summary = summariseTrajectory(points)!;

    expect(summary.change).toBe(500_000);
    // Three months of change across four points.
    expect(summary.averageMonthlyChange).toBe(166_667);
  });

  it('names the best and worst months', () => {
    const summary = summariseTrajectory(points)!;

    expect(summary.bestMonth!.month).toBe('2026-04');
    expect(summary.worstMonth!.month).toBe('2026-03');
    expect(summary.monthsUp).toBe(2);
    expect(summary.monthsDown).toBe(1);
  });

  it('has nothing to summarise from nothing', () => {
    expect(summariseTrajectory([])).toBeNull();
  });

  it('describes the line without judging it', () => {
    const sentence = describeTrajectory(summariseTrajectory(points), euro);

    expect(sentence).toContain('€5,000.00');
    expect(sentence).toContain('a month');
    expect(sentence).not.toMatch(/should|good|bad|behind|on track|well done/i);
  });

  it('says so plainly when there is only one month', () => {
    const single = buildNetWorthHistory([asset('2026-01-15', 100_000)]);
    expect(describeTrajectory(summariseTrajectory(single), euro)).toContain(
      'more than one month',
    );
  });

  it('has a sentence for having nothing at all', () => {
    expect(describeTrajectory(null, euro)).toContain('nothing recorded yet');
  });
});

describe('the round numbers', () => {
  const points = buildNetWorthHistory([
    asset('2026-01-15', 800_000),
    asset('2026-02-15', 400_000),
    asset('2026-03-15', 1_500_000),
  ]);

  it('finds the month each was first passed', () => {
    const milestones = findMilestones(points);
    const tenK = milestones.find((m) => m.major === 10_000)!;
    const twentyFiveK = milestones.find((m) => m.major === 25_000)!;

    expect(tenK.reachedMonth).toBe('2026-02');
    expect(tenK.reachedOn).toBe('2026-02-28');
    expect(twentyFiveK.reachedMonth).toBe('2026-03');
  });

  it('leaves the ones not yet passed empty rather than guessing at them', () => {
    const hundredK = findMilestones(points).find((m) => m.major === 100_000)!;

    expect(hundredK.reachedMonth).toBeNull();
    expect(hundredK.monthsFromStart).toBeNull();
  });

  it('keeps the first crossing, not the most recent one', () => {
    // Crossed €10k, dropped below buying a car, crossed again.
    const wobbly = buildNetWorthHistory([
      asset('2026-01-15', 1_200_000),
      asset('2026-02-15', -400_000),
      asset('2026-03-15', 600_000),
    ]);

    expect(findMilestones(wobbly).find((m) => m.major === 10_000)!.reachedMonth).toBe('2026-01');
  });

  it('lists what has been passed, largest first', () => {
    const reached = reachedMilestones(findMilestones(points));

    expect(reached.map((m) => m.major)).toEqual([25_000, 10_000]);
    expect(latestMilestone(findMilestones(points))!.major).toBe(25_000);
  });

  it('has no latest milestone when none has been passed', () => {
    const small = buildNetWorthHistory([asset('2026-01-15', 5_000)]);
    expect(latestMilestone(findMilestones(small))).toBeNull();
  });

  it('states what was passed and when, and nothing more', () => {
    const milestone = latestMilestone(findMilestones(points))!;
    const sentence = describeMilestone(milestone, euro, (d) => `March ${d.slice(0, 4)}`);

    expect(sentence).toBe('You passed €25,000.00 in March 2026.');
    expect(sentence).not.toMatch(/congratulations|great|amazing|keep it up|well done/i);
  });

  it('says plainly when one has not been reached', () => {
    const milestone = findMilestones(points).find((m) => m.major === 1_000_000)!;
    const sentence = describeMilestone(milestone, euro, (d) => d);

    expect(sentence).toContain('has not been passed yet');
  });

  it('scales to a currency with a different minor unit', () => {
    // ¥10,000 is 10,000 minor units, not 1,000,000.
    const yen = buildNetWorthHistory([asset('2026-01-15', 12_000)]);
    expect(findMilestones(yen, 1).find((m) => m.major === 10_000)!.reachedMonth).toBe('2026-01');
  });

  it('sets no targets and ranks nothing beyond what has happened', () => {
    // The thresholds are landmarks, not goals: nothing here says how close
    // anybody is to the next one.
    expect(MILESTONE_MAJORS).toEqual([10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]);
    expect(Object.keys(findMilestones(points)[0]!)).not.toContain('progress');
  });
});

/* ===========================================================================
 * THE CONSERVATION PROPERTY
 * ---------------------------------------------------------------------------
 * The last point of the line has to equal the sum of every posting ever made,
 * or the chart and the balance sheet are telling different stories about the
 * same person.
 * ======================================================================== */

describe('conservation', () => {
  it('ends where the postings add up to, for any set of them', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            year: fc.integer({ min: 2020, max: 2029 }),
            month: fc.integer({ min: 1, max: 12 }),
            day: fc.integer({ min: 1, max: 28 }),
            amount: fc.integer({ min: -5_000_000, max: 5_000_000 }),
            isAsset: fc.boolean(),
          }),
          { minLength: 1, maxLength: 60 },
        ),
        (rows) => {
          const postings: HistoryPosting[] = rows.map((r) => ({
            date: `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
            baseAmount: minor(r.amount),
            side: r.isAsset ? 'ASSET' : 'LIABILITY',
          }));

          const points = buildNetWorthHistory(postings);
          const last = points[points.length - 1]!;

          const assets = postings
            .filter((p) => p.side === 'ASSET')
            .reduce((total, p) => total + p.baseAmount, 0);
          const liabilities = postings
            .filter((p) => p.side === 'LIABILITY')
            .reduce((total, p) => total + p.baseAmount, 0);

          expect(last.assets).toBe(assets);
          expect(last.liabilities).toBe(0 - liabilities);
          expect(last.netWorth).toBe(assets + liabilities);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('has every change equal the step between its neighbours', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            month: fc.integer({ min: 1, max: 12 }),
            amount: fc.integer({ min: -1_000_000, max: 1_000_000 }),
          }),
          { minLength: 2, maxLength: 40 },
        ),
        (rows) => {
          const points = buildNetWorthHistory(
            rows.map((r) => asset(`2026-${String(r.month).padStart(2, '0')}-15`, r.amount)),
          );

          for (let i = 1; i < points.length; i++) {
            expect(points[i]!.change).toBe(points[i]!.netWorth - points[i - 1]!.netWorth);
          }
          expect(points[0]!.change).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
