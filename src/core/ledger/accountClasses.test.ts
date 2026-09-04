import { describe, expect, it } from 'vitest';
import { minor } from '@/core/money';
import {
  LedgerError,
  accountId,
  type AccountClass,
  type AccountDraft,
  type LedgerAccount,
} from './index';
// Deep import on purpose: see the note in the ledger barrel.
import { CLASS_PROFILES, groupOf, isRevaluable, planAccountCreation } from './accountClasses';
// Deep import on purpose: see the note in the ledger barrel.
import { depreciatedValue } from './entries/valuation';

const IDS = {
  account: accountId('acc-new'),
  paymentEnvelope: accountId('pot-new'),
};

const draft = (over: Partial<AccountDraft> = {}): AccountDraft => ({
  name: 'Test account',
  accountClass: 'checking',
  startingBalance: minor(0),
  ...over,
});

/* ===========================================================================
 * A CARD AND ITS POT ARE ONE IDEA
 * ---------------------------------------------------------------------------
 * The defect this guards against shipped once already: card spending recorded
 * as though it were cash, because nothing was setting money aside for the
 * bill. A card that reaches storage without its reserve is that defect back.
 * ======================================================================== */

describe('creating a credit card', () => {
  it('always brings the pot that holds money for its bill', () => {
    const plan = planAccountCreation(
      draft({ name: 'Amex', accountClass: 'credit_card' }),
      IDS,
    );

    expect(plan.paymentEnvelope).not.toBeNull();
    expect(plan.paymentEnvelope!.book).toBe('BUDGET');
    expect(plan.paymentEnvelope!.type).toBe('ENVELOPE');
    expect(plan.paymentEnvelope!.envelopeRole).toBe('card_payment');
    expect(plan.paymentEnvelope!.name).toBe('Set aside for Amex');

    // And the card points at it, so spending can find the reserve.
    expect(plan.account.paymentEnvelopeId).toBe(plan.paymentEnvelope!.id);
  });

  it('records the card itself as something owed, in the financial book', () => {
    const plan = planAccountCreation(draft({ accountClass: 'credit_card' }), IDS);

    expect(plan.account.type).toBe('LIABILITY');
    expect(plan.account.normal).toBe('CREDIT');
    expect(plan.account.book).toBe('FINANCIAL');
    expect(plan.opensAsOwed).toBe(true);
    // A debt is never part of what you can spend.
    expect(plan.account.onBudget).toBe(false);
    expect(plan.account.liquid).toBe(false);
  });

  it('gives nothing else a payment pot', () => {
    for (const cls of ['checking', 'savings', 'mortgage', 'real_estate'] as AccountClass[]) {
      expect(planAccountCreation(draft({ accountClass: cls }), IDS).paymentEnvelope).toBeNull();
    }
  });
});

/* ===========================================================================
 * WHAT COUNTS AS SPENDABLE
 * ======================================================================== */

describe('deciding what backs the money you can spend', () => {
  it('puts everyday accounts on budget and everything illiquid off it', () => {
    const onBudget = (cls: AccountClass) =>
      planAccountCreation(draft({ accountClass: cls }), IDS).account.onBudget;

    expect(onBudget('checking')).toBe(true);
    expect(onBudget('savings')).toBe(true);
    expect(onBudget('cash')).toBe(true);

    for (const cls of [
      'brokerage',
      'retirement',
      'real_estate',
      'vehicle',
      'other_asset',
      'credit_card',
      'loan',
      'mortgage',
    ] as AccountClass[]) {
      expect(onBudget(cls)).toBe(false);
    }
  });

  it('refuses to put a house on budget, however firmly it is asked', () => {
    expect(() =>
      planAccountCreation(
        draft({ name: 'Family home', accountClass: 'real_estate', onBudget: true }),
        IDS,
      ),
    ).toThrow(/not money you could spend today/);
  });

  it('never marks an account liquid without also being on budget', () => {
    // The two are read together by I4 and by safe-to-spend; one without the
    // other is a shape neither of them expects.
    for (const cls of Object.keys(CLASS_PROFILES) as AccountClass[]) {
      const account = planAccountCreation(draft({ accountClass: cls }), IDS).account;
      if (account.liquid) expect(account.onBudget).toBe(true);
    }
  });

  it('lets somebody take an everyday account off budget if they want to', () => {
    const plan = planAccountCreation(
      draft({ accountClass: 'savings', onBudget: false }),
      IDS,
    );
    expect(plan.account.onBudget).toBe(false);
    expect(plan.account.liquid).toBe(false);
  });
});

/* ===========================================================================
 * OPENING FIGURES AND FIRST MARKS
 * ======================================================================== */

