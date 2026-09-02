import { describe, expect, it } from 'vitest';
import { appendDigit, appendZeros, negate, removeLastDigit } from './keypad';
import { minor, type Minor } from './minor';

/** Type a sequence the way a thumb would, with no render in between. */
const type = (keys: string, start: Minor = minor(0), maxDigits?: number): Minor =>
  [...keys].reduce(
    (acc, k) => (maxDigits === undefined ? appendDigit(acc, Number(k)) : appendDigit(acc, Number(k), maxDigits)),
    start,
  );

describe('appendDigit', () => {
  it('accumulates from the right — four taps make 12.34, not 0.04', () => {
    // The regression that motivated extracting this: each keystroke must build
    // on the previous result, never on a value captured before the burst.
    expect(type('1234')).toBe(1234);
    expect(type('9')).toBe(9);
    expect(type('100')).toBe(100);
  });

  it('treats a leading zero as no input', () => {
    expect(type('0')).toBe(0);
    expect(type('007')).toBe(7);
  });

  it('preserves the sign while typing', () => {
    expect(type('12', minor(-3))).toBe(-312);
  });

  it('stops at the digit cap instead of overflowing', () => {
    const capped = type('123456', minor(0), 4);
    expect(capped).toBe(1234);
    expect(appendDigit(capped, 9, 4)).toBe(1234);
  });

  it('ignores anything that is not a single digit', () => {
    expect(appendDigit(minor(12), 10)).toBe(12);
    expect(appendDigit(minor(12), -1)).toBe(12);
    expect(appendDigit(minor(12), 1.5)).toBe(12);
  });
});

describe('appendZeros', () => {
  it('shifts two places for the 00 key', () => {
    expect(appendZeros(minor(5))).toBe(500);
    expect(appendZeros(minor(0))).toBe(0);
  });

  it('respects the cap', () => {
    expect(appendZeros(minor(1234), 2, 5)).toBe(1234);
  });
});

describe('removeLastDigit', () => {
  it('undoes a digit', () => {
    expect(removeLastDigit(minor(1234))).toBe(123);
    expect(removeLastDigit(minor(1))).toBe(0);
    expect(removeLastDigit(minor(0))).toBe(0);
  });

  it('round-trips against typing', () => {
    expect(removeLastDigit(type('1234'))).toBe(type('123'));
  });

  it('clears the sign when it reaches zero, so -0 never appears', () => {
    expect(Object.is(removeLastDigit(minor(-5)), 0)).toBe(true);
  });
});

describe('negate', () => {
  it('flips an outflow to an inflow and back', () => {
    expect(negate(minor(1234))).toBe(-1234);
    expect(negate(negate(minor(1234)))).toBe(1234);
  });
});
