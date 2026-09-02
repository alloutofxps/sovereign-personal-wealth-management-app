/* ===========================================================================
 * KEYPAD ACCUMULATION
 * ---------------------------------------------------------------------------
 * Point-of-sale digit entry, as pure functions over Minor.
 *
 * These live outside the component on purpose. Keeping them here means the
 * entry rules are unit-testable without a DOM, and that the component cannot
 * accidentally reimplement them against a stale closure — the failure that
 * turns four fast taps into a single digit.
 * ======================================================================== */

import { minor, type Minor } from './minor';

/** Digits allowed in total. 12 is ~10 billion major units at two decimals. */
export const DEFAULT_MAX_DIGITS = 12;

function withSign(magnitude: number, negative: boolean): Minor {
  return minor(magnitude === 0 ? 0 : negative ? -magnitude : magnitude);
}

function fits(magnitude: number, maxDigits: number): boolean {
  return Number.isSafeInteger(magnitude) && String(magnitude).length <= maxDigits;
}

/** Shift a digit in from the right. `12` + `3` becomes `123` (i.e. 1.23). */
export function appendDigit(
  value: Minor,
  digit: number,
  maxDigits: number = DEFAULT_MAX_DIGITS,
): Minor {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return value;
  const magnitude = Math.abs(value) * 10 + digit;
  if (!fits(magnitude, maxDigits)) return value;
  return withSign(magnitude, value < 0);
}

/** The "00" key financial keypads carry. Shifts two places at once. */
export function appendZeros(
  value: Minor,
  count = 2,
  maxDigits: number = DEFAULT_MAX_DIGITS,
): Minor {
  const magnitude = Math.abs(value) * 10 ** count;
  if (!fits(magnitude, maxDigits)) return value;
  return withSign(magnitude, value < 0);
}

/** Drop the rightmost digit. Reaching zero clears the sign too. */
export function removeLastDigit(value: Minor): Minor {
  const magnitude = Math.floor(Math.abs(value) / 10);
  return withSign(magnitude, value < 0);
}

/** Flip between an outflow and an inflow — corrections, refunds. */
export function negate(value: Minor): Minor {
  return minor(-value);
}
