/* ===========================================================================
 * CURRENCY METADATA
 * ---------------------------------------------------------------------------
 * Everything the app knows about a currency comes from the platform's ICU
 * data via `Intl`, never from a hand-maintained table. That means the minor-
 * unit exponent, the symbol and the display name are correct for all ~160 ISO
 * currencies on day one, and correct for the user's locale — without shipping
 * a byte of currency data or hardcoding a single symbol.
 * ======================================================================== */

import { MoneyError } from './minor';

/** ISO-4217 alphabetic code, e.g. 'EUR'. */
export type CurrencyCode = string;

const exponentCache = new Map<CurrencyCode, number>();

/**
 * The set of currencies ICU actually has data for.
 *
 * `new Intl.NumberFormat(..., { currency })` is not a validity check — it
 * accepts any well-formed three-letter code and silently falls back to
 * printing the code itself, so 'XYZ' would sail through and only reveal
 * itself as a bad symbol on screen. `supportedValuesOf` is the real list.
 */
let supported: Set<string> | null = null;

function supportedCurrencies(): Set<string> {
  supported ??= new Set(Intl.supportedValuesOf('currency'));
  return supported;
}

export function isSupportedCurrency(code: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(code)) return false;
  return supportedCurrencies().has(code.toUpperCase());
}

export function assertCurrency(code: string): asserts code is CurrencyCode {
  if (!isSupportedCurrency(code)) {
    throw new MoneyError(
      `"${code}" is not a supported ISO-4217 currency code.`,
    );
  }
}

/**
 * Number of decimal places in this currency's minor unit.
 * EUR/USD → 2, JPY → 0, BHD → 3. Read from ICU, cached per code.
 */
export function minorUnitExponent(code: CurrencyCode): number {
  const cached = exponentCache.get(code);
  if (cached !== undefined) return cached;

  assertCurrency(code);
  const resolved = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
  }).resolvedOptions();

  // `maximumFractionDigits` under style:'currency' is the ISO minor-unit
  // exponent. Guard anyway — a bad value here would corrupt every amount.
  const exponent = resolved.maximumFractionDigits;
  if (exponent === undefined || !Number.isInteger(exponent) || exponent < 0 || exponent > 8) {
    throw new MoneyError(`Could not resolve minor units for "${code}"`);
  }

  exponentCache.set(code, exponent);
  return exponent;
}

/** `10 ** minorUnitExponent` — minor units per major unit. */
export function minorUnitsPerMajor(code: CurrencyCode): number {
  return 10 ** minorUnitExponent(code);
}

/** Localised display name, e.g. 'Euro'. Used in the currency picker only. */
export function currencyDisplayName(code: CurrencyCode, locale: string): string {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'currency' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The symbol ICU uses for this currency in this locale. Exposed *only* for
 * the currency picker and for the numeric keypad's affix — no other component
 * should ever need a bare symbol, because `formatMoney` already includes it.
 */
export function currencySymbol(code: CurrencyCode, locale: string): string {
  assertCurrency(code);
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'narrowSymbol',
  }).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? code;
}

/**
 * The currencies offered in settings. Deliberately a shortlist of common base
 * currencies rather than all 160 — v1 is single-currency, so this is a base
 * unit choice, not a portfolio. Any valid ISO code still works if set
 * directly; this list only drives the picker.
 */
export const COMMON_CURRENCIES: readonly CurrencyCode[] = [
  'EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
  'CAD', 'AUD', 'NZD', 'JPY', 'SGD', 'HKD', 'INR', 'AED', 'ZAR', 'BRL', 'MXN',
];
