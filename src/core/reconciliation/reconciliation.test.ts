import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import {
  LedgerError,
  accountId,
  assertNotReconciled,
  clearanceOf,
  entryId,
  isReconciled,
  type JournalEntry,
  type Posting,
  type PostingId,
} from '@/core/ledger';
import {
  clearedBalanceOf,
  describeDifference,
  describeLock,
  describeLocked,
  reconciliationState,
  unclearedBalanceOf,
  type ReconcilableLine,
} from './reconciliationMath';

const line = (
  id: string,
  date: string,
  amount: number,
  clearance: ReconcilableLine['clearance'] = 'cleared',
): ReconcilableLine => ({
  postingId: id,
  entryId: `e-${id}`,
  date,
  amount: minor(amount),
  description: `Line ${id}`,
  clearance,
});

const euro = (amount: Minor) =>
  `€${(amount / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe('what has gone through', () => {
  const lines = [
    line('a', '2026-09-01', 250_000),
    line('b', '2026-09-02', -12_500),
    line('c', '2026-09-03', -4_000, 'pending'),
    line('d', '2026-09-04', -1_000, 'reconciled'),
  ];

  it('counts cleared and locked lines, never pending ones', () => {
    // 250,000 − 12,500 − 1,000. The pending €40 is the bank's business, not
    // the statement's.
    expect(clearedBalanceOf(lines, '2026-09-30')).toBe(236_500);
  });

  it('counts pending lines separately', () => {
    expect(unclearedBalanceOf(lines, '2026-09-30')).toBe(-4_000);
  });

  it('ignores anything after the statement date', () => {
    expect(clearedBalanceOf(lines, '2026-09-01')).toBe(250_000);
    expect(clearedBalanceOf(lines, '2026-09-02')).toBe(237_500);
  });

  it('has nothing to count from nothing', () => {
    expect(clearedBalanceOf([], '2026-09-30')).toBe(0);
    expect(unclearedBalanceOf([], '2026-09-30')).toBe(0);
  });
});

describe('where the check stands', () => {
  const lines = [line('a', '2026-09-01', 250_000), line('b', '2026-09-02', -12_500)];

  it('balances when the statement agrees to the penny', () => {
    const state = reconciliationState({
      lines,
      statementBalance: minor(237_500),
      statementDate: '2026-09-30',
    });

    expect(state.discrepancy).toBe(0);
    expect(state.status).toBe('balanced');
  });

  it('does not balance one cent out', () => {
    const state = reconciliationState({
      lines,
      statementBalance: minor(237_501),
      statementDate: '2026-09-30',
    });

    expect(state.discrepancy).toBe(1);
    expect(state.status).toBe('unbalanced');
  });

  it('signs the difference so the direction is readable', () => {
    // The bank has more than is ticked here.
    const short = reconciliationState({
      lines,
      statementBalance: minor(240_000),
      statementDate: '2026-09-30',
    });
    expect(short.discrepancy).toBe(2_500);

    // And the other way round.
    const over = reconciliationState({
      lines,
      statementBalance: minor(230_000),
      statementDate: '2026-09-30',
    });
    expect(over.discrepancy).toBe(-7_500);
  });

  it('counts what is ticked, what is not, and what would be locked', () => {
    const state = reconciliationState({
      lines: [
        line('a', '2026-09-01', 250_000),
        line('b', '2026-09-02', -12_500, 'pending'),
        line('c', '2026-09-03', -1_000, 'reconciled'),
      ],
      statementBalance: minor(249_000),
      statementDate: '2026-09-30',
    });

    expect(state.clearedCount).toBe(2);
    expect(state.pendingCount).toBe(1);
    // Only the one that is cleared but not yet locked.
    expect(state.lockedCount).toBe(1);
  });

  it('leaves out lines dated after the statement entirely', () => {
    const state = reconciliationState({
      lines: [line('a', '2026-09-01', 250_000), line('b', '2026-10-15', -99_999)],
      statementBalance: minor(250_000),
      statementDate: '2026-09-30',
    });

    expect(state.status).toBe('balanced');
    expect(state.pendingCount + state.clearedCount).toBe(1);
  });
});

describe('what it says out loud', () => {
  const lines = [line('a', '2026-09-01', 250_000)];

  it('says so plainly when it matches', () => {
    const state = reconciliationState({
      lines,
      statementBalance: minor(250_000),
      statementDate: '2026-09-30',
    });
    expect(describeDifference(state, euro)).toBe('Everything matches to the exact penny.');
  });

  it('names the amount and the direction without guessing the cause', () => {
    const state = reconciliationState({
      lines,
      statementBalance: minor(255_000),
      statementDate: '2026-09-30',
    });
    const sentence = describeDifference(state, euro);

    expect(sentence).toContain('€50.00');
    expect(sentence).toContain('higher than what you have ticked');
    // Both causes offered, neither asserted: an overdrawn account makes the
    // direction of the gap a poor guide to which one it is.
    expect(sentence).toContain('Either');
  });

  it('describes the other direction differently', () => {
    const state = reconciliationState({
      lines,
      statementBalance: minor(245_000),
      statementDate: '2026-09-30',
    });
    const sentence = describeDifference(state, euro);
    expect(sentence).toContain('lower than what you have ticked');
    expect(sentence).toContain('counted twice');
  });

  it('says how many records finishing will lock', () => {
    expect(describeLock(28)).toBe(
      'This will lock 28 payments. Locked records cannot be edited accidentally.',
    );
    expect(describeLock(1)).toContain('1 payment.');
    expect(describeLock(0)).toContain('nothing new to lock');
  });

  it('names the date a record was locked on', () => {
    const sentence = describeLocked('2026-09-04T10:22:00.000Z', (iso) =>
      iso === '2026-09-04' ? 'on 4 September' : iso,
    );
    expect(sentence).toBe(
      'Locked during your statement check on 4 September. Locked records cannot be edited or deleted.',
    );
  });

  it('reads as a sentence when the lock happened today', () => {
    // "on Today" is the trap here: the phrase comes in whole, preposition and
    // all, so both shapes read correctly.
    expect(describeLocked('2026-09-05T09:00:00.000Z', () => 'today')).toBe(
      'Locked during your statement check today. Locked records cannot be edited or deleted.',
    );
  });

  it('never tells anyone what they should do about a difference', () => {
    const state = reconciliationState({
      lines,
      statementBalance: minor(255_000),
      statementDate: '2026-09-30',
    });
    expect(describeDifference(state, euro)).not.toMatch(/you should|must|need to|make sure/i);
  });
});

/* ===========================================================================
 * THE SEALING GUARD
 * ======================================================================== */

function posting(over: Partial<Posting> = {}): Posting {
  return {
    id: 'p-1' as PostingId,
    entryId: entryId('e-1'),
    book: 'FINANCIAL',
    accountId: accountId('acc-checking'),
    amount: minor(-1_000),
    baseAmount: minor(-1_000),
    fxRateScaled: 1_000_000,
    clearance: 'cleared',
    reconciledAt: null,
    memo: null,
    sequence: 0,
    ...over,
  };
}

const entryWith = (postings: Posting[]): Pick<JournalEntry, 'postings'> => ({ postings });

describe('the lock', () => {
  it('lets an unchecked entry through', () => {
    expect(() => assertNotReconciled(entryWith([posting(), posting()]))).not.toThrow();
    expect(isReconciled(entryWith([posting()]))).toBe(false);
  });

  it('refuses an entry checked against a statement', () => {
    const locked = entryWith([
      posting(),
      posting({ clearance: 'reconciled', reconciledAt: '2026-09-04T10:22:00.000Z' }),
    ]);

    expect(() => assertNotReconciled(locked)).toThrow(LedgerError);
    expect(isReconciled(locked)).toBe(true);
  });

  it('names the day it was locked, in the words the app uses for dates', () => {
    const locked = entryWith([
      posting({ clearance: 'reconciled', reconciledAt: '2026-09-04T10:22:00.000Z' }),
    ]);

    expect(() =>
      assertNotReconciled(locked, (iso) => (iso === '2026-09-04' ? '4 September' : iso)),
    ).toThrow(/locked during your statement check on 4 September/i);
  });

  it('leaves the date out rather than printing a raw one when it has no formatter', () => {
    const locked = entryWith([posting({ reconciledAt: '2026-09-04T10:22:00.000Z' })]);
    let message = '';
    try {
      assertNotReconciled(locked);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('locked during your statement check.');
    expect(message).not.toContain('2026-09-04');
  });

  it('says what can be done about it rather than only refusing', () => {
    const locked = entryWith([posting({ reconciledAt: '2026-09-04T10:22:00.000Z' })]);
    let message = '';
    try {
      assertNotReconciled(locked);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('unlock');
  });

  it('catches a timestamp even when the derived value was lost', () => {
    // Belt and braces: a posting round-tripped through something that dropped
    // the derived clearance is still locked, because the date is the fact.
    const locked = entryWith([posting({ clearance: 'cleared', reconciledAt: '2026-09-04T00:00:00Z' })]);
    expect(isReconciled(locked)).toBe(true);
    expect(() => assertNotReconciled(locked)).toThrow();
  });
});

/* ===========================================================================
 * THE PROPERTIES
 * ======================================================================== */

describe('conservation', () => {
  const generatedLines = fc.array(
    fc.record({
      day: fc.integer({ min: 1, max: 28 }),
      amount: fc.integer({ min: -500_000, max: 500_000 }).filter((n) => n !== 0),
      state: fc.constantFrom('pending' as const, 'cleared' as const, 'reconciled' as const),
    }),
    { minLength: 1, maxLength: 40 },
  );

  const toLines = (rows: { day: number; amount: number; state: ReconcilableLine['clearance'] }[]) =>
    rows.map((row, i) =>
      line(`p${i}`, `2026-09-${String(row.day).padStart(2, '0')}`, row.amount, row.state),
    );

  it('balances exactly when the statement equals what has gone through, and never otherwise', () => {
    fc.assert(
      fc.property(generatedLines, fc.integer({ min: -10_000, max: 10_000 }), (rows, offset) => {
        const lines = toLines(rows);
        const cleared = clearedBalanceOf(lines, '2026-09-30');

        // Exactly right: balanced, every time.
        const exact = reconciliationState({
          lines,
          statementBalance: cleared,
          statementDate: '2026-09-30',
        });
        expect(exact.status).toBe('balanced');
        expect(exact.discrepancy).toBe(0);

        // Anything else: not balanced, and the difference is exact.
        if (offset !== 0) {
          const off = reconciliationState({
            lines,
            statementBalance: minor(cleared + offset),
            statementDate: '2026-09-30',
          });
          expect(off.status).toBe('unbalanced');
          expect(off.discrepancy).toBe(offset);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('splits every line into exactly one of gone-through or not', () => {
    fc.assert(
      fc.property(generatedLines, (rows) => {
        const lines = toLines(rows);
        const state = reconciliationState({
          lines,
          statementBalance: minor(0),
          statementDate: '2026-09-30',
        });

        // Nothing counted twice, nothing dropped.
        expect(state.clearedCount + state.pendingCount).toBe(lines.length);
        expect(state.clearedBalance + state.unclearedBalance).toBe(
          lines.reduce((total, l) => total + l.amount, 0),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('does not move a single figure when a line is ticked or unticked', () => {
    fc.assert(
      fc.property(generatedLines, fc.integer({ min: 0, max: 39 }), (rows, index) => {
        const lines = toLines(rows);
        const target = index % lines.length;
        const before = lines[target]!;
        // A locked line cannot be toggled at all, so it is not a case here.
        if (before.clearance === 'reconciled') return;

        const flipped = lines.map((l, i) =>
          i === target
            ? {
                ...l,
                clearance: (l.clearance === 'pending'
                  ? 'cleared'
                  : 'pending') as ReconcilableLine['clearance'],
              }
            : l,
        );

        const total = (list: readonly ReconcilableLine[]) =>
          list.reduce((sum, l) => sum + l.amount, 0);

        // What the account is worth is the sum of every line, whatever its
        // state. Ticking a box is a statement about the bank, not about money.
        expect(total(flipped)).toBe(total(lines));

        // And the money simply moves between the two buckets.
        const a = reconciliationState({
          lines,
          statementBalance: minor(0),
          statementDate: '2026-09-30',
        });
        const b = reconciliationState({
          lines: flipped,
          statementBalance: minor(0),
          statementDate: '2026-09-30',
        });
        expect(a.clearedBalance + a.unclearedBalance).toBe(
          b.clearedBalance + b.unclearedBalance,
        );
      }),
      { numRuns: 100 },
    );
  });
});

/* ===========================================================================
 * WHAT THE INTERFACE SAYS MATCHES WHAT THE LEDGER WILL DO
 * ---------------------------------------------------------------------------
 * Checking one account's statement locks only that account's lines, and an
 * entry always has lines on two accounts and often on both books. The guard
 * refuses the whole entry if any single line is locked, so the state the
 * interface shows has to be built the same way — or somebody is offered an
 * Undo button on a payment that will refuse to be undone.
 * ======================================================================== */

describe('one locked line locks the entry', () => {
  it('agrees with the guard when only part of an entry was checked', () => {
    // What reconciling a current account actually produces: the line on that
    // account is locked, the other side of the same payment is not.
    const half = [
      posting({ reconciledAt: '2026-09-05T09:00:00.000Z', clearance: 'reconciled' }),
      posting({ accountId: accountId('acc-mortgage'), amount: minor(1_000) }),
    ];

    // The ledger will refuse it...
    expect(() => assertNotReconciled(entryWith(half))).toThrow();
    // ...so the interface has to say so too.
    expect(clearanceOf(half)).toBe('reconciled');
  });

  it('still reads as pending when nothing is locked and something is unsettled', () => {
    expect(clearanceOf([posting(), posting({ clearance: 'pending' })])).toBe('pending');
  });

  it('reads as gone through when every line has', () => {
    expect(clearanceOf([posting(), posting()])).toBe('cleared');
  });

  it('never disagrees with the guard, whatever the mix of lines', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('pending' as const, 'cleared' as const, 'reconciled' as const), {
          minLength: 1,
          maxLength: 6,
        }),
        (states) => {
          const lines = states.map((state) =>
            posting({
              clearance: state,
              reconciledAt: state === 'reconciled' ? '2026-09-05T09:00:00.000Z' : null,
            }),
          );

          let guardRefused = false;
          try {
            assertNotReconciled(entryWith(lines));
          } catch {
            guardRefused = true;
          }

          expect(clearanceOf(lines) === 'reconciled').toBe(guardRefused);
        },
      ),
      { numRuns: 100 },
    );
  });
});
