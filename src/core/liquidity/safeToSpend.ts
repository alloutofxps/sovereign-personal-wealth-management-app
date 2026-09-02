/* ===========================================================================
 * WHAT IS ACTUALLY SAFE TO SPEND
 * ---------------------------------------------------------------------------
 *   SafeToSpend(t) = C_liquid(t) − Σ L_committed,i(t) − R_buffer − G_savings(t)
 *
 * The number the whole product is anchored to, and the reason it is worth
 * anything is that it is forward-looking: money already promised to a bill is
 * not money you can spend, even though it is sitting in your account today.
 *
 * Every subtraction is returned alongside the total. The figure is never
 * allowed to be a black box — a person can open it up and see each thing that
 * was taken off, named in words they would use themselves.
 * ======================================================================== */

import { ZERO, minor, mulDivRound, type Minor } from '@/core/money';
import type { Cycle } from './period';

/** One thing standing between the money in the account and the money to spend. */
export interface Commitment {
  /** A complete phrase a person would recognise: "Rent", "Your card bill". */
  label: string;
  amount: Minor;
  kind: 'bill' | 'card' | 'buffer' | 'goal';
  /** 'YYYY-MM-DD' when it is due, where that is known. */
  dueDate?: string;
}

export interface SafeToSpendInput {
  /** Cash in everyday accounts and savings you could spend today. */
  liquidCash: Minor;
  /** Bills and other known payments falling inside the horizon. */
  bills: readonly Commitment[];
  /** What is currently owed on cards, which will have to be paid from cash. */
  cardBalances: readonly Commitment[];
  /** The cushion that never gets spent, so a small surprise cannot overdraw. */
  buffer: Minor;
  /** Money already set aside for goals and irregular bills. */
  goalFunding: Minor;
  cycle: Cycle;
  /** Days until money next comes in, where that is known. */
  daysUntilIncome?: number;
}

export interface SafeToSpendResult {
  /** The headline figure. Can be negative, and that is information, not a fault. */
  safeToSpend: Minor;
  liquidCash: Minor;
  committed: Minor;
  buffer: Minor;
  goalFunding: Minor;
  /** Everything subtracted, in the order it should be shown. */
  breakdown: Commitment[];
  /**
   * What is left per day for the rest of the cycle. This is the number that
   * moves when someone overspends — instead of a warning appearing, tomorrow's
   * allowance quietly recalculates.
   */
  dailyPace: Minor;
  daysRemaining: number;
  daysUntilIncome: number | null;
}

export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const billTotal = sumOf(input.bills);
  const cardTotal = sumOf(input.cardBalances);
  const committed = minor(billTotal + cardTotal);

  const safeToSpend = minor(input.liquidCash - committed - input.buffer - input.goalFunding);

  const breakdown: Commitment[] = [
    ...input.cardBalances.filter((c) => c.amount !== 0),
    ...input.bills.filter((b) => b.amount !== 0),
  ];
  if (input.buffer !== 0) {
    breakdown.push({
      label: 'Your safety cushion',
      amount: input.buffer,
      kind: 'buffer',
    });
  }
  if (input.goalFunding !== 0) {
    breakdown.push({
      label: 'Money you have already set aside',
      amount: input.goalFunding,
      kind: 'goal',
    });
  }

  // Pace over whatever comes first: the end of the cycle, or the next time
  // money arrives. Stretching a shortfall past payday would be misleading.
  const horizon =
    input.daysUntilIncome !== undefined && input.daysUntilIncome > 0
      ? Math.min(input.cycle.remainingDays, input.daysUntilIncome)
      : input.cycle.remainingDays;
  const days = Math.max(1, horizon);

  return {
    safeToSpend,
    liquidCash: input.liquidCash,
    committed,
    buffer: input.buffer,
    goalFunding: input.goalFunding,
    breakdown,
    // Never suggests a negative daily allowance: below zero the honest message
    // is "there is nothing left", not "you may spend minus four pounds a day".
    dailyPace: safeToSpend > 0 ? mulDivRound(safeToSpend, 1, days) : ZERO,
    daysRemaining: input.cycle.remainingDays,
    daysUntilIncome: input.daysUntilIncome ?? null,
  };
}

function sumOf(items: readonly Commitment[]): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

/**
 * How long the money would last if nothing else came in.
 *
 *   Runway = what you can spend ÷ what you must spend each month
 *
 * Returned in whole days so it can be phrased as "about six weeks" rather
 * than as a decimal number of months nobody thinks in.
 */
export function runwayInDays(spendable: Minor, monthlyEssentials: Minor): number | null {
  if (monthlyEssentials <= 0) return null;
  if (spendable <= 0) return 0;
  return Math.floor((spendable * 30) / monthlyEssentials);
}
