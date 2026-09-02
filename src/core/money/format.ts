/* ===========================================================================
 * THE CURRENCY FORMATTER
 * ---------------------------------------------------------------------------
 * This module is the single place in Sovereign that turns an amount into text
 * a person reads. Every component goes through it — directly, or via the
 * <Money> primitive. No component composes a symbol with a number itself, and
 * no currency symbol is written anywhere else in the codebase. That rule is
 * enforced by a test (see format.test.ts → "no hardcoded currency symbols").
 *
 * Two properties matter:
 *
 *  1. The symbol, separators, digit grouping and sign placement all come from
 *     Intl. Switching base currency is a config change, not a code change.
 *
 *  2. Amounts reach Intl as exact decimal *strings* built from integer minor
 *     units — never as `amount / 100`. No float is involved at any point
 *     between the ledger and the pixel.
 * ======================================================================== */

import { minorUnitExponent, type CurrencyCode } from './currency';
import { toDecimalString, type Minor } from './minor';

export interface MoneyFormatOptions {
  /** ISO-4217 code. Comes from app config; never hardcoded at a call site. */
  readonly currency: CurrencyCode;
  /** BCP-47 tag driving separators, grouping and symbol placement. */
  readonly locale: string;
  /** Intl's own vocabulary — no invented dialect. */
  readonly signDisplay?: 'auto' | 'always' | 'never' | 'exceptZero' | 'negative';
  /**
   * `auto`     the currency's own precision (€1,234.50)
   * `hide`     whole units only, for dense figures (€1,235)
   * `adaptive` hides decimals at or above 10 000 units, keeps them below
   */
  readonly decimals?: 'auto' | 'hide' | 'adaptive';
  /** Abbreviate large figures — €1.2M. For net-worth axis labels. */
  readonly compact?: boolean;
  /** `none` drops the symbol entirely, for keypad display and input fields. */
  readonly display?: 'symbol' | 'narrowSymbol' | 'code' | 'none';
}

