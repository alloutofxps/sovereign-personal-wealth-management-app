/* ===========================================================================
 * TURNING TEXT INTO DATES AND AMOUNTS
 * ---------------------------------------------------------------------------
 * The two places a bank import silently goes wrong.
 *
 * Dates: 03/04/2026 is the third of April in most of the world and the fourth
 * of March in the United States. Guessing per row is how a statement ends up
 * scattered across two months, so the format is worked out once from the whole
 * column and then applied to every row.
 *
 * Amounts: 1.234,56 and 1,234.56 are the same number written by different
 * countries. Both are accepted, decided by which separator comes last.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export interface DateFormat {
  order: DateOrder;
  /** How sure we are. Below 1 the mapping screen shows the choice. */
  confidence: number;
  /** True when the column is unambiguous — a day above 12 settles it. */
  proven: boolean;
}

/**
 * Work out the order from the whole column at once.
 *
 * A single value above twelve in the first position proves day-first; one in
 * the second proves month-first. Without such a value the order is genuinely
 * ambiguous and the person is asked rather than guessed at.
 */
export function detectDateFormat(values: readonly string[]): DateFormat {
  let firstOverTwelve = 0;
  let secondOverTwelve = 0;
  let yearFirst = 0;
  let seen = 0;

  for (const value of values) {
    const parts = value.trim().split(/[-/.]/);
    if (parts.length !== 3) continue;
    const [a, b] = parts.map((p) => Number(p));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    seen++;

    if ((parts[0] ?? '').length === 4) yearFirst++;
    else if (a! > 12) firstOverTwelve++;
    else if (b! > 12) secondOverTwelve++;
  }

  if (seen === 0) return { order: 'dmy', confidence: 0, proven: false };
  if (yearFirst > seen / 2) return { order: 'ymd', confidence: 1, proven: true };
  if (firstOverTwelve > 0) return { order: 'dmy', confidence: 1, proven: true };
  if (secondOverTwelve > 0) return { order: 'mdy', confidence: 1, proven: true };

  // Nothing in the column settles it. Day-first is the world's majority, but
  // this is exactly the case the mapping screen must not hide.
  return { order: 'dmy', confidence: 0.5, proven: false };
}

/** Parse one date in a known order. Returns 'YYYY-MM-DD', or null. */
export function parseDate(value: string, order: DateOrder): string | null {
  const parts = value.trim().split(/[-/.]/);
  if (parts.length !== 3) return null;

  const numbers = parts.map((p) => Number(p));
  if (numbers.some((n) => !Number.isFinite(n))) return null;

  let day: number;
  let month: number;
  let year: number;

  if (order === 'ymd') [year, month, day] = numbers as [number, number, number];
  else if (order === 'mdy') [month, day, year] = numbers as [number, number, number];
  else [day, month, year] = numbers as [number, number, number];

  // Two-digit years: everything a bank exports is this century.
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject the 31st of a thirty-day month rather than rolling into the next.
  if (day > new Date(year, month, 0).getDate()) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse an amount, in whatever way the file writes them.
 *
 * Handles both separator conventions, a trailing minus, parentheses for
 * negatives, and stray currency symbols. Returns minor units, exactly.
 */
export function parseAmount(value: string, exponent: number): Minor | null {
  const raw = value.trim();
  if (raw === '') return null;

  // Accounting style: (12.34) means minus twelve thirty-four.
  const bracketed = /^\(.*\)$/.test(raw);
  // Some exports put the minus at the end: 12.34-
  const trailingMinus = /-\s*$/.test(raw);

  const cleaned = raw.replace(/[()\s]/g, '').replace(/[^\d.,+-]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const negative = bracketed || trailingMinus || /^-/.test(cleaned);
  const digits = cleaned.replace(/[+-]/g, '');

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);

  let whole: string;
  let fraction: string;

  if (decimalAt === -1) {
    whole = digits;
    fraction = '';
  } else {
    const after = digits.slice(decimalAt + 1);
    // Three digits after the last separator means it was grouping, not a
    // decimal point: 1,234 is one thousand two hundred and thirty-four.
    if (after.length === 3 && digits.length > 4) {
      whole = digits.replace(/[.,]/g, '');
      fraction = '';
    } else {
      whole = digits.slice(0, decimalAt).replace(/[.,]/g, '');
      fraction = after;
    }
  }

  if (fraction.length > exponent) fraction = fraction.slice(0, exponent);
  const combined = `${whole || '0'}${fraction.padEnd(exponent, '0')}`;

  const parsed = Number(combined);
  if (!Number.isSafeInteger(parsed)) return null;

  return minor(negative ? -parsed : parsed);
}

/**
 * A stable fingerprint for a row, so importing the same statement twice does
 * not double every transaction.
 *
 * Built from the things a bank will not change between exports: the account,
 * the date, the amount, and the descriptor with its reference numbers and
 * punctuation stripped out.
 */
export function dedupeKey(input: {
  accountId: string;
  date: string;
  amount: Minor;
  description: string;
}): string {
  const normalised = input.description
    .toUpperCase()
    .replace(/\d{6,}/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${input.accountId}|${input.date}|${input.amount}|${normalised}`;
}
