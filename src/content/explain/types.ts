/* ===========================================================================
 * EXPLANATIONS
 * ---------------------------------------------------------------------------
 * The explanations were never the problem. Their placement and their register
 * were. They sat inline in the card, which meant every screen was a wall of
 * prose explaining itself instead of showing itself, and they were written by
 * somebody who already understood personal finance.
 *
 * So they move behind an information button, and they get rewritten for a
 * person who does not already know what a cost basis is.
 *
 * ---------------------------------------------------------------------------
 * THE COPY STANDARD
 *
 * Second person, active voice, present tense, reading age about twelve.
 *
 *   short  answers the question on its own. If somebody reads only that line
 *          they are not confused. Twenty words at the outside.
 *   how    spells the arithmetic out with real numbers and no named concepts.
 *          Three sentences at the outside.
 *   worked the same sum built from the person's own figures, where the screen
 *          has them. An explanation that says "€412 of bills" when their bills
 *          are €412 is worth ten that say "your bills".
 *
 * Banned unless the same sentence defines them: envelope, pacing, disposal,
 * FIFO, cost basis, deferred tax, runway, book, posting, double-entry,
 * reconcile, accrual, amortisation, drift, allocation, liquidity, position.
 *
 * No apologising, no hedging, no "simply", no "just". Never explain the
 * interface — explain the money.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE CAVEATS GO
 *
 * Simplifying must not make anything untrue, and some of these engines have
 * real subtleties that plain language cannot carry in three sentences. Those
 * do not get compressed into a half-truth: the simple version stays here and
 * the caveat goes into the linked manual chapter, which is what `manual` is
 * for. A `short` that is only true most of the time is worse than no short.
 * ======================================================================== */

import type { Minor } from '@/core/money';

export type ExplainTopic =
  | 'safe-to-spend'
  | 'pace'
  | 'cushion'
  | 'envelopes'
  | 'cover'
  | 'net-worth'
  | 'two-books'
  | 'pots'
  | 'cards'
  | 'selling'
  | 'checking'
  | 'deferred-tax'
  | 'fee-drag'
  | 'rebalance'
  | 'runway'
  | 'recovery-phrase'
  | 'storage'
  | 'tax-regime'
  | 'cgt';

/**
 * The six chapter slugs, repeated rather than imported.
 *
 * `src/features/manual/chapters/slugs.ts` is the home of these, and importing
 * it from here would point the content layer at a feature — the wrong way
 * round. There is a test asserting the two lists agree, which is cheaper than
 * the layering violation and catches the same mistake.
 */
export type ChapterSlug =
  | 'safe-to-spend'
  | 'two-books'
  | 'pots'
  | 'cards'
  | 'selling'
  | 'checking';

/**
 * Live figures, where the screen showing the button has them.
 *
 * Every field is optional and every `worked()` has to cope with any of them
 * being absent, because the same button appears on screens that know
 * different things. A worked example that cannot be built is simply not shown
 * — better than one built from zeroes, which would read as a real answer.
 */
export interface ExplainFigures {
  /* Safe to spend, and the four things taken off it. */
  liquidCash: Minor;
  billsDue: Minor;
  cardsOwed: Minor;
  cushion: Minor;
  setAsideInPots: Minor;
  safeToSpend: Minor;

  /* Pace. */
  dailyPace: Minor;
  paceDays: number;
  spentThisCycle: Minor;
  elapsedPercent: number;
  spentPercent: number;

  /* What you are worth. */
  netWorth: Minor;
  totalAssets: Minor;
  totalDebts: Minor;

  /* Investments. */
  portfolioValue: Minor;
  portfolioCost: Minor;
  unrealisedGain: Minor;
  feeBp: number;
  feeThisYear: Minor;

  /* Tax. */
  taxRegime: 'none' | 'dutch_box3' | 'flat_gains';
  taxAmount: Minor;
  taxableAmount: Minor;
  reliefApplied: Minor;
  cgtRateBp: number;
  cgtExemption: Minor;

  /* How long the money lasts. */
  usableCash: Minor;
  monthlyNeed: Minor;
  runwayMonths: number;
}

export interface ExplainContext {
  /** Formats an amount exactly as the rest of the app does. */
  money: (amount: Minor) => string;
  /** Whatever the screen knows. Everything is optional; see above. */
  figures: Partial<ExplainFigures>;
}

export interface Explanation {
  id: ExplainTopic;
  /** Sentence case, four words at the outside. */
  title: string;
  /** The whole answer, on its own. */
  short: string;
  /** The arithmetic, spelled out. */
  how: string[];
  /**
   * The same sum in the person's own figures.
   *
   * Returns null when the screen does not have what it needs, and the sheet
   * then shows only `how`. Never invents a figure to fill a gap.
   */
  worked?: (context: ExplainContext) => string | null;
  /** The chapter that carries the caveats this cannot. */
  manual?: ChapterSlug;
}
