/* ===========================================================================
 * KEEPING AN EYE ON SUBSCRIPTIONS
 * ---------------------------------------------------------------------------
 * Three questions nobody remembers to ask themselves: has this quietly gone
 * up, am I still using it, and is this thing I pay every month actually
 * written down anywhere.
 *
 * All three are counting exercises over history that is already on the device.
 * There is no model here and no service call — the answers are cheaper to work
 * out locally than to send anywhere, and the data never has to leave.
 *
 * The tone is deliberate. A subscription that went up by two euros is not an
 * emergency, and treating it as one trains people to ignore the app. Every
 * message below states the fact and offers a way out, in that order.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

/* --- price creep ---------------------------------------------------------- */

export interface WatchedItem {
  id: string;
  name: string;
  /** What this is supposed to cost. */
  expectedAmount: Minor;
}

export interface PriceChange {
  itemId: string;
  name: string;
  expectedAmount: Minor;
  chargedAmount: Minor;
  /** Always positive: how much more than expected. */
  increase: Minor;
  /** Basis points, so the arithmetic stays integral. 1000 = 10%. */
  increaseBp: number;
  /** What it costs over a year if it stays this way. */
  annualisedIncrease: Minor;
}

/**
 * Has this charge gone up?
 *
 * Only ever fires upward. A bill that came in *under* the expected amount is
 * good news and needs no interruption, and one that matches exactly is the
 * entire point of having written it down.
 */
export function detectPriceCreep(
  item: WatchedItem,
  chargedAmount: Minor,
  /** How many times a year this is billed, for the annual figure. */
  timesPerYear = 12,
): PriceChange | null {
  if (item.expectedAmount <= 0) return null;
  if (chargedAmount <= item.expectedAmount) return null;

  const increase = minor(chargedAmount - item.expectedAmount);

  // Integer arithmetic throughout: basis points rather than a float
  // percentage, so nothing here can drift or round surprisingly.
  const increaseBp = Math.round((increase * 10_000) / item.expectedAmount);

  return {
    itemId: item.id,
    name: item.name,
    expectedAmount: item.expectedAmount,
    chargedAmount,
    increase,
    increaseBp,
    annualisedIncrease: minor(increase * timesPerYear),
  };
}

/** Whether a rise is worth mentioning at all. */
export const CREEP_NOTICE_BP = 100; // 1%

export function worthMentioning(change: PriceChange): boolean {
  // A rounding-sized difference on a variable bill is noise, not news.
  return change.increaseBp >= CREEP_NOTICE_BP && change.increase >= minor(50);
}

/* --- subscriptions nobody uses any more ----------------------------------- */

export interface DormantCandidate {
  itemId: string;
  name: string;
  amount: Minor;
  /** Whole weeks since anything was recorded against it. */
  weeksQuiet: number;
  /** What it has cost over that quiet stretch. */
  spentWhileQuiet: Minor;
}

export const DORMANT_AFTER_WEEKS = 8;

export interface ActivityWindow {
  itemId: string;
  /** The last date anything was recorded in this item's category. */
  lastActivity: string | null;
  /** Null when the person has said they are happy with it. */
  dismissedAt: string | null;
}

/**
 * Subscriptions still being paid for that nothing has been used against.
 *
 * Deliberately conservative: eight weeks, and only for things billed monthly
 * or more often, because a quarterly or annual bill is *supposed* to look
 * quiet. Anything the person has already waved away stays waved away.
 */
export function detectDormantSubscriptions(
  items: readonly (WatchedItem & { amount: Minor; timesPerYear: number })[],
  activity: readonly ActivityWindow[],
  today: string,
): DormantCandidate[] {
  const byId = new Map(activity.map((a) => [a.itemId, a]));
  const out: DormantCandidate[] = [];

  for (const item of items) {
    // A bill that arrives four times a year cannot be judged on eight weeks.
    if (item.timesPerYear < 12) continue;

    const window = byId.get(item.id);
    if (!window || window.dismissedAt) continue;

    const weeksQuiet = window.lastActivity
      ? Math.floor(daysBetween(window.lastActivity, today) / 7)
      : Infinity;
    if (weeksQuiet < DORMANT_AFTER_WEEKS) continue;

    const months = window.lastActivity ? Math.floor(weeksQuiet / 4) : 0;
    out.push({
      itemId: item.id,
      name: item.name,
      amount: item.amount,
      weeksQuiet: Number.isFinite(weeksQuiet) ? weeksQuiet : DORMANT_AFTER_WEEKS,
      spentWhileQuiet: minor(item.amount * Math.max(months, 1)),
    });
  }

  return out;
}

