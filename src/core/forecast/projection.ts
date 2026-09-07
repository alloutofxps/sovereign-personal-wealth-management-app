/* ===========================================================================
 * WHAT YOUR BALANCE WILL DO
 * ---------------------------------------------------------------------------
 * A day-by-day projection of the money in your everyday account, built from
 * what is already known: today's cleared balance, the bills that are due, the
 * pay that is coming, and what has to be put by for the pots.
 *
 * Deterministic on purpose. This is not a guess about your habits — it is
 * arithmetic on commitments you have already told Sovereign about, which is
 * what makes it worth trusting. The useful thing it produces is not the shape
 * of the line but the date, if there is one, where the line dips below your
 * cushion — because that is a problem you can still do something about.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import { addDays, daysBetween } from '@/core/liquidity';

export interface ProjectedEvent {
  date: string;
  /** As a person would say it: "Rent", "Pay from work". */
  name: string;
  /** Signed: negative leaves the account, positive arrives. */
  amount: Minor;
  kind: 'bill' | 'income' | 'pot' | 'card';
}

export interface ProjectionInput {
  today: string;
  /** How far ahead to look. Thirty, sixty or ninety days. */
  days: number;
  /** Cleared money in everyday accounts right now. */
  startingCash: Minor;
  events: readonly ProjectedEvent[];
  /** The cushion the balance should never dip below. */
  buffer: Minor;
}

export interface ProjectionPoint {
  date: string;
  balance: Minor;
  /** What happened on this day, for the tooltip. */
  events: ProjectedEvent[];
  belowBuffer: boolean;
  belowZero: boolean;
}

export interface Projection {
  points: ProjectionPoint[];
  /** The lowest the balance is expected to get, and when. */
  lowest: ProjectionPoint;
  /** The first day it dips under the cushion, if it ever does. */
  firstBelowBuffer: ProjectionPoint | null;
  /** The first day it would go overdrawn, if it ever does. */
  firstBelowZero: ProjectionPoint | null;
  endBalance: Minor;
  buffer: Minor;
}

/**
 * Walk the days forward, applying whatever falls on each.
 *
 * Events outside the window are ignored rather than clamped onto the edges —
 * a bill due next year should not appear as a cliff on day ninety.
 */
export function project(input: ProjectionInput): Projection {
  const byDay = new Map<string, ProjectedEvent[]>();
  const horizon = addDays(input.today, input.days);

  for (const event of input.events) {
    if (event.date < input.today || event.date > horizon) continue;
    const list = byDay.get(event.date) ?? [];
    list.push(event);
    byDay.set(event.date, list);
  }

  const points: ProjectionPoint[] = [];
  let balance = input.startingCash;

  for (let offset = 0; offset <= input.days; offset++) {
    const date = addDays(input.today, offset);
    const events = byDay.get(date) ?? [];
    balance = minor(balance + events.reduce((total, e) => total + e.amount, 0));

    points.push({
      date,
      balance,
      events,
      belowBuffer: balance < input.buffer,
      belowZero: balance < 0,
    });
  }

  const lowest = points.reduce((low, point) => (point.balance < low.balance ? point : low), points[0]!);

  return {
    points,
    lowest,
    firstBelowBuffer: points.find((p) => p.belowBuffer) ?? null,
    firstBelowZero: points.find((p) => p.belowZero) ?? null,
    endBalance: points.at(-1)?.balance ?? input.startingCash,
    buffer: input.buffer,
  };
}

/**
 * A complete sentence about what the projection shows.
 * Takes the formatters so core stays free of locale and currency concerns.
 */
export function describeProjection(
  projection: Projection,
  today: string,
  format: (amount: Minor) => string,
  formatDate: (iso: string) => string,
): string {
  const { firstBelowZero, firstBelowBuffer, lowest } = projection;

  if (firstBelowZero) {
    const days = daysBetween(today, firstBelowZero.date);
    return (
      `On current plans your account runs out around ${formatDate(firstBelowZero.date)}, ` +
      `${days === 0 ? 'today' : `about ${days} ${days === 1 ? 'day' : 'days'} from now`}. ` +
      `There is still time to move something.`
    );
  }

  if (firstBelowBuffer) {
    return (
      `Your balance dips into your safety cushion around ${formatDate(firstBelowBuffer.date)}, ` +
      `getting as low as ${format(lowest.balance)}. Nothing is wrong. It just means there is ` +
      `less room than usual around then.`
    );
  }

  return (
    `Your balance stays above your cushion the whole way, with the tightest point ` +
    `around ${formatDate(lowest.date)} at ${format(lowest.balance)}.`
  );
}

/** How the horizon is offered. Ninety days is as far as bills are known. */
export const HORIZONS = [30, 60, 90] as const;
export type Horizon = (typeof HORIZONS)[number];
