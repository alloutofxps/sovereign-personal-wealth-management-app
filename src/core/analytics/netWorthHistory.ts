/* ===========================================================================
 * WHAT YOU WERE WORTH, MONTH BY MONTH
 * ---------------------------------------------------------------------------
 * A single number for what somebody is worth today is close to useless. It is
 * large or it is small, and either way there is nothing to do about it. The
 * useful thing is the shape: whether the line is going up, how steadily, and
 * what happened in the months where it did not.
 *
 * Every point is rebuilt from the journal by summing every posting dated on or
 * before the last day of the month. There is no clever running total, and no
 * incremental cache, because both would drift the moment somebody corrects a
 * transaction from three years ago — and correcting old transactions is a
 * thing people do. Recomputing is cheap enough at this scale and is always
 * right, which is the better trade.
 *
 * Postings are read in the reporting currency (`baseAmount`), never in the
 * account's own. A dollar account's history is a euro household's history of
 * that account, or the line would jump when a rate was typed in.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';

/** One posting, reduced to only what a history needs from it. */
export interface HistoryPosting {
  /** 'YYYY-MM-DD' — the entry's date, not when it was recorded. */
  date: string;
  /** Signed, in the reporting currency. Positive is a debit. */
  baseAmount: Minor;
  /** ASSET or LIABILITY. Everything else is ignored. */
  side: 'ASSET' | 'LIABILITY';
}

export interface NetWorthPoint {
  /** 'YYYY-MM' — the month this closed on. */
  month: string;
  /** The last day of that month, or today for the month in progress. */
  asOf: string;
  assets: Minor;
  /** Positive: what is owed, expressed as a positive amount. */
  liabilities: Minor;
  netWorth: Minor;
  /** The change from the previous point. Zero on the first. */
  change: Minor;
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The last day of the month a date falls in, as 'YYYY-MM-DD'. */
export function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, inclusive, as 'YYYY-MM'. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return months;

  let year = fy;
  let month = fm;
  // A guard rather than a limit: 100 years of months, so a single bad date
  // cannot spin forever.
  for (let i = 0; i < 1200 && (year < ty || (year === ty && month <= tm)); i++) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * The net worth line, one point per month.
 *
 * Balances are cumulative, so each month's figure includes everything that
 * ever happened up to it. Months where nothing happened still get a point —
 * a flat stretch is information, and a gap in the line would read as a gap in
 * the person's life rather than a quiet quarter.
 */
export function buildNetWorthHistory(
  postings: readonly HistoryPosting[],
  options: { through?: string; from?: string } = {},
): NetWorthPoint[] {
  if (postings.length === 0) return [];

  let earliest = postings[0]!.date;
  let latest = postings[0]!.date;
  for (const p of postings) {
    if (p.date < earliest) earliest = p.date;
    if (p.date > latest) latest = p.date;
  }

  const first = options.from ? monthOf(options.from) : monthOf(earliest);
  const last = options.through ? monthOf(options.through) : monthOf(latest);
  const months = monthsBetween(first, last);
  if (months.length === 0) return [];

  // One pass to bucket by month, then a running total — rather than a full
  // scan per month, which is quadratic and starts to show after a decade.
  const assetsByMonth = new Map<string, number>();
  const liabilitiesByMonth = new Map<string, number>();

  for (const posting of postings) {
    const month = monthOf(posting.date);
    // Anything before the window still counts towards the opening position,
    // so a chart starting in 2024 does not forget a house bought in 2019.
    const bucket = month < first ? first : month;
    if (bucket > last) continue;

    const target = posting.side === 'ASSET' ? assetsByMonth : liabilitiesByMonth;
    target.set(bucket, (target.get(bucket) ?? 0) + posting.baseAmount);
  }

  const points: NetWorthPoint[] = [];
  let assets = 0;
  let liabilities = 0;
  let previous = 0;

  for (const month of months) {
    assets += assetsByMonth.get(month) ?? 0;
    liabilities += liabilitiesByMonth.get(month) ?? 0;

    // Liabilities carry credit balances, so the raw total is negative. It is
    // flipped here once, so that everything downstream can read "what you owe"
    // as a positive number the way a person would say it.
    const owed = -liabilities;
    const netWorth = assets - owed;

    points.push({
      month,
      asOf: endOfMonth(month),
      assets: minor(assets),
      liabilities: minor(owed),
      netWorth: minor(netWorth),
      change: minor(points.length === 0 ? 0 : netWorth - previous),
    });
    previous = netWorth;
  }

  return points;
}

/* ===========================================================================
 * WHAT THE LINE DID
 * ======================================================================== */

export interface TrajectorySummary {
  first: NetWorthPoint;
  last: NetWorthPoint;
  /** Total change across the window. */
  change: Minor;
  /** The average month, which is the figure people actually plan against. */
  averageMonthlyChange: Minor;
  /** The best and worst months in the window. */
  bestMonth: NetWorthPoint | null;
  worstMonth: NetWorthPoint | null;
  /** How many months the line rose. */
  monthsUp: number;
  monthsDown: number;
}

export function summariseTrajectory(points: readonly NetWorthPoint[]): TrajectorySummary | null {
  if (points.length === 0) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  // The first point has no previous month, so it has no change to compare.
  const changes = points.slice(1);

  let best: NetWorthPoint | null = null;
  let worst: NetWorthPoint | null = null;
  let up = 0;
  let down = 0;

  for (const point of changes) {
    if (!best || point.change > best.change) best = point;
    if (!worst || point.change < worst.change) worst = point;
    if (point.change > 0) up += 1;
    if (point.change < 0) down += 1;
  }

  const change = last.netWorth - first.netWorth;

  return {
    first,
    last,
    change: minor(change),
    averageMonthlyChange: minor(
      changes.length === 0 ? 0 : Math.round(change / changes.length),
    ),
    bestMonth: best,
    worstMonth: worst,
    monthsUp: up,
    monthsDown: down,
  };
}

/**
 * The line, in a sentence.
 *
 * Describes and stops. Whether a rate of increase is good depends on somebody's
 * age, income, plans and what they want their life to look like, none of which
 * this app knows — and being told your progress is inadequate by software is
 * not a thing anybody needs.
 */
export function describeTrajectory(
  summary: TrajectorySummary | null,
  format: (amount: Minor) => string,
): string {
  if (!summary) {
    return 'There is nothing recorded yet, so there is no line to draw.';
  }

  const months = summary.monthsUp + summary.monthsDown;
  if (months === 0) {
    return `You are worth ${format(summary.last.netWorth)}. Once there is more than one month recorded, this will show how that has moved.`;
  }

  const direction =
    summary.change > 0 ? 'gone up by' : summary.change < 0 ? 'gone down by' : 'stayed at';

  const movement =
    summary.change === 0
      ? `held steady at ${format(summary.last.netWorth)}`
      : `${direction} ${format(minor(Math.abs(summary.change)))}, to ${format(summary.last.netWorth)}`;

  const pace =
    summary.averageMonthlyChange === 0
      ? ''
      : ` That averages ${format(minor(Math.abs(summary.averageMonthlyChange)))} a month.`;

  return `Over ${months + 1} months, what you are worth has ${movement}.${pace}`;
}
