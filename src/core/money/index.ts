/* The money module's public surface. Import from '@/core/money' — never reach
 * into the individual files, so the boundary stays enforceable. */

export type { Minor } from './minor';
export {
  MINOR_MAX,
  MoneyError,
  ZERO,
  abs,
  add,
  allocate,
  allocateEvenly,
  assertMinor,
  compare,
  fromDecimalString,
  isNegative,
  isPositive,
  isZero,
  max,
  min,
  minor,
  mulDivRound,
  mulInt,
  neg,
  sign,
  sub,
  sum,
  toDecimalString,
} from './minor';

export type { CurrencyCode } from './currency';
export {
  COMMON_CURRENCIES,
  assertCurrency,
  currencyDisplayName,
  currencySymbol,
  isSupportedCurrency,
  minorUnitExponent,
  minorUnitsPerMajor,
} from './currency';

export type { MoneyFormatOptions, MoneyParts } from './format';
export {
  formatAmountOnly,
  formatMoney,
  formatMoneyParts,
  resetFormatterCache,
} from './format';

export {
  DEFAULT_MAX_DIGITS,
  appendDigit,
  appendZeros,
  negate,
  removeLastDigit,
} from './keypad';

export type { BasisPoints } from './rate';
export {
  BP_PER_UNIT,
  BP_ZERO,
  addRates,
  applyBasisPoints,
  basisPoints,
  bpFromPercent,
  bpToPercent,
  formatRate,
  monthlyInterest,
} from './rate';
