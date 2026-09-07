/* ===========================================================================
 * APP CONFIGURATION
 * ---------------------------------------------------------------------------
 * The base currency lives here and nowhere else. v1 is deliberately single-
 * currency: there is no FX engine, no rate table and no per-account
 * denomination. Every amount in the ledger is in `currencyCode`.
 *
 * That is enforced, not assumed — `assertLedgerCurrency` below is the single
 * gate, and when multi-currency arrives it becomes a conversion point rather
 * than a rewrite.
 * ======================================================================== */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  MoneyError,
  assertCurrency,
  resetFormatterCache,
  type CurrencyCode,
} from '@/core/money';

/** Used when nothing is stored yet and the platform gives us no better hint. */
export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';
export const DEFAULT_LOCALE = 'en-GB';

/** A sensible starting cushion. Changed in Settings. */
export const DEFAULT_BUFFER_MINOR = 20_000;

export interface AppConfig {
  /** ISO-4217 base currency for the entire ledger. */
  currencyCode: CurrencyCode;
  /** BCP-47 tag driving number, date and currency presentation. */
  locale: string;
  /** First day of the week, 1 = Monday. Drives the weekly review ritual. */
  weekStartsOn: 0 | 1;
  /** Day the weekly reset ritual is offered. 0 = Sunday, per the research. */
  weeklyReviewDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * The cushion that is never counted as safe to spend, in minor units.
   * It exists so a forgotten direct debit cannot tip an account overdrawn.
   */
  bufferMinor: number;
  /**
   * Which tax regime the deferred-tax figure is worked out under.
   *
   * 'none' is the default and means the figure is not shown at all. An app
   * that guesses somebody's tax regime from their currency would be wrong for
   * every household that has moved, and wrong quietly.
   */
  taxRegime: 'none' | 'dutch_box3' | 'flat_gains';
  /** The rate for a flat-gains regime, in basis points. Ignored otherwise. */
  cgtRateBp: number;
  /** The yearly exemption for a flat-gains regime, in minor units. */
  cgtExemptionMinor: number;
}

interface AppConfigStore extends AppConfig {
  setCurrency: (code: string) => void;
  setLocale: (locale: string) => void;
  setWeeklyReviewDay: (day: AppConfig['weeklyReviewDay']) => void;
  setBuffer: (minorAmount: number) => void;
  setTaxRegime: (regime: AppConfig['taxRegime']) => void;
  setCgt: (rateBp: number, exemptionMinor: number) => void;
}

function detectLocale(): string {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  return navigator.language || DEFAULT_LOCALE;
}

export const useAppConfig = create<AppConfigStore>()(
  persist(
    (set) => ({
      currencyCode: DEFAULT_CURRENCY,
      locale: detectLocale(),
      weekStartsOn: 1,
      weeklyReviewDay: 0,
      bufferMinor: DEFAULT_BUFFER_MINOR,
      taxRegime: 'none',
      cgtRateBp: 3_300,
      cgtExemptionMinor: 127_000,

      setCurrency: (code) => {
        const normalised = code.toUpperCase();
        assertCurrency(normalised);
        // Memoised Intl formatters are keyed by currency; drop them so the
        // change takes effect everywhere on the next render.
        resetFormatterCache();
        set({ currencyCode: normalised });
      },

      setLocale: (locale) => {
        resetFormatterCache();
        set({ locale });
      },

      setWeeklyReviewDay: (weeklyReviewDay) => set({ weeklyReviewDay }),

      setBuffer: (minorAmount) =>
        set({ bufferMinor: Math.max(0, Math.round(minorAmount)) }),

      setTaxRegime: (taxRegime) => set({ taxRegime }),

      setCgt: (rateBp, exemptionMinor) =>
        set({
          // Clamped rather than validated: a rate outside nought to a hundred
          // per cent is a typo, and refusing the whole change would lose the
          // rest of what was typed.
          cgtRateBp: Math.min(10_000, Math.max(0, Math.round(rateBp))),
          cgtExemptionMinor: Math.max(0, Math.round(exemptionMinor)),
        }),
    }),
    {
      name: 'sovereign.config',
      version: 1,
      // Never trust what came out of storage — a hand-edited or migrated
      // value could otherwise put an invalid currency into every formatter.
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<AppConfig>;
        const currencyCode =
          incoming.currencyCode && isValid(incoming.currencyCode)
            ? incoming.currencyCode
            : current.currencyCode;
        return { ...current, ...incoming, currencyCode };
      },
    },
  ),
);

