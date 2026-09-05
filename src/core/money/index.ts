/* The money module's public surface. Import from '@/core/money' — never reach
 * into the individual files, so the boundary stays enforceable. */

export type { Minor } from './minor';
export {
  IDENTITY_RATE,
  MINOR_MAX,
  RATE_SCALE,
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

// The conversion routines are deliberately NOT re-exported here. This barrel
// is pulled in on the first paint by anything that formats money at all, and a
// re-export is edge enough to drag the whole BigInt conversion module along
// with it — in front of everybody, including the many people who only ever
// hold one currency. Every consumer of it is lazily loaded, so they import
// from './fx' directly.
export type { ConversionDirection, Rate1e6 } from './fx';

// Splitting a return into what the asset did and what the currency did is
// deliberately NOT re-exported here. This barrel is pulled in on the first
// paint — invariant I2 converts every line — and a re-export is edge enough to
// drag the decomposition, and every sentence explaining it, along with it.
// Import from './fxReturns' directly, from lazily loaded code only.
export type { ReturnDecomposition } from './fxReturns';

// The arithmetic evaluator is deliberately NOT re-exported here, for the same
// reason as the two above: this barrel loads on the first paint, and the
// parser is only ever reached from the keypad, which is inside a lazily loaded
// sheet. Import from './expression' directly.
export type { EvaluationResult } from './expression';
