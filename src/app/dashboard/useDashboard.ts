/* ===========================================================================
 * THE DASHBOARD, ASSEMBLED
 * ---------------------------------------------------------------------------
 * One live query behind the whole home screen. Everything it returns is
 * derived from the journal and the list of regular payments, so recording an
 * expense recalculates the headline figure, the daily allowance, the pacing
 * bars and the curve together — there is no separate state to fall behind.
 * ======================================================================== */

import { useCallback } from 'react';
import { minor, type Minor } from '@/core/money';
import { isoDate, type AccountId } from '@/core/ledger';
import {
  CADENCE_NOUNS,
  calculatePacing,
  calculateSafeToSpend,
  daysBetween,
  paycheckCycle,
  toIsoDate,
  type BudgetCadence,
  type Commitment,
  type Cycle,
  type PacingResult,
  type SafeToSpendResult,
} from '@/core/liquidity';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import {
  LEDGER_TABLES,
  balancesByType,
  countEntries,
  netWorthAsOf,
  spendByDay,
  totalAssets,
  spendableCash,
} from '@/data/repositories/ledgerRepo';
import { listScheduled, occurrencesWithin } from '@/data/repositories/scheduleRepo';
import { potTargets } from '@/data/repositories/potsRepo';
import { totalOwedToYou } from '@/data/repositories/claimsRepo';
import { DEFAULT_BUDGET_SETTINGS, readBudgetSettings } from '@/data/repositories/budgetSettingsRepo';
import { planFor, reservedForPots, type PotPlan } from '@/core/goals';
import { useAppConfig } from '@/app/config/store';

/** How far ahead "already promised" reaches. */
const HORIZON_DAYS = 30;

/**
 * Debts that are paid down over a term rather than settled from this month's
 * cash. Their balance is not a claim on what is safe to spend; their monthly
 * payment is, and that is budgeted out of a pot like any other bill.
 */
const AMORTIZING_CLASSES = new Set(['mortgage', 'loan']);

/** Anything due inside this window is worth surfacing today. */
export const SOON_HOURS = 72;

export interface DebtLine {
  id: AccountId;
  name: string;
  amount: Minor;
}

export interface UpcomingBill {
  name: string;
  amount: Minor;
  date: string;
  daysAway: number;
}

export interface DashboardData {
  today: string;
  cycle: Cycle;
  /**
   * The rhythm the cycle above was cut on. The daily allowance and the pacing
   * bars only mean anything against the period a person actually budgets in,
   * so somebody paid fortnightly gets a fortnight here, not a calendar month.
   */
  cadence: BudgetCadence;
  liquidity: SafeToSpendResult;
  pacing: PacingResult;
  /** What you have, in everyday accounts and savings. */
  liquidCash: Minor;
  /** Everything owed, card by card. */
  debts: DebtLine[];
  totalDebt: Minor;
  /** Money set aside towards those debts. */
  reserved: Minor;
  /** True when every penny of card debt already has money waiting for it. */
  billsCovered: boolean;
  netWorth: Minor;
  buffer: Minor;
  /** Bills due within the next three days. */
  dueSoon: UpcomingBill[];
  /** Everything due inside the horizon, for the breakdown sheet. */
  upcoming: UpcomingBill[];
  hasSchedule: boolean;
  /** Every pot saving up for something, with what it needs this month. */
  pots: PotPlan[];
  /** Money you fronted that has not come back yet. */
  owedToYou: Minor;
  /** What you were worth at the end of last month, and the change since. */
  netWorthLastMonth: Minor;
  netWorthChange: Minor;
  /**
   * Whether there is anything in the ledger at all.
   *
   * On a brand-new install the cushion alone would make the headline figure
   * negative — telling someone who has recorded nothing that they are two
   * hundred pounds short. That is exactly the punitive framing the product
   * exists to avoid, so the dashboard shows a welcome instead.
   */
  hasActivity: boolean;
}

