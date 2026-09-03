/* ===========================================================================
 * PAYING OFF WHAT YOU OWE
 * ---------------------------------------------------------------------------
 * Two orderings of the same money:
 *
 *   Smallest first  clear the smallest balance, then roll its payment into
 *                   the next. Costs a little more; gives you a debt gone
 *                   sooner, which is the thing that keeps people going.
 *   Costliest first mathematically optimal — always pay down whatever charges
 *                   the most interest.
 *
 * Both are simulated month by month with the same budget so the comparison is
 * honest, and the answer is given as what the difference actually costs: the
 * extra interest, and how many months later you would be free.
 * ======================================================================== */

import { minor, type BasisPoints, type Minor } from '@/core/money';
import { monthlyInterest } from '@/core/money';

export type Strategy = 'smallest_first' | 'costliest_first';

export interface DebtAccount {
  id: string;
  /** As the person calls it: "Credit card", "Car loan". */
  name: string;
  balance: Minor;
  /** Annual rate in basis points. 19.99% is 1999. */
  apr: BasisPoints;
  /** The least the lender will accept each month. */
  minimumPayment: Minor;
}

export interface PayoffMonth {
  monthIndex: number;
  /** What each debt still owed at the end of this month. */
  balances: Record<string, Minor>;
  interestCharged: Minor;
  paid: Minor;
  /** Debts that reached zero this month. */
  clearedIds: string[];
}

export interface PayoffPlan {
  strategy: Strategy;
  /** Months until everything is gone. Null when the budget never clears it. */
  months: number | null;
  totalInterest: Minor;
  totalPaid: Minor;
  timeline: PayoffMonth[];
  /** The order debts get cleared in, first to last. */
  clearedOrder: { id: string; name: string; monthIndex: number }[];
}

/** Hard stop so a budget that never clears the debt cannot spin forever. */
const MAX_MONTHS = 600;

export function orderFor(strategy: Strategy, debts: readonly DebtAccount[]): DebtAccount[] {
  const live = debts.filter((d) => d.balance > 0);
  return strategy === 'smallest_first'
    ? [...live].sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name))
    : [...live].sort((a, b) => b.apr - a.apr || a.balance - b.balance);
}

/** The least you can pay across everything without falling behind. */
export function totalMinimum(debts: readonly DebtAccount[]): Minor {
  return minor(
    debts.filter((d) => d.balance > 0).reduce((total, d) => total + Math.max(0, d.minimumPayment), 0),
  );
}

/**
 * Run the plan forward a month at a time.
 *
 * Interest is charged first, then minimums are paid on everything, then all
 * remaining budget goes at the target debt. As each debt clears, its payment
 * rolls into the next — which is what makes either method accelerate.
 */
