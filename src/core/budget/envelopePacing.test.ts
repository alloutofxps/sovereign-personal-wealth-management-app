import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  AHEAD_NOTICE_BP,
  describePace,
  envelopePace,
  paceTone,
  type EnvelopePace,
} from './envelopePacing';

const pace = (assigned: number, spent: number, progressBp: number): EnvelopePace =>
  envelopePace({
    assignedMinor: minor(assigned),
    activityMinor: minor(spent),
    periodProgressBp: progressBp,
  });

describe('where a pot stands', () => {
  it('takes the fraction spent exactly', () => {
    // €40 of a €200 pot is a fifth.
    expect(pace(20_000, 4_000, 5_000).spentPercentBp).toBe(2_000);
  });

  it('reads the gap between money and time', () => {
    // 80% spent, 30% of the month gone: fifty points ahead.
    const p = pace(20_000, 16_000, 3_000);
    expect(p.spentPercentBp).toBe(8_000);
    expect(p.paceDeltaBp).toBe(5_000);
    expect(p.status).toBe('ahead_of_pace');
  });

  it('calls the same spending unremarkable late in the month', () => {
    // 80% spent with 78% of the month gone is somebody using their budget.
    expect(pace(20_000, 16_000, 7_800).status).toBe('on_pace');
  });

  it('notices comfortable spending too', () => {
    expect(pace(20_000, 2_000, 5_000).status).toBe('under_pace');
  });

  it('separates untouched from merely slow', () => {
    expect(pace(20_000, 0, 5_000).status).toBe('unspent');
    expect(pace(20_000, 1, 5_000).status).toBe('under_pace');
  });
});

describe('the boundaries', () => {
  it('stays quiet one point inside the margin, and speaks one point outside', () => {
    // The margin exists because a weekly shop landing on a Tuesday rather than
    // a Thursday moves a food budget by more than a few points.
    // A €100 pot: one minor unit is one basis point, so the sums are direct.
    const inside = pace(10_000, 1_500 + AHEAD_NOTICE_BP - 1, 1_500);
    const outside = pace(10_000, 1_500 + AHEAD_NOTICE_BP, 1_500);

    expect(inside.paceDeltaBp).toBeLessThan(AHEAD_NOTICE_BP);
    expect(inside.status).toBe('on_pace');
    expect(outside.paceDeltaBp).toBeGreaterThanOrEqual(AHEAD_NOTICE_BP);
    expect(outside.status).toBe('ahead_of_pace');
  });

  it('is exactly on pace when money and time agree', () => {
    expect(pace(20_000, 10_000, 5_000).paceDeltaBp).toBe(0);
    expect(pace(20_000, 10_000, 5_000).status).toBe('on_pace');
  });

  it('knows when a pot is spent, to the penny', () => {
    expect(pace(20_000, 20_000, 5_000).exhausted).toBe(true);
    // One cent short is not spent, even though the percentage rounds to 100.
    expect(pace(20_000, 19_999, 5_000).spentPercentBp).toBe(10_000);
    expect(pace(20_000, 19_999, 5_000).exhausted).toBe(false);
  });

  it('handles an overspent pot without breaking', () => {
    const p = pace(10_000, 16_870, 6_000);
    expect(p.spentPercentBp).toBe(16_870);
    expect(p.exhausted).toBe(true);
    expect(p.status).toBe('ahead_of_pace');
  });

  it('names a pot with spending and no budget rather than dividing by nothing', () => {
    const p = pace(0, 5_000, 5_000);
    expect(p.status).toBe('unbudgeted');
    expect(p.spentPercentBp).toBe(0);
    expect(p.exhausted).toBe(true);
  });

  it('clamps a period progress outside its range', () => {
    expect(pace(10_000, 5_000, -400).periodProgressBp).toBe(0);
    expect(pace(10_000, 5_000, 99_999).periodProgressBp).toBe(10_000);
  });

  it('treats money coming back as nothing spent rather than negative', () => {
    // A refund can push activity below zero. That is not "minus 20% spent".
    expect(pace(10_000, -2_000, 5_000).spentPercentBp).toBe(0);
  });
});

describe('what it says', () => {
  it('states both fractions and stops', () => {
    const sentence = describePace(pace(20_000, 16_000, 3_000), 'Eating out');
    expect(sentence).toBe('80% of Eating out is spent, with 30% of the period gone.');
  });

  it('says a spent pot is spent, and how long is left', () => {
    expect(describePace(pace(20_000, 20_000, 4_000), 'Eating out')).toBe(
      'Eating out is spent, with 60% of the period still to go.',
    );
  });

  it('never tells anybody to slow down or praises them for not spending', () => {
    const sentences = [
      describePace(pace(20_000, 18_000, 2_000), 'Fun'),
      describePace(pace(20_000, 1_000, 8_000), 'Fun'),
      describePace(pace(20_000, 0, 5_000), 'Fun'),
      describePace(pace(0, 500, 5_000), 'Fun'),
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(/slow down|careful|too much|well done|good job|should/i);
    }
  });
});

describe('tone', () => {
  it('never reaches for the tone that means something is wrong', () => {
    // Spending your own money faster than a calendar is not a fault.
    const all = [
      pace(20_000, 19_000, 1_000),
      pace(20_000, 25_000, 1_000),
      pace(20_000, 0, 9_000),
      pace(0, 1_000, 5_000),
    ];
    for (const p of all) expect(paceTone(p)).not.toBe('deficit');
  });

  it('uses amber only when spending is genuinely ahead', () => {
    expect(paceTone(pace(20_000, 16_000, 3_000))).toBe('caution');
    expect(paceTone(pace(20_000, 10_000, 5_000))).toBe('neutral');
    expect(paceTone(pace(20_000, 2_000, 5_000))).toBe('liquid');
  });
});

describe('properties', () => {
  it('the delta is always the two fractions subtracted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (assigned, spent, progress) => {
          const p = pace(assigned, spent, progress);
          expect(p.paceDeltaBp).toBe(p.spentPercentBp - p.periodProgressBp);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('spending more is never scored as spending less', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 1, max: 500_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (assigned, spent, extra, progress) => {
          const less = pace(assigned, spent, progress);
          const more = pace(assigned, spent + extra, progress);
          expect(more.spentPercentBp).toBeGreaterThanOrEqual(less.spentPercentBp);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never returns a status outside the five it defines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: -100_000, max: 2_000_000 }),
        fc.integer({ min: -5_000, max: 20_000 }),
        (assigned, spent, progress) => {
          const p = pace(assigned, spent, progress);
          expect([
            'unbudgeted',
            'unspent',
            'under_pace',
            'on_pace',
            'ahead_of_pace',
          ]).toContain(p.status);
          expect(p.periodProgressBp).toBeGreaterThanOrEqual(0);
          expect(p.periodProgressBp).toBeLessThanOrEqual(10_000);
          expect(p.spentPercentBp).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
