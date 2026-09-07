import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import {
  branchLabel,
  branchView,
  checkBranch,
  compare,
  describeDifference,
  type Branch,
  type BranchEntry,
} from './branching';
import { buildEntry, credit, debit } from './entries/common';
import { accountId, entryId, isoDate, type EntryKind, type Posting } from './types';
import type { JournalEntry } from './types';

const m = (major: number): Minor => minor(Math.round(major * 100));
const fmt = (a: Minor) => (a / 100).toFixed(2);

const CASH = accountId('acc-current');
const RENT = accountId('cat-rent');

const branch: Branch = {
  id: 'br-1',
  name: 'If I took the Rotterdam job',
  divergesOn: isoDate('2026-10-01'),
  note: null,
  createdAt: '2026-09-07T10:00:00Z',
};

/**
 * Full postings, built the way the application builds them.
 *
 * `debit`/`credit` return specs, not postings — they carry no `baseAmount`,
 * which is the figure every balance check is asserted on. Handing specs
 * straight to `assertBalanced` sums to NaN, which is how this test found out.
 */
function postingsFor(amount: Minor, kind: EntryKind = 'SPEND'): Posting[] {
  return buildEntry(
    { id: entryId('scratch'), date: isoDate('2026-11-01') },
    kind,
    'scratch',
    [debit('FINANCIAL', RENT, amount), credit('FINANCIAL', CASH, amount)],
  ).postings;
}

function sketch(over: Partial<BranchEntry> = {}): BranchEntry {
  return {
    id: 'be-1',
    branchId: 'br-1',
    kind: 'SPEND',
    date: isoDate('2026-11-01'),
    description: 'Rent in the new place.',
    postings: postingsFor(m(1_200)),
    ...over,
  };
}

function real(date: string, amount: Minor): JournalEntry {
  return buildEntry(
    { id: entryId(`real-${date}`), date: isoDate(date) },
    'SPEND',
    'What actually happened.',
    [debit('FINANCIAL', RENT, amount), credit('FINANCIAL', CASH, amount)],
  );
}

/* ===========================================================================
 * WHETHER A SKETCH HOLDS TOGETHER
 * ======================================================================== */

