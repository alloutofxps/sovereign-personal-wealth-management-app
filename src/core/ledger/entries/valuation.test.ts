import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minor, type Minor } from '@/core/money';
import {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  accountId,
  checkInvariants,
  depreciatedValue,
  describeDepreciation,
  entryId,
  isoDate,
  liquidCash,
  netWorth,
  openingBalance,
  totalIncome,
  totalSpending,
  valuation,
  type AccountId,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type LedgerSnapshot,
  type SystemAccounts,
} from '../index';

/* ===========================================================================
 * A BALANCE SHEET WITH SOMETHING ILLIQUID ON IT
 * ======================================================================== */

const A = {
  checking: accountId('checking'),
  house: accountId('house'),
  car: accountId('car'),
  opening: accountId('opening'),
  gain: accountId('eq-unrealized-gain'),
  loss: accountId('eq-unrealized-loss'),
  salary: accountId('salary'),
  groceries: accountId('groceries'),
  cash: accountId('budgetable-cash'),
  rta: accountId('ready-to-assign'),
} as const;

const SYSTEM: SystemAccounts = {
  readyToAssign: A.rta,
  budgetableCash: A.cash,
  openingBalances: A.opening,
  receivables: accountId('receivables'),
  reimbursementsEnvelope: accountId('env-reimbursements'),
  unrealizedGain: A.gain,
  unrealizedLoss: A.loss,
};

function account(
  id: AccountId,
  type: LedgerAccountType,
  name: string,
  extra: Partial<LedgerAccount> = {},
): LedgerAccount {
  return {
    id,
    book: BOOK_BY_TYPE[type],
    type,
    name,
    normal: NORMAL_BY_TYPE[type],
    parentId: null,
    status: 'active',
    onBudget: false,
    liquid: false,
    paymentEnvelopeId: null,
    envelopeRole: null,
    ...extra,
  };
}

const HOUSE = account(A.house, 'ASSET', 'Family home', { accountClass: 'real_estate' });
const CAR = account(A.car, 'ASSET', 'The car', { accountClass: 'vehicle' });
const CHECKING = account(A.checking, 'ASSET', 'Everyday account', {
  onBudget: true,
  liquid: true,
  accountClass: 'checking',
});

const CHART: LedgerAccount[] = [
  CHECKING,
  HOUSE,
  CAR,
  account(A.opening, 'EQUITY', 'Starting balances'),
  account(A.gain, 'EQUITY', 'Gains on things you own'),
  account(A.loss, 'EQUITY', 'Falls in what things are worth'),
  account(A.salary, 'INCOME', 'Pay'),
  account(A.groceries, 'EXPENSE', 'Food shopping'),
  account(A.cash, 'BUDGETABLE_CASH', 'Money you can spend'),
  account(A.rta, 'READY_TO_ASSIGN', 'Not given a job yet'),
];

const ACCOUNTS = new Map(CHART.map((a) => [a.id, a]));
const snapshot = (entries: JournalEntry[]): LedgerSnapshot => ({ accounts: ACCOUNTS, entries });

const DATE = isoDate('2026-09-04');
let seq = 0;
const base = () => ({ id: entryId(`e${++seq}`), date: DATE });

/** A starting position: money in the bank, and a house recorded at cost. */
function opening(cash: Minor, houseValue: Minor): JournalEntry[] {
  return [
    openingBalance({
      ...base(),
      accountId: A.checking,
      amount: cash,
      countsAsBudgetableCash: true,
      accountName: 'Everyday account',
      system: SYSTEM,
    }),
    openingBalance({
      ...base(),
      accountId: A.house,
      amount: houseValue,
      countsAsBudgetableCash: false,
      accountName: 'Family home',
      system: SYSTEM,
    }),
  ];
}

/* ===========================================================================
 * WHAT A VALUATION MOVES, AND WHAT IT MUST NOT
 * ======================================================================== */

describe('marking an asset to what it is now worth', () => {
  it('books a rise against equity, never against income', () => {
    const entry = valuation({
      ...base(),
      account: HOUSE,
      currentValue: minor(35_000_000),
      newValue: minor(36_500_000),
      system: SYSTEM,
    });

    expect(entry.kind).toBe('VALUATION');
    expect(entry.description).toBe('Family home is now worth more than it was.');

    const house = entry.postings.find((p) => p.accountId === A.house)!;
    const equity = entry.postings.find((p) => p.accountId === A.gain)!;

    expect(house.amount).toBe(1_500_000); // debit: the asset is worth more
    expect(equity.amount).toBe(-1_500_000); // credit: against equity
    expect(entry.postings).toHaveLength(2);
  });

  it('books a fall against equity, never against spending', () => {
    const entry = valuation({
      ...base(),
      account: CAR,
      currentValue: minor(1_800_000),
      newValue: minor(1_500_000),
      system: SYSTEM,
    });

    expect(entry.description).toBe('The car is now worth less than it was.');
    expect(entry.postings.find((p) => p.accountId === A.car)!.amount).toBe(-300_000);
    expect(entry.postings.find((p) => p.accountId === A.loss)!.amount).toBe(300_000);
  });

  it('writes nothing at all into the budget book', () => {
    const entry = valuation({
      ...base(),
      account: HOUSE,
      currentValue: minor(35_000_000),
      newValue: minor(36_500_000),
      system: SYSTEM,
    });

    expect(entry.postings.filter((p) => p.book === 'BUDGET')).toHaveLength(0);
  });

  it('refuses an everyday account, and says what to do instead', () => {
    expect(() =>
      valuation({
        ...base(),
        account: CHECKING,
        currentValue: minor(100_000),
        newValue: minor(120_000),
        system: SYSTEM,
      }),
    ).toThrow(/everyday accounts/);
  });

  it('refuses anything that is not something you own', () => {
    const card = account(accountId('card'), 'LIABILITY', 'Credit card');
    expect(() =>
      valuation({
        ...base(),
        account: card,
        currentValue: minor(0),
        newValue: minor(50_000),
        system: SYSTEM,
      }),
    ).toThrow(LedgerError);
  });

  it('refuses to record a value that has not changed', () => {
    expect(() =>
      valuation({
        ...base(),
        account: HOUSE,
        currentValue: minor(35_000_000),
        newValue: minor(35_000_000),
        system: SYSTEM,
      }),
    ).toThrow(/already recorded at that value/);
  });
});