function isValid(code: string): boolean {
  try {
    assertCurrency(code);
    return true;
  } catch {
    return false;
  }
}

/* ===========================================================================
 * WHAT-IF ASSUMPTIONS
 * ---------------------------------------------------------------------------
 * The independence projection needs figures the ledger does not hold — what is
 * invested elsewhere, what goes in each month, what a year costs. They live
 * here rather than in SQLite because they are assumptions about the future,
 * not records of anything that happened.
 * ======================================================================== */

export interface IndependenceAssumptions {
  invested: number;
  monthlyContribution: number;
  /** Zero means "work it out from what I have recorded". */
  annualSpending: number;
  /** Expected return after inflation, in basis points. */
  realReturnBp: number;
  withdrawalRateBp: number;
  currentAge: number;
  retirementAge: number;
  setInvested: (value: number) => void;
  setMonthlyContribution: (value: number) => void;
  setAnnualSpending: (value: number) => void;
  setWithdrawalRate: (bp: number) => void;
  setRealReturn: (bp: number) => void;
  setAges: (current: number, retirement: number) => void;
}

export const useIndependenceAssumptions = create<IndependenceAssumptions>()(
  persist(
    (set) => ({
      invested: 0,
      monthlyContribution: 0,
      annualSpending: 0,
      // 5% after inflation — a common long-run assumption, and adjustable.
      realReturnBp: 500,
      withdrawalRateBp: 400,
      currentAge: 35,
      retirementAge: 65,
      setInvested: (invested) => set({ invested: Math.max(0, Math.round(invested)) }),
      setMonthlyContribution: (monthlyContribution) =>
        set({ monthlyContribution: Math.max(0, Math.round(monthlyContribution)) }),
      setAnnualSpending: (annualSpending) =>
        set({ annualSpending: Math.max(0, Math.round(annualSpending)) }),
      setWithdrawalRate: (withdrawalRateBp) =>
        set({ withdrawalRateBp: Math.min(450, Math.max(300, Math.round(withdrawalRateBp))) }),
      setRealReturn: (realReturnBp) =>
        set({ realReturnBp: Math.min(1200, Math.max(0, Math.round(realReturnBp))) }),
      setAges: (currentAge, retirementAge) => set({ currentAge, retirementAge }),
    }),
    { name: 'sovereign.independence', version: 1 },
  ),
);

/** Read config outside React — workers, the ledger core, event handlers. */
export const getAppConfig = (): AppConfig => {
  const { currencyCode, locale, weekStartsOn, weeklyReviewDay, bufferMinor, taxRegime, cgtRateBp, cgtExemptionMinor } =
    useAppConfig.getState();
  return {
    currencyCode,
    locale,
    weekStartsOn,
    weeklyReviewDay,
    bufferMinor,
    taxRegime,
    cgtRateBp,
    cgtExemptionMinor,
  };
};

/**
 * The single-currency gate. Every write path into the ledger calls this, so
 * the day multi-currency arrives there is exactly one place that has to learn
 * how to convert rather than reject.
 */
export function assertLedgerCurrency(code: CurrencyCode): void {
  const base = useAppConfig.getState().currencyCode;
  if (code !== base) {
    throw new MoneyError(
      `This ledger is denominated in ${base}; received ${code}. ` +
        `Multi-currency conversion is not part of v1.`,
    );
  }
}