export function simulatePayoff(
  debts: readonly DebtAccount[],
  monthlyBudget: Minor,
  strategy: Strategy,
): PayoffPlan {
  const balances = new Map<string, number>(debts.map((d) => [d.id, Math.max(0, d.balance)]));
  const byId = new Map(debts.map((d) => [d.id, d]));

  const timeline: PayoffMonth[] = [];
  const clearedOrder: PayoffPlan['clearedOrder'] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let monthIndex = 0; monthIndex < MAX_MONTHS; monthIndex++) {
    const outstanding = [...balances.entries()].filter(([, value]) => value > 0);
    if (outstanding.length === 0) break;

    let budget = Math.max(0, monthlyBudget);
    let interestThisMonth = 0;
    let paidThisMonth = 0;
    const clearedThisMonth: string[] = [];

    // 1. Interest is charged before anything is paid, as lenders do it.
    for (const [id, value] of outstanding) {
      const debt = byId.get(id)!;
      const interest = monthlyInterest(minor(value), debt.apr);
      balances.set(id, value + interest);
      interestThisMonth += interest;
    }

    // 2. The minimum on everything, so nothing falls into arrears.
    for (const [id] of outstanding) {
      const debt = byId.get(id)!;
      const owed = balances.get(id)!;
      if (owed <= 0) continue;
      const payment = Math.min(budget, Math.max(0, debt.minimumPayment), owed);
      balances.set(id, owed - payment);
      budget -= payment;
      paidThisMonth += payment;
      if (balances.get(id)! <= 0) clearedThisMonth.push(id);
    }

    // 3. Everything left goes at the target, in the chosen order.
    for (const debt of orderFor(strategy, debts)) {
      if (budget <= 0) break;
      const owed = balances.get(debt.id) ?? 0;
      if (owed <= 0) continue;
      const payment = Math.min(budget, owed);
      balances.set(debt.id, owed - payment);
      budget -= payment;
      paidThisMonth += payment;
      if (balances.get(debt.id)! <= 0 && !clearedThisMonth.includes(debt.id)) {
        clearedThisMonth.push(debt.id);
      }
    }

    totalInterest += interestThisMonth;
    totalPaid += paidThisMonth;

    for (const id of clearedThisMonth) {
      clearedOrder.push({ id, name: byId.get(id)?.name ?? id, monthIndex });
    }

    timeline.push({
      monthIndex,
      balances: Object.fromEntries(
        [...balances.entries()].map(([id, value]) => [id, minor(Math.max(0, Math.round(value)))]),
      ),
      interestCharged: minor(Math.round(interestThisMonth)),
      paid: minor(Math.round(paidThisMonth)),
      clearedIds: clearedThisMonth,
    });

    // Nothing moved and nothing is cleared: the budget cannot cover interest.
    if (paidThisMonth === 0) {
      return {
        strategy,
        months: null,
        totalInterest: minor(Math.round(totalInterest)),
        totalPaid: minor(Math.round(totalPaid)),
        timeline,
        clearedOrder,
      };
    }
  }

  const cleared = [...balances.values()].every((value) => value <= 0);

  return {
    strategy,
    months: cleared ? timeline.length : null,
    totalInterest: minor(Math.round(totalInterest)),
    totalPaid: minor(Math.round(totalPaid)),
    timeline,
    clearedOrder,
  };
}

export interface PayoffComparison {
  smallestFirst: PayoffPlan;
  costliestFirst: PayoffPlan;
  /** What paying the smallest first costs in extra interest. Never negative. */
  extraInterest: Minor;
  /** How many months longer the smallest-first route takes. */
  extraMonths: number;
  minimumRequired: Minor;
  budgetTooLow: boolean;
}

export function comparePayoff(
  debts: readonly DebtAccount[],
  monthlyBudget: Minor,
): PayoffComparison {
  const smallestFirst = simulatePayoff(debts, monthlyBudget, 'smallest_first');
  const costliestFirst = simulatePayoff(debts, monthlyBudget, 'costliest_first');
  const minimumRequired = totalMinimum(debts);

  return {
    smallestFirst,
    costliestFirst,
    extraInterest: minor(Math.max(0, smallestFirst.totalInterest - costliestFirst.totalInterest)),
    extraMonths: Math.max(0, (smallestFirst.months ?? 0) - (costliestFirst.months ?? 0)),
    minimumRequired,
    budgetTooLow: monthlyBudget < minimumRequired,
  };
}

export function strategyLabel(strategy: Strategy): string {
  return strategy === 'smallest_first' ? 'Smallest balance first' : 'Most expensive first';
}

/** A complete sentence weighing the two up, without picking for them. */
export function describeComparison(
  comparison: PayoffComparison,
  format: (amount: Minor) => string,
): string {
  if (comparison.budgetTooLow) {
    return (
      `That is less than the minimum payments across everything, which come to ` +
      `${format(comparison.minimumRequired)} a month. Below that the balances would keep growing.`
    );
  }

  const cheapest = comparison.costliestFirst;
  if (cheapest.months === null) {
    return 'At this amount the interest grows faster than the payments, so the debt never clears. Try a higher figure.';
  }

  if (comparison.extraInterest === 0 && comparison.extraMonths === 0) {
    return 'With these debts both routes work out the same, so pick whichever you prefer.';
  }

  const monthsText =
    comparison.extraMonths === 0
      ? 'and finish at the same time'
      : `and take ${comparison.extraMonths} ${comparison.extraMonths === 1 ? 'month' : 'months'} longer`;

  return (
    `Clearing the most expensive first gets you there in ${cheapest.months} ` +
    `${cheapest.months === 1 ? 'month' : 'months'}. Going smallest first would cost ` +
    `${format(comparison.extraInterest)} more in interest ${monthsText} — but you would see ` +
    `your first debt disappear sooner, which for a lot of people is what makes it stick.`
  );
}