export function useDashboard(): LiveQueryResult<DashboardData> {
  const bufferMinor = useAppConfig((s) => s.bufferMinor);

  const query = useCallback(async (): Promise<DashboardData> => {
    const today = toIsoDate(new Date());

    // The home screen and the budget grid must agree about where a period
    // starts, or "left to spend" and "left in your pots" would be measured
    // over different stretches of the same month.
    const settings = await readBudgetSettings().catch(() => DEFAULT_BUDGET_SETTINGS);
    const cycle = paycheckCycle(
      settings.paycheckAnchor ?? today,
      settings.cadence,
      today,
    );
    const horizonEnd = addDaysIso(today, HORIZON_DAYS);

    const [cash, liabilities, envelopes, byDay, scheduled, entryCount, targets, owedToYou] =
      await Promise.all([
        spendableCash(),
        balancesByType('LIABILITY'),
        balancesByType('ENVELOPE'),
        spendByDay(isoDate(cycle.start), isoDate(cycle.end)),
        listScheduled(),
        countEntries(),
        potTargets(isoDate(cycle.start), isoDate(cycle.end)),
        totalOwedToYou(),
      ]);

    const assets = await totalAssets();

    const netWorthLastMonth = await netWorthAsOf(isoDate(addDaysIso(cycle.start, -1)));

    const pots = targets.map((target) => planFor(target, today));

    /* --- what is already promised --------------------------------------- */

    const debts: DebtLine[] = liabilities
      .filter((row) => row.amount !== 0)
      .map((row) => ({ id: row.id, name: row.name, amount: row.baseAmount }));

    // A card balance is money that has to come out of cash, so it is taken off
    // what is safe to spend. A mortgage is not. Nobody has to find two hundred
    // thousand this month — they have to find one payment, and that payment is
    // budgeted like any other bill, out of a pot. Subtracting the whole balance
    // would tell somebody with a house and a healthy current account that they
    // have nothing to spend, which is both false and the single most
    // discouraging thing a money app can say.
    const cardCommitments: Commitment[] = liabilities
      .filter((row) => row.amount !== 0 && !AMORTIZING_CLASSES.has(row.accountClass ?? ''))
      .map((row) => ({
        label: row.name,
        amount: row.baseAmount,
        kind: 'card' as const,
      }));

    const bills = scheduled.filter((item) => item.kind === 'bill');
    const upcoming: UpcomingBill[] = bills
      .flatMap((item) =>
        occurrencesWithin(item, today, horizonEnd).map((o) => ({
          name: item.name,
          amount: o.amount,
          date: o.date,
          daysAway: daysBetween(today, o.date),
        })),
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    const billCommitments: Commitment[] = upcoming.map((bill) => ({
      label: bill.name,
      amount: bill.amount,
      kind: 'bill' as const,
      dueDate: bill.date,
    }));

    /* --- money already spoken for --------------------------------------- */

    // What the pots take out: the money already in them, which is sitting in
    // the bank account and would be raided by spending it, plus whatever still
    // has to go in this month. Card-bill and reimbursement pots are excluded
    // here — those mirror debts already counted above, and taking them off
    // twice would understate what is safe to spend.
    const goalFunding = reservedForPots(pots);

    const reserved = minor(
      envelopes
        .filter((e) => e.role === 'card_payment')
        .reduce((total, e) => total + Math.max(0, e.amount), 0),
    );

    /* --- when does money next arrive ------------------------------------ */

    const incomeDates = scheduled
      .filter((item) => item.kind === 'income')
      .flatMap((item) => occurrencesWithin(item, today, horizonEnd).map((o) => o.date))
      .sort();
    const nextIncome = incomeDates[0];
    const daysUntilIncome = nextIncome ? daysBetween(today, nextIncome) : undefined;

    /* --- the two headline calculations ---------------------------------- */

    const liquidity = calculateSafeToSpend({
      liquidCash: cash,
      bills: billCommitments,
      cardBalances: cardCommitments,
      buffer: minor(bufferMinor),
      goalFunding,
      cycle,
      ...(daysUntilIncome === undefined ? {} : { daysUntilIncome }),
    });

    const pacing = calculatePacing({
      cycle,
      spendByDay: byDay,
      remaining: liquidity.safeToSpend,
      today,
      periodNoun: CADENCE_NOUNS[settings.cadence],
    });

    // Everything owed, which is what net worth is measured against.
    const totalDebt = minor(debts.reduce((total, d) => total + d.amount, 0));

    // What is set aside for card bills is only ever compared against card
    // bills. A mortgage in the total would leave the badge permanently saying
    // the bill is not covered, on an account nobody is expected to cover.
    const cardDebt = minor(cardCommitments.reduce((total, c) => total + c.amount, 0));

    return {
      today,
      cycle,
      cadence: settings.cadence,
      liquidity,
      pacing,
      liquidCash: cash,
      debts,
      totalDebt,
      reserved,
      billsCovered: cardDebt === 0 || reserved >= cardDebt,
      // Everything you own, less everything you owe — money other people owe
      // you back is still yours, so it belongs here.
      netWorth: minor(assets - totalDebt),
      buffer: minor(bufferMinor),
      dueSoon: upcoming.filter((b) => b.daysAway * 24 <= SOON_HOURS),
      upcoming,
      hasSchedule: scheduled.length > 0,
      hasActivity: entryCount > 0,
      pots,
      owedToYou,
      netWorthLastMonth,
      netWorthChange: minor(assets - totalDebt - netWorthLastMonth),
    };
  }, [bufferMinor]);

  // `meta` is in the list because changing the budget cadence changes the
  // period every figure above is measured over.
  return useLiveQuery(query, [...LEDGER_TABLES, 'scheduled_items', 'claims', 'meta']);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return toIsoDate(date);
}