/* ===========================================================================
 * THE PROPERTY THAT MATTERS
 * ---------------------------------------------------------------------------
 * Over any sequence of revaluations, net worth follows them exactly and the
 * three figures that describe behaviour do not move at all. If this ever
 * fails, somebody is being told they can spend their house.
 * ======================================================================== */

describe('what a hundred revaluations do to the rest of the books', () => {
  it('moves net worth by exactly the change, and nothing else by anything', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 100_000_000 }),
        fc.integer({ min: 10_000, max: 5_000_000 }),
        fc.array(fc.integer({ min: -50_000_000, max: 50_000_000 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (startValue, cash, moves) => {
          const entries = opening(minor(cash), minor(startValue));

          const before = {
            net: netWorth(snapshot(entries)),
            spending: totalSpending(snapshot(entries)),
            income: totalIncome(snapshot(entries)),
            liquid: liquidCash(snapshot(entries)),
          };

          let current = startValue;
          let applied = 0;

          for (const move of moves) {
            // An asset cannot be worth a negative amount, and re-marking to
            // the same figure is refused, so both are skipped rather than
            // being fed to the builder as nonsense.
            const next = Math.max(0, current + move);
            if (next === current) continue;

            entries.push(
              valuation({
                ...base(),
                account: HOUSE,
                currentValue: minor(current),
                newValue: minor(next),
                system: SYSTEM,
              }),
            );
            applied += next - current;
            current = next;
          }

          const after = snapshot(entries);

          // Net worth follows the marks exactly, to the penny.
          expect(netWorth(after)).toBe(before.net + applied);

          // And none of these moves. Not by rounding. Not at all.
          expect(totalSpending(after)).toBe(before.spending);
          expect(totalIncome(after)).toBe(before.income);
          expect(liquidCash(after)).toBe(before.liquid);

          // Both books still balance and every rule still holds.
          expect(checkInvariants(after)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leaves spending and income at exactly zero when nothing else happened', () => {
    const entries = opening(minor(250_000), minor(35_000_000));
    for (const value of [36_000_000, 34_500_000, 39_000_000]) {
      const current = entries
        .flatMap((e) => e.postings)
        .filter((p) => p.accountId === A.house)
        .reduce((sum, p) => sum + p.amount, 0);

      entries.push(
        valuation({
          ...base(),
          account: HOUSE,
          currentValue: minor(current),
          newValue: minor(value),
          system: SYSTEM,
        }),
      );
    }

    const after = snapshot(entries);
    expect(totalSpending(after)).toBe(0);
    expect(totalIncome(after)).toBe(0);
    expect(liquidCash(after)).toBe(250_000);
    expect(netWorth(after)).toBe(250_000 + 39_000_000);
  });
});

/* ===========================================================================
 * LOSING VALUE BY STANDING STILL
 * ======================================================================== */

describe('working out what a car is probably worth today', () => {
  const car = {
    costBasis: minor(2_400_000),
    from: '2026-01-01',
    rateBp: 1_500, // 15% a year
    model: 'straight_line' as const,
  };

  it('takes the same slice off the original cost each year', () => {
    // 15% of €24,000 is €3,600 a year.
    expect(depreciatedValue(car, '2027-01-01')).toBe(2_400_000 - 360_000);
    expect(depreciatedValue(car, '2028-01-01')).toBe(2_400_000 - 720_000);
  });

  it('works out the drop for part of a year, to the penny', () => {
    // Half a year at 15% is 7.5%: €1,800 off €24,000.
    const halfway = depreciatedValue(car, '2026-07-02');
    expect(halfway).toBeGreaterThan(2_400_000 - 182_000);
    expect(halfway).toBeLessThan(2_400_000 - 178_000);
  });

  it('never falls below what it would still fetch', () => {
    const withFloor = { ...car, salvage: minor(500_000) };
    expect(depreciatedValue(withFloor, '2040-01-01')).toBe(500_000);
  });

  it('never has something appreciating before it was bought', () => {
    expect(depreciatedValue(car, '2025-06-01')).toBe(2_400_000);
    expect(depreciatedValue(car, '2026-01-01')).toBe(2_400_000);
  });

  it('takes a proportion of what is left on a declining balance', () => {
    const declining = { ...car, model: 'declining_balance' as const };

    // 15% off what remains, not off the original: after two years the
    // straight line has lost more than the curve has.
    const straight = depreciatedValue(car, '2028-01-01');
    const curve = depreciatedValue(declining, '2028-01-01');

    expect(curve).toBeGreaterThan(straight);
    expect(curve).toBe(Math.round(2_400_000 * 0.85 * 0.85));
  });

  it('never reaches zero on a declining balance, however long it stands', () => {
    const declining = { ...car, model: 'declining_balance' as const };
    expect(depreciatedValue(declining, '2076-01-01')).toBeGreaterThan(0);
  });

  it('describes the fall as ordinary rather than as a problem', () => {
    const said = describeDepreciation(car, '2027-01-01', (a) => `€${(a / 100).toFixed(2)}`);
    expect(said).toContain('which is what things like this do');
    expect(said).not.toMatch(/lost|loss|down|warning/i);
  });
});
