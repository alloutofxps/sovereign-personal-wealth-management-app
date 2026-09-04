/* ===========================================================================
 * WHAT THE MONEY WENT ON, RANKED
 * ---------------------------------------------------------------------------
 * The plainest possible view: biggest first, with each one's share of the
 * total. Groups roll up from their categories rather than being counted
 * separately, so a group is always exactly the sum of what is under it and
 * the two can never disagree on screen.
 *
 * Shares are basis points, computed by integer arithmetic. A percentage held
 * as a float and multiplied back out is how a set of shares comes to add up
 * to 99.97%, which looks like a bug in the ledger rather than in the display.
 * ======================================================================== */

import { minor, type BasisPoints, type Minor } from '@/core/money';

export interface SpendRow {
  categoryId: string;
  categoryName: string;
  groupId: string | null;
  groupName: string | null;
  amount: Minor;
}

export interface DistributionLeaf {
  categoryId: string;
  categoryName: string;
  amount: Minor;
  /** Share of the whole period's spending. */
  shareBp: BasisPoints;
}

export interface DistributionGroup {
  groupId: string;
  groupName: string;
  amount: Minor;
  shareBp: BasisPoints;
  categories: DistributionLeaf[];
}

export interface Distribution {
  groups: DistributionGroup[];
  /** Categories with no group, shown after the groups. */
  ungrouped: DistributionLeaf[];
  /** Every leaf, biggest first, ignoring the tree. */
  ranked: DistributionLeaf[];
  total: Minor;
  empty: boolean;
}

const UNGROUPED = '__ungrouped__';

/** Share of a total in basis points, rounded, never dividing by zero. */
export function shareOf(amount: Minor, total: Minor): BasisPoints {
  if (total <= 0) return 0 as BasisPoints;
  return Math.round((amount * 10_000) / total) as BasisPoints;
}

/**
 * Rank the period's spending, and roll it up by group.
 *
 * Rows arrive already filtered to the window; this only sorts, totals and
 * divides, so it can be tested without a database anywhere near it.
 */
export function buildDistribution(rows: readonly SpendRow[]): Distribution {
  const spending = rows.filter((row) => row.amount > 0);
  const total = minor(spending.reduce((sum, row) => sum + row.amount, 0));

  if (total === 0) {
    return { groups: [], ungrouped: [], ranked: [], total: minor(0), empty: true };
  }

  const toLeaf = (row: SpendRow): DistributionLeaf => ({
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    amount: row.amount,
    shareBp: shareOf(row.amount, total),
  });

  const byGroup = new Map<string, { name: string; rows: SpendRow[] }>();
  for (const row of spending) {
    const key = row.groupId ?? UNGROUPED;
    const bucket = byGroup.get(key) ?? { name: row.groupName ?? 'Not in a group', rows: [] };
    bucket.rows.push(row);
    byGroup.set(key, bucket);
  }

  const groups: DistributionGroup[] = [];
  let ungrouped: DistributionLeaf[] = [];

  for (const [key, bucket] of byGroup) {
    const leaves = bucket.rows.map(toLeaf).sort((a, b) => b.amount - a.amount);

    if (key === UNGROUPED) {
      ungrouped = leaves;
      continue;
    }

    // The group is the sum of its children, always. Querying a group's own
    // total separately is how a parent comes to disagree with its own rows.
    const amount = minor(leaves.reduce((sum, leaf) => sum + leaf.amount, 0));
    groups.push({
      groupId: key,
      groupName: bucket.name,
      amount,
      shareBp: shareOf(amount, total),
      categories: leaves,
    });
  }

  groups.sort((a, b) => b.amount - a.amount);

  return {
    groups,
    ungrouped,
    ranked: spending.map(toLeaf).sort((a, b) => b.amount - a.amount),
    total,
    empty: false,
  };
}

/** "About a third of your spending", rather than "33.4%". */
export function describeShare(shareBp: BasisPoints): string {
  const percent = Math.round(shareBp / 100);
  if (percent >= 45 && percent <= 55) return 'about half of your spending';
  if (percent >= 30 && percent <= 36) return 'about a third of your spending';
  if (percent >= 23 && percent <= 27) return 'about a quarter of your spending';
  if (percent < 1) return 'less than one per cent of your spending';
  return `about ${percent}% of your spending`;
}
