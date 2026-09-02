import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MoneyError,
  add,
  allocate,
  allocateEvenly,
  fromDecimalString,
  minor,
  mulDivRound,
  sub,
  sum,
  toDecimalString,
} from './minor';

/** Amounts within a realistic household range, plus the extremes. */
const anyAmount = fc.integer({ min: -1e12, max: 1e12 }).map((n) => minor(n));

describe('construction', () => {
  it('rejects a float — the value that must never enter the ledger', () => {
    expect(() => minor(10.5)).toThrow(MoneyError);
    expect(() => minor(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('rejects values beyond exact integer range', () => {
    expect(() => minor(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('add and sub are exact inverses', () => {
    fc.assert(
      fc.property(anyAmount, anyAmount, (a, b) => {
        expect(sub(add(a, b), b)).toBe(a);
      }),
    );
  });

  it('sum equals repeated addition', () => {
    fc.assert(
      fc.property(fc.array(anyAmount, { maxLength: 60 }), (amounts) => {
        const folded = amounts.reduce((acc, a) => add(acc, a), minor(0));
        expect(sum(amounts)).toBe(folded);
      }),
    );
  });

  it('holds exactly where floats drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is exact.
    expect(add(minor(10), minor(20))).toBe(30);
    let cents = minor(0);
    for (let i = 0; i < 10_000; i++) cents = add(cents, minor(1));
    expect(cents).toBe(10_000);
  });
});

describe('mulDivRound', () => {
  it('rounds half away from zero, symmetrically', () => {
    expect(mulDivRound(minor(5), 1, 2)).toBe(3); // 2.5 -> 3
    expect(mulDivRound(minor(-5), 1, 2)).toBe(-3); // -2.5 -> -3
    expect(mulDivRound(minor(7), 1, 2)).toBe(4); // 3.5 -> 4
    expect(mulDivRound(minor(-7), 1, 2)).toBe(-4);
  });

  it('matches an exact BigInt oracle at every magnitude', () => {
    // The oracle is BigInt rather than `(a * n) / d`, because that expression
    // is itself lossy once a*n passes 2^53 — the very range this must survive.
    const oracle = (a: number, n: number, d: number): bigint => {
      const numerator = BigInt(a) * BigInt(n);
      const denominator = BigInt(d);
      const negative = numerator < 0n !== denominator < 0n;
      const absN = numerator < 0n ? -numerator : numerator;
      const absD = denominator < 0n ? -denominator : denominator;
      const q = absN / absD;
      const remainder = absN - q * absD;
      const rounded = remainder * 2n >= absD ? q + 1n : q;
      return negative ? -rounded : rounded;
    };

    fc.assert(
      fc.property(
        anyAmount,
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (a, n, d) => {
          const exact = oracle(a, n, d);
          // Where the result is not representable, throwing is correct — see
          // the next test. Only assert over the representable range here.
          fc.pre(
            exact <= BigInt(Number.MAX_SAFE_INTEGER) && exact >= -BigInt(Number.MAX_SAFE_INTEGER),
          );
          expect(BigInt(mulDivRound(a, n, d))).toBe(exact);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('refuses to return a result it cannot represent exactly', () => {
    // Silently returning an inexact number here is how a ledger starts lying.
    expect(() => mulDivRound(minor(90_086_406_373), 99_984, 1)).toThrow(MoneyError);
  });

  it('stays exact past the safe-integer boundary via BigInt', () => {
    // 9e15 * 1000 overflows a double; the result must still be exact.
    expect(mulDivRound(minor(9_000_000_000_000_000), 1000, 1000)).toBe(9_000_000_000_000_000);
  });

  it('rejects a zero denominator rather than returning Infinity', () => {
    expect(() => mulDivRound(minor(100), 1, 0)).toThrow(MoneyError);
  });
});

describe('allocate', () => {
  it('never creates or destroys a minor unit', () => {
    fc.assert(
      fc.property(
        anyAmount,
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 12 })
          .filter((w) => w.reduce((s, x) => s + x, 0) > 0),
        (total, weights) => {
          expect(sum(allocate(total, weights))).toBe(total);
        },
      ),
    );
  });

  it('splits 10.01 sixty-forty without losing the odd cent', () => {
    expect(allocate(minor(1001), [60, 40])).toEqual([601, 400]);
  });

  it('distributes an indivisible remainder deterministically', () => {
    expect(allocateEvenly(minor(100), 3)).toEqual([34, 33, 33]);
    expect(allocateEvenly(minor(100), 3)).toEqual(allocateEvenly(minor(100), 3));
  });

  it('handles negative totals symmetrically', () => {
    expect(allocateEvenly(minor(-100), 3)).toEqual([-34, -33, -33]);
  });

  it('rejects weights that sum to zero', () => {
    expect(() => allocate(minor(100), [0, 0])).toThrow(MoneyError);
  });
});

describe('decimal strings', () => {
  it('round-trips exactly at every supported exponent', () => {
    fc.assert(
      fc.property(anyAmount, fc.integer({ min: 0, max: 4 }), (amount, exponent) => {
        expect(fromDecimalString(toDecimalString(amount, exponent), exponent)).toBe(amount);
      }),
    );
  });

  it('formats sub-unit amounts with a leading zero', () => {
    expect(toDecimalString(minor(5), 2)).toBe('0.05');
    expect(toDecimalString(minor(-5), 2)).toBe('-0.05');
    expect(toDecimalString(minor(0), 2)).toBe('0.00');
  });

  it('handles zero-decimal and three-decimal currencies', () => {
    expect(toDecimalString(minor(1234), 0)).toBe('1234'); // JPY
    expect(toDecimalString(minor(1234), 3)).toBe('1.234'); // BHD
  });

  it('parses either decimal separator and ignores grouping', () => {
    expect(fromDecimalString('1.234,56', 2)).toBe(123_456);
    expect(fromDecimalString('1,234.56', 2)).toBe(123_456);
    expect(fromDecimalString('1 234,56', 2)).toBe(123_456);
    expect(fromDecimalString('-12,50', 2)).toBe(-1250);
  });

  it('parses back an amount formatted for a no-break-space locale', () => {
    // fr-FR groups with U+202F (narrow no-break space); several others use
    // U+00A0. A user pasting a figure they copied out of the app must not hit
    // a parse error.
    expect(fromDecimalString('1 234,56', 2)).toBe(123_456);
    expect(fromDecimalString('1 234,56', 2)).toBe(123_456);
  });

  it('refuses to silently truncate excess precision', () => {
    expect(() => fromDecimalString('1.005', 2)).toThrow(/decimal places/);
  });

  it('rejects junk rather than coercing it to zero', () => {
    expect(() => fromDecimalString('abc', 2)).toThrow(MoneyError);
    expect(() => fromDecimalString('', 2)).toThrow(MoneyError);
  });
});
