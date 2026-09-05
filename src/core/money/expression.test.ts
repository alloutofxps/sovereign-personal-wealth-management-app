import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ExpressionError,
  evaluateExpression,
  isExpression,
  tokenize,
  tryEvaluate,
} from './expression';

const at = (input: string) => evaluateExpression(input).value;

describe('plain numbers', () => {
  it('reads a whole figure', () => {
    expect(at('45')).toBe(4_500);
  });

  it('reads a decimal one', () => {
    expect(at('45.20')).toBe(4_520);
    expect(at('0.07')).toBe(7);
  });

  it('reads a leading point as the cents somebody meant', () => {
    expect(at('.50')).toBe(50);
  });

  it('takes a comma as a decimal point, because half of Europe writes it that way', () => {
    expect(at('45,20')).toBe(4_520);
  });

  it('knows a bare figure is not a sum', () => {
    expect(evaluateExpression('45.20').literal).toBe(true);
    expect(evaluateExpression('45.20 + 1').literal).toBe(false);
  });
});

describe('the four operations', () => {
  it('adds and subtracts exactly', () => {
    expect(at('45.20 + 12.80')).toBe(5_800);
    expect(at('100 - 33.33')).toBe(6_667);
  });

  it('multiplies and divides', () => {
    expect(at('12.50 * 4')).toBe(5_000);
    expect(at('100 / 4')).toBe(2_500);
  });

  it('accepts the characters that are actually on the keys', () => {
    expect(at('12.50 × 4')).toBe(5_000);
    expect(at('100 ÷ 4')).toBe(2_500);
  });

  it('does not care about spaces', () => {
    expect(at('45.20+12.80')).toBe(at('45.20 + 12.80'));
    expect(at('  8 * 2  ')).toBe(1_600);
  });
});

describe('precedence and brackets', () => {
  it('multiplies before it adds', () => {
    // The worked example: 45.50 + 12.25 × 2 = 45.50 + 24.50 = 70.00
    expect(at('45.50 + 12.25 * 2')).toBe(7_000);
  });

  it('lets brackets say otherwise', () => {
    expect(at('(45.50 + 12.25) * 2')).toBe(11_550);
  });

  it('subtracts left to right, not right to left', () => {
    // 10 − 3 − 2 is 5. Right-associative would give 9.
    expect(at('10 - 3 - 2')).toBe(500);
  });

  it('divides left to right too', () => {
    expect(at('100 / 5 / 2')).toBe(1_000);
  });

  it('handles nesting', () => {
    expect(at('((2 + 3) * (4 - 1))')).toBe(1_500);
  });
});

describe('splitting a bill, which is what this is for', () => {
  it('divides a restaurant bill three ways', () => {
    // €87.60 between three. A third is 29.20 exactly.
    expect(at('87.60 / 3')).toBe(2_920);
  });

  it('rounds a third of ten to the nearest cent', () => {
    // 3.3333… cannot be money, so it becomes 3.33.
    expect(at('10 / 3')).toBe(333);
  });

  it('adds a tip to a split', () => {
    expect(at('(60 / 4) + 2.50')).toBe(1_750);
  });
});

describe('what it refuses', () => {
  it('refuses letters', () => {
    expect(() => at('45 + abc')).toThrow(ExpressionError);
    expect(() => at('45 + abc')).toThrow(/not something this can work out/);
  });

  it('refuses anything that looks like code', () => {
    // The whole reason this is a parser and not an evaluator.
    expect(() => at('alert(1)')).toThrow(ExpressionError);
    expect(() => at('1;2')).toThrow(ExpressionError);
    expect(() => at('[].constructor')).toThrow(ExpressionError);
    expect(() => at('1 ** 2')).toThrow();
  });

  it('refuses division by nothing', () => {
    expect(() => at('10 / 0')).toThrow(/divided by nothing/);
    expect(() => at('10 / (5 - 5)')).toThrow(/divided by nothing/);
  });

  it('refuses an unfinished sum', () => {
    expect(() => at('45 +')).toThrow(/not finished/);
    expect(() => at('* 4')).toThrow(/not finished/);
  });

  it('refuses unbalanced brackets in both directions', () => {
    expect(() => at('(45 + 2')).toThrow(/left open/);
    expect(() => at('45 + 2)')).toThrow(/nothing to close/);
  });

  it('refuses an answer below nothing', () => {
    // An amount field asks how much. Direction is the entry's job.
    expect(() => at('10 - 30')).toThrow(/less than nothing/);
  });

  it('refuses an empty field', () => {
    expect(() => at('')).toThrow(/nothing to work out/);
    expect(() => at('   ')).toThrow(/nothing to work out/);
  });
});

describe('while somebody is still typing', () => {
  it('gives nothing back rather than raising', () => {
    expect(tryEvaluate('45 +')).toBeNull();
    expect(tryEvaluate('')).toBeNull();
    expect(tryEvaluate('45 + 5')).toBe(5_000);
  });

  it('knows when working is worth showing', () => {
    expect(isExpression('45.20')).toBe(false);
    expect(isExpression('45.20 + 1')).toBe(true);
    expect(isExpression('(45)')).toBe(true);
  });
});

describe('tokenizing', () => {
  it('reads a number, an operator and a number', () => {
    expect(tokenize('12+3')).toEqual([
      { kind: 'number', value: 12 },
      { kind: 'op', value: '+' },
      { kind: 'number', value: 3 },
    ]);
  });

  it('reads brackets as their own tokens', () => {
    expect(tokenize('(1)')).toEqual([
      { kind: 'open' },
      { kind: 'number', value: 1 },
      { kind: 'close' },
    ]);
  });
});

/* ===========================================================================
 * THE PROPERTIES
 * ---------------------------------------------------------------------------
 * The reason this exists rather than a float parse: money arithmetic has to be
 * exact, and the classic float error appears in exactly the sums people do
 * most — adding two prices together.
 * ======================================================================== */

describe('exactness', () => {
  it('never drifts on addition, however many terms', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 99_999 }), { minLength: 2, maxLength: 12 }),
        (cents) => {
          const terms = cents.map((c) => (c / 100).toFixed(2));
          const expected = cents.reduce((a, b) => a + b, 0);
          expect(at(terms.join(' + '))).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('adds the two numbers that famously do not add up', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in float. Here it is 30 cents.
    expect(at('0.1 + 0.2')).toBe(30);
  });

  it('multiplying by a whole number is the same as adding that many times', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 1, max: 9 }),
        (cents, times) => {
          const amount = (cents / 100).toFixed(2);
          const repeated = Array.from({ length: times }, () => amount).join(' + ');
          expect(at(`${amount} * ${times}`)).toBe(at(repeated));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a bare figure evaluates to what parsing it would give', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_999_999 }), (cents) => {
        expect(at((cents / 100).toFixed(2))).toBe(cents);
      }),
      { numRuns: 200 },
    );
  });

  it('never returns a non-integer, whatever it is given', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999 }),
        fc.integer({ min: 1, max: 99 }),
        (cents, divisor) => {
          const result = at(`${(cents / 100).toFixed(2)} / ${divisor}`);
          expect(Number.isSafeInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
