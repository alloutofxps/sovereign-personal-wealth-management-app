import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BP_PER_UNIT,
  addRates,
  applyBasisPoints,
  basisPoints,
  bpFromPercent,
  bpToPercent,
  formatRate,
  monthlyInterest,
} from './rate';
import { MoneyError, minor } from './minor';

describe('construction', () => {
  it('reads the way the industry writes rates', () => {
    expect(bpFromPercent(19.99)).toBe(1999);
    expect(bpFromPercent(0)).toBe(0);
    expect(bpFromPercent(100)).toBe(BP_PER_UNIT);
    expect(bpFromPercent(3.5)).toBe(350);
  });

  it('round-trips through a percentage', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 1_000_000 }), (bp) => {
        expect(bpFromPercent(bpToPercent(basisPoints(bp)))).toBe(bp);
      }),
    );
  });

  it('rejects a fractional basis point instead of rounding it away', () => {
    expect(() => bpFromPercent(19.999)).toThrow(/finer than one basis point/);
    expect(() => basisPoints(1999.5)).toThrow(MoneyError);
  });

  it('rejects a rate given as a decimal fraction — the classic mix-up', () => {
    // 0.1999 means 0.1999%, not 19.99%. Catching this at construction is the
    // difference between a rounding bug and a 100x interest error.
    expect(() => bpFromPercent(0.1999)).toThrow(/finer than one basis point/);
  });

  it('survives the binary representation of common percentages', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754.
    for (const pct of [19.99, 24.99, 7.07, 0.01, 4.35, 12.34]) {
      expect(bpFromPercent(pct)).toBe(Math.round(pct * 100));
    }
  });
});

describe('applyBasisPoints', () => {
  it('computes interest exactly, with no float', () => {
    // 19.99% of 1,000.00
    expect(applyBasisPoints(minor(100_000), bpFromPercent(19.99))).toBe(19_990);
    // 3% of 33.33 — the case where a float would leave a trailing 9.
    expect(applyBasisPoints(minor(3333), bpFromPercent(3))).toBe(100);
  });

  it('is exact at 100% and 0%', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => {
        const amount = minor(n);
        expect(applyBasisPoints(amount, basisPoints(BP_PER_UNIT))).toBe(amount);
        expect(applyBasisPoints(amount, basisPoints(0))).toBe(0);
      }),
    );
  });

  it('never returns a fractional amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e10, max: 1e10 }),
        fc.integer({ min: 0, max: 50_000 }),
        (n, bp) => {
          expect(Number.isInteger(applyBasisPoints(minor(n), basisPoints(bp)))).toBe(true);
        },
      ),
    );
  });
});

describe('monthlyInterest', () => {
  it('uses the simple 1/12 convention statements use', () => {
    // 19.99% APR on a 1,000.00 card balance.
    expect(monthlyInterest(minor(100_000), bpFromPercent(19.99))).toBe(1666);
  });

  it('charges nothing on a zero or credit balance', () => {
    expect(monthlyInterest(minor(0), bpFromPercent(19.99))).toBe(0);
    expect(monthlyInterest(minor(-5000), bpFromPercent(19.99))).toBe(0);
  });
});

describe('addRates', () => {
  it('adds a margin to a base rate', () => {
    expect(addRates(bpFromPercent(4.5), bpFromPercent(1.25))).toBe(575);
  });
});

describe('formatRate', () => {
  it('renders a rate the way a person reads it', () => {
    expect(formatRate(bpFromPercent(19.99), 'en-GB')).toBe('19.99%');
    expect(formatRate(bpFromPercent(4), 'en-GB')).toBe('4%');
  });

  it('follows the locale', () => {
    expect(formatRate(bpFromPercent(19.99), 'de-DE')).toMatch(/19,99/);
  });
});