/* --- things that look like subscriptions but are not written down --------- */

export interface HistoricalPayment {
  /** Normalised merchant, so the caller decides how names are compared. */
  merchant: string;
  date: string;
  amount: Minor;
}

export interface RecurringCandidate {
  merchant: string;
  /** The amount seen most often. */
  amount: Minor;
  /** Days between charges, rounded. */
  intervalDays: number;
  cadenceGuess: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  occurrences: number;
  lastSeen: string;
}

export const MIN_OCCURRENCES = 3;
/** How much the gap between charges is allowed to wander. */
export const INTERVAL_TOLERANCE_DAYS = 3;
/** How much the amount is allowed to wander, in basis points. */
export const AMOUNT_TOLERANCE_BP = 500; // 5%

/**
 * Payments that arrive on a rhythm and are not written down yet.
 *
 * Three charges is the smallest number that can establish a rhythm: two points
 * make a gap, three make a pattern. The tolerances exist because real
 * subscriptions are not metronomes — weekends move billing dates by a day or
 * two, and a bill that varies by pennies is still the same bill.
 */
export function inferRecurringCandidates(
  payments: readonly HistoricalPayment[],
  /** Merchants already written down, so nothing is suggested twice. */
  alreadyScheduled: readonly string[],
  today: string,
  windowDays = 90,
): RecurringCandidate[] {
  const known = new Set(alreadyScheduled.map((m) => m.toUpperCase()));
  const cutoff = shiftDays(today, -windowDays);

  const byMerchant = new Map<string, HistoricalPayment[]>();
  for (const payment of payments) {
    if (payment.date < cutoff || payment.date > today) continue;
    if (known.has(payment.merchant.toUpperCase())) continue;
    const list = byMerchant.get(payment.merchant) ?? [];
    list.push(payment);
    byMerchant.set(payment.merchant, list);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [merchant, all] of byMerchant) {
    const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < MIN_OCCURRENCES) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1]!.date, sorted[i]!.date));
    }

    const median = middle(gaps);
    if (median <= 0) continue;
    if (!gaps.every((gap) => Math.abs(gap - median) <= INTERVAL_TOLERANCE_DAYS)) continue;

    const amounts = sorted.map((p) => p.amount);
    const typical = middle(amounts);
    if (typical <= 0) continue;
    const withinTolerance = amounts.every(
      (amount) => Math.abs(amount - typical) * 10_000 <= typical * AMOUNT_TOLERANCE_BP,
    );
    if (!withinTolerance) continue;

    const cadenceGuess = guessCadence(median);
    if (!cadenceGuess) continue;

    candidates.push({
      merchant,
      amount: minor(typical),
      intervalDays: median,
      cadenceGuess,
      occurrences: sorted.length,
      lastSeen: sorted.at(-1)!.date,
    });
  }

  return candidates.sort((a, b) => b.occurrences - a.occurrences || a.merchant.localeCompare(b.merchant));
}

function guessCadence(days: number): RecurringCandidate['cadenceGuess'] | null {
  if (Math.abs(days - 7) <= INTERVAL_TOLERANCE_DAYS) return 'weekly';
  if (Math.abs(days - 14) <= INTERVAL_TOLERANCE_DAYS) return 'biweekly';
  if (days >= 28 && days <= 31 + INTERVAL_TOLERANCE_DAYS) return 'monthly';
  if (days >= 88 && days <= 93) return 'quarterly';
  return null;
}

/** The middle value, which a single odd month cannot drag around. */
function middle(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

const MS_PER_DAY = 86_400_000;

function asDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function daysBetween(from: string, to: string): number {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / MS_PER_DAY);
}

function shiftDays(iso: string, days: number): string {
  const date = asDate(iso);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