describe('checking a what-if', () => {
  it('is happy with a balanced entry after the divergence', () => {
    expect(checkBranch(branch, [sketch()])).toEqual([]);
  });

  it('refuses one dated before the what-if starts', () => {
    // A branch is an alternative future, never an alternative past. Letting
    // one rewrite last March would invalidate statement checks already made.
    const problems = checkBranch(branch, [sketch({ date: isoDate('2026-08-01') })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('2026-10-01');
    expect(problems[0]?.message).toMatch(/what actually happened/);
  });

  it('refuses one that does not add up, by the same rule a real entry obeys', () => {
    const problems = checkBranch(branch, [
      sketch({
        postings: [
          ...postingsFor(m(1_200)).slice(0, 1),
          ...postingsFor(m(900)).slice(1, 2),
        ],
      }),
    ]);
    expect(problems).toHaveLength(1);
  });

  it('refuses one belonging to a different what-if', () => {
    const problems = checkBranch(branch, [sketch({ branchId: 'br-other' })]);
    expect(problems[0]?.message).toMatch(/different what-if/);
  });

  it('collects every fault rather than stopping at the first', () => {
    // A sketch is built over several sittings. Refusing at the first fault and
    // saying nothing about the rest makes fixing it a guessing game.
    const problems = checkBranch(branch, [
      sketch({ id: 'a', date: isoDate('2026-01-01') }),
      sketch({ id: 'b', branchId: 'br-other' }),
      sketch({
        id: 'c',
        postings: [...postingsFor(m(5)).slice(0, 1), ...postingsFor(m(4)).slice(1, 2)],
      }),
    ]);
    expect(problems.map((p) => p.entryId)).toEqual(['a', 'b', 'c']);
  });
});

/* ===========================================================================
 * LAYING ONE OVER THE OTHER
 * ======================================================================== */

describe('the imagined household', () => {
  const history = [real('2026-06-01', m(1_000)), real('2026-09-01', m(1_000))];

  it('keeps every real entry, whole', () => {
    const view = branchView(history, branch, [sketch()]);
    for (const entry of history) {
      expect(view.entries).toContainEqual(entry);
    }
  });

  it('adds the hypothetical ones and says how many', () => {
    const view = branchView(history, branch, [sketch(), sketch({ id: 'be-2' })]);
    expect(view.entries).toHaveLength(4);
    expect(view.hypotheticalCount).toBe(2);
  });

  it('leaves out anything the check refused', () => {
    // The important one. A sketch dated into the real past must not silently
    // become part of the history it was rejected from.
    const view = branchView(history, branch, [
      sketch(),
      sketch({ id: 'bad', date: isoDate('2026-07-01') }),
    ]);
    expect(view.hypotheticalCount).toBe(1);
    expect(view.entries.map((e) => e.id)).not.toContain('bad');
  });

  it('puts them in date order, so a projection can walk them once', () => {
    const view = branchView(history, branch, [sketch({ date: isoDate('2026-10-15') })]);
    const dates = view.entries.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('does not touch the real entries it was given', () => {
    const before = JSON.stringify(history);
    branchView(history, branch, [sketch()]);
    expect(JSON.stringify(history)).toBe(before);
  });

  it('produces nothing that claims to have come from a statement', () => {
    // A hypothetical entry with a source transaction on it would look, to
    // every screen in the app, like something a bank actually reported.
    const view = branchView(history, branch, [sketch()]);
    for (const entry of view.entries) {
      if (entry.id === 'be-1') {
        expect(entry.sourceTransactionId).toBeNull();
        expect(entry.sealed).toBe(false);
      }
    }
  });
});

/* ===========================================================================
 * WHAT IT CHANGES
 * ======================================================================== */

describe('putting the two figures side by side', () => {
  it('subtracts in the direction a person reads', () => {
    expect(compare(m(100), m(140)).difference).toBe(m(40));
    expect(compare(m(100), m(60)).difference).toBe(m(-40));
  });

  it('says which is which, and by how much', () => {
    const ahead = describeDifference(compare(m(10_000), m(21_000)), 'The Rotterdam job', fmt);
    expect(ahead).toContain('11000.00');
    expect(ahead).toContain('21000.00');
    expect(ahead).toContain('10000.00');
  });

  it('says plainly when nothing changes', () => {
    expect(describeDifference(compare(m(500), m(500)), 'Moving', fmt)).toMatch(/exactly the same/);
  });

  it('offers no verdict, in either direction', () => {
    const said = [
      describeDifference(compare(m(10_000), m(21_000)), 'The job', fmt),
      describeDifference(compare(m(21_000), m(10_000)), 'The job', fmt),
      describeDifference(compare(m(500), m(500)), 'The job', fmt),
    ];
    for (const sentence of said) {
      expect(sentence).not.toMatch(/you should|better choice|worth doing|recommend|advise|go for/i);
    }
  });

  it('admits money is not the whole of it when the answer is worse', () => {
    const said = describeDifference(compare(m(21_000), m(10_000)), 'The job', fmt);
    expect(said).toMatch(/money is rarely the whole of it/);
  });

  it('always says out loud that it is a what-if', () => {
    // Structure keeps hypothetical money out of real totals. It cannot stop
    // somebody misreading a screen, so the label does that part.
    expect(branchLabel(branch)).toBe('What if: If I took the Rotterdam job');
    expect(branchLabel(branch)).toMatch(/^What if:/);
  });
});

/* ===========================================================================
 * PROPERTIES
 * ======================================================================== */

describe('properties', () => {
  it('never drops or invents a real entry, whatever the sketch contains', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 500_000 }), { maxLength: 12 }),
        fc.array(fc.integer({ min: -500_000, max: 500_000 }), { maxLength: 8 }),
        (realAmounts, sketchAmounts) => {
          const history = realAmounts.map((amount, at) =>
            real(`2026-0${(at % 9) + 1}-01`, minor(amount)),
          );
          const sketches = sketchAmounts.map((amount, at) =>
            sketch({
              id: `s-${at}`,
              date: isoDate('2026-11-01'),
              postings: amount === 0 ? [] : postingsFor(minor(Math.abs(amount))),
            }),
          );

          const view = branchView(history, branch, sketches);
          const realIds = new Set(history.map((e) => e.id));
          const kept = view.entries.filter((e) => realIds.has(e.id));
          expect(kept).toHaveLength(history.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('every entry it hands back balances, real or imagined', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -200_000, max: 200_000 }), { maxLength: 10 }),
        (amounts) => {
          const sketches = amounts.map((amount, at) =>
            sketch({
              id: `s-${at}`,
              postings: postingsFor(minor(Math.abs(amount) + 1)),
            }),
          );
          const view = branchView([real('2026-05-01', m(10))], branch, sketches);
          for (const entry of view.entries) {
            const total = entry.postings.reduce((sum, posting) => sum + posting.amount, 0);
            expect(total).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never lets a sketch land before the divergence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 12 }), (day, month) => {
        const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const view = branchView([], branch, [sketch({ date: isoDate(date) })]);
        for (const entry of view.entries) {
          expect(entry.date >= branch.divergesOn).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