export interface MoneyParts {
  /** '−' (U+2212 minus, not a hyphen), '+', or ''. */
  readonly sign: string;
  /** The currency symbol as ICU renders it — '€', '$', 'CHF'. May be ''. */
  readonly symbol: string;
  /** True when the symbol trails the number, as it does in fr-FR / de-DE. */
  readonly symbolTrails: boolean;
  /** Grouped integer part, e.g. '1,234'. */
  readonly integer: string;
  /** Locale decimal separator, '' when no fraction is shown. */
  readonly decimalSeparator: string;
  /** Fraction digits without the separator, e.g. '50'. '' when hidden. */
  readonly fraction: string;
  /** Compact-notation suffix — 'M', 'k', 'Mio.'. Trails the fraction. */
  readonly suffix: string;
  /** Spacing ICU places before the compact suffix — de-DE writes '1,2 Mio.'. */
  readonly suffixGap: string;
  /** Any literal spacing ICU places between symbol and number. */
  readonly gap: string;
  readonly isNegative: boolean;
  /** The fully assembled string — identical to `formatMoney`'s return. */
  readonly full: string;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function resolve(amount: Minor, options: MoneyFormatOptions): Intl.NumberFormat {
  const {
    currency,
    locale,
    signDisplay = 'auto',
    decimals = 'auto',
    compact = false,
    display = 'narrowSymbol',
  } = options;

  const exponent = minorUnitExponent(currency);
  const hideDecimals =
    decimals === 'hide' ||
    (decimals === 'adaptive' && Math.abs(amount) >= 10_000 * 10 ** exponent);

  const key = `${locale}|${currency}|${signDisplay}|${hideDecimals}|${compact}|${display}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const fractionDigits = hideDecimals ? 0 : exponent;

  // Compact notation picks its own precision (1.2M, not 1.20M). Forcing the
  // currency's fraction digits onto it produces the wrong abbreviation.
  const base: Intl.NumberFormatOptions = compact
    ? { signDisplay, notation: 'compact', compactDisplay: 'short' }
    : {
        signDisplay,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      };

  const formatter =
    display === 'none'
      ? new Intl.NumberFormat(locale, { ...base, style: 'decimal' })
      : new Intl.NumberFormat(locale, {
          ...base,
          style: 'currency',
          currency,
          currencyDisplay: display,
        });

  formatterCache.set(key, formatter);
  return formatter;
}

/**
 * Intl.NumberFormat accepts a decimal *string* and formats it without ever
 * converting to a double, so a value stays exact all the way to the screen.
 * Compact notation is the one mode that still wants a number.
 */
function formatExact(formatter: Intl.NumberFormat, decimal: string, compact: boolean): string {
  if (compact) return formatter.format(Number(decimal));
  return formatter.format(decimal as unknown as number);
}

function formatPartsExact(
  formatter: Intl.NumberFormat,
  decimal: string,
  compact: boolean,
): Intl.NumberFormatPart[] {
  if (compact) return formatter.formatToParts(Number(decimal));
  return formatter.formatToParts(decimal as unknown as number);
}

/** The primary entry point. Every displayed amount in the app comes from here. */
export function formatMoney(amount: Minor, options: MoneyFormatOptions): string {
  const decimal = toDecimalString(amount, minorUnitExponent(options.currency));
  const formatter = resolve(amount, options);
  const text = formatExact(formatter, decimal, options.compact ?? false);
  // ICU emits U+002D HYPHEN-MINUS; money reads better with a true minus sign,
  // which also keeps digits aligned in tabular columns.
  return text.replace(/-/g, '−');
}

/**
 * The same formatting, decomposed, so a component can style the pieces —
 * a large integer with small fraction digits on the dashboard anchor, say —
 * without ever assembling a currency symbol itself.
 */
export function formatMoneyParts(amount: Minor, options: MoneyFormatOptions): MoneyParts {
  const decimal = toDecimalString(amount, minorUnitExponent(options.currency));
  const formatter = resolve(amount, options);
  const parts = formatPartsExact(formatter, decimal, options.compact ?? false);

  let sign = '';
  let symbol = '';
  let integer = '';
  let decimalSeparator = '';
  let fraction = '';
  let suffix = '';
  let suffixGap = '';
  let gap = '';
  let seenNumber = false;
  let symbolTrails = false;
  // A locale can emit two literals in one string — 'de-DE' compact currency is
  // '1,2 Mio. €', with a space before the suffix and another before the
  // symbol. Literals are held until the next part reveals which one they are.
  let pendingLiteral = '';

  for (const part of parts) {
    switch (part.type) {
      case 'minusSign':
        sign = '−';
        break;
      case 'plusSign':
        sign = '+';
        break;
      case 'currency':
        symbol = part.value;
        symbolTrails = seenNumber;
        if (symbolTrails && pendingLiteral) {
          gap = pendingLiteral;
          pendingLiteral = '';
        }
        break;
      case 'integer':
      case 'group':
        integer += part.value;
        seenNumber = true;
        break;
      // The compact suffix trails the whole number ('1.3M'), so it cannot be
      // folded into the integer part — that would render as '1M.3'.
      case 'compact':
        suffixGap = pendingLiteral;
        pendingLiteral = '';
        suffix = part.value;
        seenNumber = true;
        break;
      case 'decimal':
        decimalSeparator = part.value;
        break;
      case 'fraction':
        fraction = part.value;
        break;
      case 'literal':
        if (symbol && !seenNumber) gap = part.value;
        else pendingLiteral = part.value;
        break;
      default:
        break;
    }
  }

  return {
    sign,
    symbol,
    symbolTrails,
    integer,
    decimalSeparator,
    fraction,
    suffix,
    suffixGap,
    gap,
    isNegative: amount < 0,
    full: formatMoney(amount, options),
  };
}

/**
 * A bare number with no symbol, for input fields and the keypad readout.
 * Still routed through Intl so separators stay locale-correct.
 */
export function formatAmountOnly(amount: Minor, options: MoneyFormatOptions): string {
  return formatMoney(amount, { ...options, display: 'none' });
}

/** Clears memoised formatters. Called when locale or currency changes. */
export function resetFormatterCache(): void {
  formatterCache.clear();
}
