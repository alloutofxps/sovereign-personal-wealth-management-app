/* ===========================================================================
 * THE REACT BINDING FOR OTHER CURRENCIES
 * ---------------------------------------------------------------------------
 * Two jobs. Formatting an amount in a currency that is not the household's —
 * which `useMoney` deliberately cannot do, because taking a currency argument
 * is exactly how hardcoded symbols creep back in — and converting one for the
 * quiet second line underneath.
 *
 * A converted figure is always an estimate and is always written as one. The
 * rate it used is a rate somebody typed on some particular day, and presenting
 * "≈ €11,472.37" as though it were a balance would be claiming a precision the
 * app does not have.
 * ======================================================================== */

import { useCallback, useMemo } from 'react';
import { formatMoney, type CurrencyCode, type Minor } from '@/core/money';
// Deep import on purpose: see the note in the money barrel.
import { toBaseCurrency, type Rate1e6 } from '@/core/money/fx';
import { useAppConfig } from '@/app/config/store';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { FX_TABLES, latestRates, type FxRateRow } from '@/data/repositories/fxRepo';

export interface FxView {
  baseCurrency: string;
  /** The latest rate on record for each foreign currency. */
  rates: Map<string, FxRateRow>;
  /** True when at least one currency other than the base one has a rate. */
  hasForeign: boolean;
  /** Format an amount in a named currency: `$12,450.00`. */
  formatIn: (amount: Minor, currency: string) => string;
  /**
   * What a foreign amount is worth in the reporting currency, or null when no
   * rate has been recorded for it yet.
   */
  toBase: (amount: Minor, currency: string) => Minor | null;
  /** The muted second line: `≈ €11,472.37`, or null when there is no rate. */
  approxInBase: (amount: Minor, currency: string) => string | null;
  /** Whether this currency needs a second line at all. */
  isForeign: (currency: string | null | undefined) => boolean;
}

export function useFx(): FxView {
  const baseCurrency = useAppConfig((s) => s.currencyCode);
  const locale = useAppConfig((s) => s.locale);

  const query = useLiveQuery(
    useCallback(() => latestRates(baseCurrency), [baseCurrency]),
    FX_TABLES,
  );

  const rates = useMemo(
    () => new Map((query.data ?? []).map((row) => [row.quoteCurrency, row])),
    [query.data],
  );

  const formatIn = useCallback(
    (amount: Minor, currency: string) =>
      formatMoney(amount, { currency: currency as CurrencyCode, locale }),
    [locale],
  );

  const toBase = useCallback(
    (amount: Minor, currency: string): Minor | null => {
      if (currency === baseCurrency) return amount;
      const row = rates.get(currency);
      if (!row) return null;
      return toBaseCurrency({
        amount,
        rateScaled: row.rateScaled as Rate1e6,
        quoteCurrency: currency as CurrencyCode,
        baseCurrency: baseCurrency as CurrencyCode,
      });
    },
    [rates, baseCurrency],
  );

  const approxInBase = useCallback(
    (amount: Minor, currency: string): string | null => {
      if (currency === baseCurrency) return null;
      const converted = toBase(amount, currency);
      if (converted === null) return null;
      // The "≈" is not decoration. The rate was typed on some particular day,
      // and this figure is only as current as that.
      return `≈ ${formatMoney(converted, { currency: baseCurrency as CurrencyCode, locale })}`;
    },
    [toBase, baseCurrency, locale],
  );

  const isForeign = useCallback(
    (currency: string | null | undefined) => Boolean(currency && currency !== baseCurrency),
    [baseCurrency],
  );

  return {
    baseCurrency,
    rates,
    hasForeign: rates.size > 0,
    formatIn,
    toBase,
    approxInBase,
    isForeign,
  };
}
