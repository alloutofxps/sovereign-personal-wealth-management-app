/* ===========================================================================
 * THE FORECAST, ASSEMBLED
 * ---------------------------------------------------------------------------
 * Everything here is worked out on the fly from the ledger and the list of
 * regular payments. Nothing is written back: a projection is a view of what is
 * already known, and storing it would only give it a chance to go stale.
 * ======================================================================== */

import { useCallback } from 'react';
import { minor, basisPoints, type Minor } from '@/core/money';
import { isoDate } from '@/core/ledger';
import { addDays, monthCycle, toIsoDate } from '@/core/liquidity';
import {
  calculateRunway,
  guessOptional,
  project,
  type Projection,
  type ProjectedEvent,
  type RunwayResult,
  type SpendingCategory,
} from '@/core/forecast';
import type { DebtAccount } from '@/core/simulate';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import {
  LEDGER_TABLES,
  balancesByType,
  debtTerms,
  monthlySpendByCategory,
  spendableCash,
} from '@/data/repositories/ledgerRepo';
import { listScheduled, occurrencesWithin } from '@/data/repositories/scheduleRepo';
import { potTargets } from '@/data/repositories/potsRepo';
import { planFor } from '@/core/goals';
import { useAppConfig } from '@/app/config/store';

/** How far back to look for what a normal month costs. */
const TRAILING_MONTHS = 3;
/** The furthest the forecast reaches. */
const MAX_DAYS = 90;

export interface ForecastData {
  today: string;
  /** The full ninety days; the view slices it to whatever horizon is chosen. */
  projection: Projection;
  buffer: Minor;
  startingCash: Minor;
  /** Categories with a typical monthly figure, for the runway toggles. */
  categories: SpendingCategory[];
  fixedMonthly: Minor;
  /** What could actually be drawn on, after pots and the cushion. */
  usableCash: Minor;
  runwayAsYouAre: RunwayResult;
  debts: DebtAccount[];
  /** True when no bills or pay are known, so the line is flat and useless. */
  needsSchedule: boolean;
}

export function useForecast(): LiveQueryResult<ForecastData> {
  const bufferMinor = useAppConfig((s) => s.bufferMinor);

  const query = useCallback(async (): Promise<ForecastData> => {
    const today = toIsoDate(new Date());
    const cycle = monthCycle(today);
    const horizon = addDays(today, MAX_DAYS);
    const trailingFrom = addDays(today, -TRAILING_MONTHS * 30);

    const [cash, liabilities, scheduled, targets, categoryRows, terms] = await Promise.all([
      spendableCash(),
      balancesByType('LIABILITY'),
      listScheduled(),
      potTargets(isoDate(cycle.start), isoDate(cycle.end)),
      monthlySpendByCategory(isoDate(trailingFrom), isoDate(today), TRAILING_MONTHS),
      debtTerms(),
    ]);

    /* --- what is coming, day by day ------------------------------------- */

    const events: ProjectedEvent[] = scheduled.flatMap((item) =>
      occurrencesWithin(item, today, horizon).map((occurrence) => ({
        date: occurrence.date,
        name: item.name,
        amount: minor(item.kind === 'bill' ? -occurrence.amount : occurrence.amount),
        kind: item.kind === 'bill' ? ('bill' as const) : ('income' as const),
      })),
    );

    // What has to go into the pots, landing on the first of each month.
    const pots = targets.map((target) => planFor(target, today));
    const potMonthly = pots.reduce((total, pot) => total + pot.monthlyAllocation, 0);
    if (potMonthly > 0) {
      for (let month = 0; month <= 3; month++) {
        const date = firstOfMonthAfter(today, month);
        if (date <= horizon && date >= today) {
          events.push({
            date,
            name: 'Into your pots',
            amount: minor(-potMonthly),
            kind: 'pot',
          });
        }
      }
    }

    // Card bills land on the day they are actually due, where that is known.
    // Falling back to the month end was a guess that could be three weeks out.
    const dueDayById = new Map(terms.map((row) => [row.id, row.dueDay]));
    for (const debt of liabilities.filter((row) => row.amount > 0)) {
      const dueDay = dueDayById.get(debt.id);
      const due = dueDay ? nextOccurrenceOfDay(today, dueDay) : endOfMonth(today);
      if (due <= horizon) {
        events.push({
          date: due,
          name: `${debt.name} bill`,
          amount: minor(-debt.amount),
          kind: 'card',
        });
      }
    }

    const projection = project({
      today,
      days: MAX_DAYS,
      startingCash: cash,
      events,
      buffer: minor(bufferMinor),
    });

    /* --- what a month costs --------------------------------------------- */

    const categories: SpendingCategory[] = categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      monthly: row.monthly,
      optional: guessOptional(row.name),
    }));

    const fixedMonthly = minor(
      scheduled
        .filter((item) => item.kind === 'bill')
        .reduce((total, item) => total + monthlyEquivalent(item.amount, item.cadence), 0),
    );

    // Money in pots and the cushion are already spoken for.
    const potBalances = pots.reduce((total, pot) => total + Math.max(0, pot.currentBalance), 0);
    const usableCash = minor(Math.max(0, cash - potBalances - bufferMinor));

    return {
      today,
      projection,
      buffer: minor(bufferMinor),
      startingCash: cash,
      categories,
      fixedMonthly,
      usableCash,
      runwayAsYouAre: calculateRunway({ usableCash, fixedMonthly, categories }),
      debts: terms
        .filter((row) => row.balance > 0)
        .map((row) => ({
          id: row.id,
          name: row.name,
          balance: row.balance,
          // A sensible default until somebody tells us the real rate.
          apr: basisPoints(row.aprBp ?? 1999),
          minimumPayment: minor(row.minPayment ?? Math.max(2500, Math.round(row.balance * 0.02))),
        })),
      needsSchedule: scheduled.length === 0,
    };
  }, [bufferMinor]);

  return useLiveQuery(query, [...LEDGER_TABLES, 'scheduled_items', 'claims']);
}

/** Weekly and yearly bills expressed as what they cost a month. */
function monthlyEquivalent(amount: Minor, cadence: string): number {
  switch (cadence) {
    case 'weekly':
      return Math.round((amount * 52) / 12);
    case 'fortnightly':
      return Math.round((amount * 26) / 12);
    case 'yearly':
      return Math.round(amount / 12);
    default:
      return amount;
  }
}

function firstOfMonthAfter(iso: string, monthsAhead: number): string {
  const [y, m] = iso.split('-').map(Number);
  return toIsoDate(new Date((y ?? 1970), (m ?? 1) - 1 + monthsAhead, 1));
}

/** The next time this day of the month comes round, today included. */
function nextOccurrenceOfDay(iso: string, day: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const thisMonth = new Date(y ?? 1970, (m ?? 1) - 1, day);
  if ((d ?? 1) <= day) return toIsoDate(thisMonth);
  return toIsoDate(new Date(y ?? 1970, m ?? 1, day));
}

function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return toIsoDate(new Date((y ?? 1970), m ?? 1, 0));
}