describe('what a starting figure brings with it', () => {
  it('writes no opening entry when there is nothing to open with', () => {
    const plan = planAccountCreation(draft({ startingBalance: minor(0) }), IDS);
    expect(plan.needsOpeningEntry).toBe(false);
    expect(plan.needsFirstMark).toBe(false);
  });

  it('records a first mark for anything whose value can move', () => {
    const house = planAccountCreation(
      draft({ accountClass: 'real_estate', startingBalance: minor(35_000_000) }),
      IDS,
    );
    expect(house.needsOpeningEntry).toBe(true);
    // Without this there is nothing to measure a gain against, and no date to
    // depreciate from.
    expect(house.needsFirstMark).toBe(true);
  });

  it('does not mark an everyday account, whose balance moves by itself', () => {
    const current = planAccountCreation(
      draft({ accountClass: 'checking', startingBalance: minor(250_000) }),
      IDS,
    );
    expect(current.needsOpeningEntry).toBe(true);
    expect(current.needsFirstMark).toBe(false);
  });

  it('refuses a negative starting figure and says how to state it instead', () => {
    expect(() =>
      planAccountCreation(draft({ startingBalance: minor(-100) }), IDS),
    ).toThrow(/always a positive number/);
  });

  it('refuses an account with no name', () => {
    expect(() => planAccountCreation(draft({ name: '   ' }), IDS)).toThrow(LedgerError);
  });
});

/* ===========================================================================
 * WHERE THINGS APPEAR ON THE BALANCE SHEET
 * ======================================================================== */

describe('sorting accounts into the four sections', () => {
  const of = (cls: AccountClass) =>
    groupOf(planAccountCreation(draft({ accountClass: cls }), IDS).account);

  it('puts each class where a person would look for it', () => {
    expect(of('checking')).toBe('cash');
    expect(of('cash')).toBe('cash');
    expect(of('brokerage')).toBe('investments');
    expect(of('retirement')).toBe('investments');
    expect(of('real_estate')).toBe('property');
    expect(of('vehicle')).toBe('property');
    expect(of('credit_card')).toBe('debts');
    expect(of('mortgage')).toBe('debts');
  });

  it('places the three accounts that predate classes without guessing', () => {
    const original = (over: Partial<LedgerAccount>): LedgerAccount => ({
      id: accountId('acc-old'),
      book: 'FINANCIAL',
      type: 'ASSET',
      name: 'Everyday account',
      normal: 'DEBIT',
      parentId: null,
      status: 'active',
      onBudget: true,
      liquid: true,
      paymentEnvelopeId: null,
      envelopeRole: null,
      ...over,
    });

    expect(groupOf(original({}))).toBe('cash');
    expect(groupOf(original({ type: 'LIABILITY', normal: 'CREDIT', onBudget: false, liquid: false }))).toBe('debts');
    // And none of them offers to be revalued, because none of them should be.
    expect(isRevaluable(original({}))).toBe(false);
  });

  it('offers to revalue only things whose worth actually moves on its own', () => {
    const can = (cls: AccountClass) =>
      isRevaluable(planAccountCreation(draft({ accountClass: cls }), IDS).account);

    expect(can('real_estate')).toBe(true);
    expect(can('vehicle')).toBe(true);
    expect(can('brokerage')).toBe(true);
    expect(can('checking')).toBe(false);
    expect(can('credit_card')).toBe(false);
    expect(can('mortgage')).toBe(false);
  });
});

/* ===========================================================================
 * A CAR LOSING VALUE, MONTH BY MONTH
 * ======================================================================== */

describe('a vehicle depreciating on a straight line', () => {
  // €24,000, losing 15% of the original every year.
  const car = {
    costBasis: minor(2_400_000),
    from: '2026-01-01',
    rateBp: 1_500,
    model: 'straight_line' as const,
  };

  it('drops by the same amount every month of a year', () => {
    // 15% of €24,000 is €3,600 a year. Twelve equal months of €300 each.
    const drops: number[] = [];
    const months = [
      '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01',
      '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01',
      '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01',
    ];

    let previous = depreciatedValue(car, '2026-01-01');
    for (const month of months) {
      const value = depreciatedValue(car, month);
      drops.push(previous - value);
      previous = value;
    }

    // The fall is spread across the days of the year, not across twelve equal
    // buckets, so each month drops in proportion to its own length: a 31-day
    // month loses 31/365 of €3,600 (€305.75) and February loses 28/365
    // (€276.16). They differ from the €300 average by up to €24, and they add
    // to exactly one year's fall with nothing lost to rounding.
    expect(drops.reduce((a, b) => a + b, 0)).toBe(360_000);
    for (const drop of drops) {
      expect(Math.abs(drop - 30_000)).toBeLessThanOrEqual(2_500);
    }

    // February is the shortest step and a 31-day month the longest, which is
    // the ordering that says the fall really is daily rather than monthly.
    const february = drops[1]!;
    const march = drops[2]!;
    expect(february).toBeLessThan(march);
  });

  it('lands exactly on the annual figure at each anniversary', () => {
    expect(depreciatedValue(car, '2027-01-01')).toBe(2_400_000 - 360_000);
    expect(depreciatedValue(car, '2028-01-01')).toBe(2_400_000 - 720_000);
    expect(depreciatedValue(car, '2029-01-01')).toBe(2_400_000 - 1_080_000);
  });

  it('reaches nothing rather than going below it, and stays there', () => {
    // At 15% a year, straight line, the original is gone after 6 years 8 months.
    expect(depreciatedValue(car, '2033-01-01')).toBe(0);
    expect(depreciatedValue(car, '2050-01-01')).toBe(0);
  });

  it('crosses a leap day without gaining or losing a step', () => {
    const leap = { ...car, from: '2028-01-01' };
    expect(depreciatedValue(leap, '2029-01-01')).toBe(2_400_000 - 360_000);
  });
});
