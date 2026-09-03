import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor } from '@/core/money';
import {
  CADENCE_LABELS,
  daysInMonth,
  describeSchedule,
  monthsAfter,
  occurrencesWithin,
  semiMonthlyDays,
  type Cadence,
} from './occurrences';
import {
  detectDormantSubscriptions,
  detectPriceCreep,
  inferRecurringCandidates,
  worthMentioning,
  type HistoricalPayment,
} from './surveillance';

const item = (cadence: Cadence, nextDue: string, amount = 1000) => ({
  cadence,
  nextDue,
  amount: minor(amount),
});

const dates = (o: { date: string }[]) => o.map((x) => x.date);

/* ===========================================================================
 * CALENDARS ARE NOT ARITHMETIC
 * ======================================================================== */

describe('stepping through months without drifting', () => {
  it('knows how long each month is, leap years included', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    // 2100 is divisible by 4 but is not a leap year.
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it('clamps the 31st into shorter months without spilling over', () => {
    expect(monthsAfter('2026-01-31', 1)).toBe('2026-02-28');
    expect(monthsAfter('2026-01-31', 3)).toBe('2026-04-30');
    expect(monthsAfter('2026-01-31', 5)).toBe('2026-06-30');
  });

  it('comes back to the 31st rather than sticking at the clamped day', () => {
    // The bug this prevents: stepping from the *previous* result means once a
    // bill clamps to the 28th in February it stays on the 28th forever, and
    // three days a month quietly move between periods.
    expect(monthsAfter('2026-01-31', 2)).toBe('2026-03-31');
    expect(monthsAfter('2026-01-31', 4)).toBe('2026-05-31');
  });

  it('brings a 29 February anchor back every leap year', () => {
    expect(monthsAfter('2028-02-29', 12)).toBe('2029-02-28');
    expect(monthsAfter('2028-02-29', 24)).toBe('2030-02-28');
    expect(monthsAfter('2028-02-29', 48)).toBe('2032-02-29');
  });

  it('crosses year boundaries in both directions', () => {
    expect(monthsAfter('2026-11-15', 3)).toBe('2027-02-15');
    expect(monthsAfter('2026-02-15', -3)).toBe('2025-11-15');
  });
});

describe('semi-monthly, the way payroll actually means it', () => {
  it('anchored on the 15th, pays the 15th and the last day', () => {
    expect(semiMonthlyDays(15, 2026, 1)).toEqual([15, 31]);
    expect(semiMonthlyDays(15, 2026, 2)).toEqual([15, 28]);
    expect(semiMonthlyDays(15, 2028, 2)).toEqual([15, 29]);
    expect(semiMonthlyDays(15, 2026, 4)).toEqual([15, 30]);
  });

  it('anchored on the 1st, pays the 1st and the 15th', () => {
    expect(semiMonthlyDays(1, 2026, 2)).toEqual([1, 15]);
  });

  it('generates exactly 24 occurrences in a year', () => {
    const found = occurrencesWithin(item('semimonthly', '2026-01-15'), '2026-01-01', '2026-12-31');
    expect(found).toHaveLength(24);
  });

  it('generates 48 across a two-year window, leap year included', () => {
    const found = occurrencesWithin(item('semimonthly', '2027-01-15'), '2027-01-01', '2028-12-31');
    expect(found).toHaveLength(48);
  });

  it('lands on the 15th and the end of February, whichever kind of year', () => {
    const normal = dates(
      occurrencesWithin(item('semimonthly', '2026-01-15'), '2026-02-01', '2026-02-28'),
    );
    expect(normal).toEqual(['2026-02-15', '2026-02-28']);

    const leap = dates(
      occurrencesWithin(item('semimonthly', '2028-01-15'), '2028-02-01', '2028-02-29'),
    );
    expect(leap).toEqual(['2028-02-15', '2028-02-29']);
  });

  it('never starts before the schedule itself does', () => {
    const found = dates(
      occurrencesWithin(item('semimonthly', '2026-01-15'), '2026-01-01', '2026-01-31'),
    );
    expect(found).toEqual(['2026-01-15', '2026-01-31']);
  });
});

describe('every other cadence', () => {
  it('counts a weekly bill as every week inside the window', () => {
    const found = occurrencesWithin(item('weekly', '2026-09-01'), '2026-09-01', '2026-09-30');
    expect(found).toHaveLength(5);
  });

  it('counts a fortnightly payday correctly across a month', () => {
    const found = dates(occurrencesWithin(item('biweekly', '2026-09-04'), '2026-09-01', '2026-10-31'));
    expect(found).toEqual(['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30']);
  });

  it('handles daily, quarterly and annual', () => {
    expect(occurrencesWithin(item('daily', '2026-09-01'), '2026-09-01', '2026-09-07')).toHaveLength(7);
    expect(
      dates(occurrencesWithin(item('quarterly', '2026-01-31'), '2026-01-01', '2026-12-31')),
    ).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    expect(
      dates(occurrencesWithin(item('annual', '2026-02-29'), '2026-01-01', '2030-12-31')),
    ).toContain('2028-02-29');
  });

  it('snaps a monthly bill on the 31st to the end of every short month', () => {
    const found = dates(occurrencesWithin(item('monthly', '2026-01-31'), '2026-01-01', '2026-06-30'));
    expect(found).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('returns nothing for a window that ends before it starts', () => {
    expect(occurrencesWithin(item('monthly', '2026-01-01'), '2026-06-01', '2026-01-01')).toEqual([]);
  });

  it('never produces a date outside the window it was asked for', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Cadence>('daily', 'weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual'),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 400 }),
        (cadence, day, windowDays) => {
          const start = '2026-03-10';
          const end = addIso(start, windowDays);
          const anchor = `2026-01-${String(day).padStart(2, '0')}`;

          for (const occurrence of occurrencesWithin(item(cadence, anchor), start, end)) {
            expect(occurrence.date >= start).toBe(true);
            expect(occurrence.date <= end).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('describes itself in a sentence', () => {
    expect(describeSchedule('semimonthly', '2026-01-15')).toBe(
      'Billed on the 15th and the last day of every month.',
    );
    expect(describeSchedule('semimonthly', '2026-01-01')).toBe(
      'Billed on the 1st and the 15th of every month.',
    );
    expect(describeSchedule('monthly', '2026-01-31')).toMatch(/last day in a shorter month/);
    expect(describeSchedule('monthly', '2026-01-03')).toBe('Billed on the 3rd of every month.');
    expect(CADENCE_LABELS.biweekly).toBe('Every two weeks');
  });
});

function addIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* ===========================================================================
 * SURVEILLANCE
 * ======================================================================== */

describe('noticing a subscription has gone up', () => {
  const netflix = { id: 'sub-1', name: 'Netflix', expectedAmount: minor(1399) };

  it('flags a charge above the expected amount', () => {
    const change = detectPriceCreep(netflix, minor(1599));
    expect(change).not.toBeNull();
    expect(change!.increase).toBe(200);
    // 200/1399 is 14.3%, in basis points.
    expect(change!.increaseBp).toBe(1430);
    expect(change!.annualisedIncrease).toBe(2400);
  });

  it('says nothing when the price is the same', () => {
    expect(detectPriceCreep(netflix, minor(1399))).toBeNull();
  });

  it('says nothing when the price went down', () => {
    // Good news is not an interruption.
    expect(detectPriceCreep(netflix, minor(999))).toBeNull();
  });

  it('ignores a rounding-sized wobble on a variable bill', () => {
    const energy = { id: 'sub-2', name: 'Energy', expectedAmount: minor(8000) };
    const tiny = detectPriceCreep(energy, minor(8010))!;
    expect(worthMentioning(tiny)).toBe(false);

    const real = detectPriceCreep(energy, minor(9500))!;
    expect(worthMentioning(real)).toBe(true);
  });

  it('refuses to divide by an expected amount of nothing', () => {
    expect(detectPriceCreep({ id: 'x', name: 'x', expectedAmount: minor(0) }, minor(500))).toBeNull();
  });
});

describe('noticing a subscription nobody uses', () => {
  const sub = {
    id: 'sub-1',
    name: 'Gym',
    expectedAmount: minor(2999),
    amount: minor(2999),
    timesPerYear: 12,
  };

  it('flags one that has been quiet for two months', () => {
    const found = detectDormantSubscriptions(
      [sub],
      [{ itemId: 'sub-1', lastActivity: '2026-07-01', dismissedAt: null }],
      '2026-09-30',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.weeksQuiet).toBeGreaterThanOrEqual(8);
  });

  it('leaves a recently used one alone', () => {
    const found = detectDormantSubscriptions(
      [sub],
      [{ itemId: 'sub-1', lastActivity: '2026-09-20', dismissedAt: null }],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('stays quiet once the person has said they are happy with it', () => {
    const found = detectDormantSubscriptions(
      [sub],
      [{ itemId: 'sub-1', lastActivity: '2026-01-01', dismissedAt: '2026-09-01T00:00:00.000Z' }],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('never judges a quarterly or annual bill on eight weeks of quiet', () => {
    // An annual bill is supposed to look dormant. Flagging it would be noise.
    const annual = { ...sub, id: 'sub-2', timesPerYear: 1 };
    const found = detectDormantSubscriptions(
      [annual],
      [{ itemId: 'sub-2', lastActivity: '2026-01-01', dismissedAt: null }],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });
});

describe('spotting subscriptions that were never written down', () => {
  const pay = (merchant: string, date: string, amount: number): HistoricalPayment => ({
    merchant,
    date,
    amount: minor(amount),
  });

  it('suggests one after three monthly charges of the same amount', () => {
    const found = inferRecurringCandidates(
      [
        pay('SPOTIFY', '2026-07-03', 999),
        pay('SPOTIFY', '2026-08-03', 999),
        pay('SPOTIFY', '2026-09-03', 999),
      ],
      [],
      '2026-09-30',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.merchant).toBe('SPOTIFY');
    expect(found[0]?.amount).toBe(999);
    expect(found[0]?.cadenceGuess).toBe('monthly');
    expect(found[0]?.occurrences).toBe(3);
  });

  it('needs three, because two only make one gap', () => {
    const found = inferRecurringCandidates(
      [pay('SPOTIFY', '2026-08-03', 999), pay('SPOTIFY', '2026-09-03', 999)],
      [],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('tolerates a billing date that slips a day or two', () => {
    // 33 days then 29: a weekend either side of the nominal month.
    const found = inferRecurringCandidates(
      [
        pay('GYM', '2026-07-05', 2500),
        pay('GYM', '2026-08-07', 2500),
        pay('GYM', '2026-09-05', 2500),
      ],
      [],
      '2026-09-30',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.cadenceGuess).toBe('monthly');
  });

  it('only counts charges inside the window it was given', () => {
    // Worth stating outright: ninety days holds three monthly charges with
    // about a month to spare, so a subscription billed on the 1st is found
    // from its third charge onward — but one charge falling a day outside the
    // window drops the count to two and nothing is suggested. The boundary is
    // sharp, and the window is a parameter for exactly that reason.
    const charges = (first: string, second: string, third: string) =>
      inferRecurringCandidates(
        [pay('SPOTIFY', first, 999), pay('SPOTIFY', second, 999), pay('SPOTIFY', third, 999)],
        [],
        '2026-09-30',
      );

    // 2026-07-02 is exactly ninety days back, and counts.
    expect(charges('2026-07-02', '2026-08-02', '2026-09-02')).toHaveLength(1);
    // One day earlier is outside, leaving only two charges and no rhythm.
    expect(charges('2026-07-01', '2026-08-01', '2026-09-01')).toEqual([]);
    // Unless the caller widens the window.
    expect(
      inferRecurringCandidates(
        [
          pay('SPOTIFY', '2026-07-01', 999),
          pay('SPOTIFY', '2026-08-01', 999),
          pay('SPOTIFY', '2026-09-01', 999),
        ],
        [],
        '2026-09-30',
        120,
      ),
    ).toHaveLength(1);
  });

  it('ignores a merchant whose amounts jump around', () => {
    // Three trips to the supermarket a month apart is not a subscription.
    const found = inferRecurringCandidates(
      [
        pay('TESCO', '2026-07-03', 4235),
        pay('TESCO', '2026-08-03', 9100),
        pay('TESCO', '2026-09-03', 1250),
      ],
      [],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('ignores charges that arrive on no rhythm at all', () => {
    const found = inferRecurringCandidates(
      [
        pay('SHOP', '2026-07-01', 999),
        pay('SHOP', '2026-07-04', 999),
        pay('SHOP', '2026-09-20', 999),
      ],
      [],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('does not suggest something already written down', () => {
    const found = inferRecurringCandidates(
      [
        pay('SPOTIFY', '2026-07-03', 999),
        pay('SPOTIFY', '2026-08-03', 999),
        pay('SPOTIFY', '2026-09-03', 999),
      ],
      ['spotify'],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('only looks at the recent past', () => {
    const found = inferRecurringCandidates(
      [
        pay('OLD', '2025-01-03', 999),
        pay('OLD', '2025-02-03', 999),
        pay('OLD', '2025-03-03', 999),
      ],
      [],
      '2026-09-30',
    );
    expect(found).toEqual([]);
  });

  it('recognises a weekly rhythm too', () => {
    const found = inferRecurringCandidates(
      [
        pay('COFFEE SUB', '2026-09-01', 500),
        pay('COFFEE SUB', '2026-09-08', 500),
        pay('COFFEE SUB', '2026-09-15', 500),
        pay('COFFEE SUB', '2026-09-22', 500),
      ],
      [],
      '2026-09-30',
    );
    expect(found[0]?.cadenceGuess).toBe('weekly');
    expect(found[0]?.intervalDays).toBe(7);
  });
});
