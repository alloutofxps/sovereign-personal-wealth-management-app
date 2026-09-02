/* ===========================================================================
 * THE REACT BINDING FOR MONEY
 * ---------------------------------------------------------------------------
 * Components never pass a currency themselves — they take it from config
 * through this hook, or render a <Money> element. That is what makes
 * "change the base currency" a one-line change in settings.
 * ======================================================================== */

import { useMemo } from 'react';
import {
  formatAmountOnly,
  formatMoney,
  formatMoneyParts,
  minorUnitExponent,
  type Minor,
  type MoneyFormatOptions,
  type MoneyParts,
} from '@/core/money';
import { useAppConfig } from '@/app/config/store';

/** Per-call presentation options. Currency and locale are never among them. */
export type MoneyDisplayOptions = Omit<MoneyFormatOptions, 'currency' | 'locale'>;

export interface MoneyFormatter {
  /** Full formatted amount, symbol included. */
  format: (amount: Minor, options?: MoneyDisplayOptions) => string;
  /** Decomposed, for styling the pieces without assembling a symbol. */
  parts: (amount: Minor, options?: MoneyDisplayOptions) => MoneyParts;
  /** Digits only, for inputs and the keypad readout. */
  amountOnly: (amount: Minor, options?: MoneyDisplayOptions) => string;
  currency: string;
  locale: string;
  /** Decimal places for the active currency: 2 for EUR, 0 for JPY. */
  exponent: number;
}

export function useMoney(): MoneyFormatter {
  const currency = useAppConfig((s) => s.currencyCode);
  const locale = useAppConfig((s) => s.locale);

  return useMemo(() => {
    const base = { currency, locale };
    return {
      format: (amount, options) => formatMoney(amount, { ...base, ...options }),
      parts: (amount, options) => formatMoneyParts(amount, { ...base, ...options }),
      amountOnly: (amount, options) => formatAmountOnly(amount, { ...base, ...options }),
      currency,
      locale,
      exponent: minorUnitExponent(currency),
    };
  }, [currency, locale]);
}
