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
  | 'cgt'
  /* Recording, and what each kind of entry does to the figures. */
  | 'fronted'
  | 'transfers'
  | 'valuations'
  | 'corrections'
  | 'rules'
  /* The four screens that model something rather than record it. */
  | 'tags'
  | 'what-if'
  | 'independence'
  | 'importing'
  /* Looking back at a period, and getting out from under a debt. */
  | 'where-it-went'
  | 'payoff';

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

  /* Dividing the month up. */
  assignedThisPeriod: Minor;
  readyToAssign: Minor;
  /* Saving up. */
  potsMonthlyTotal: Minor;
  potsStillNeeded: Minor;
  /* Covering a shortfall. */
  coverShortfall: Minor;
  coverAvailable: Minor;
  /* Checking against the bank. */
  statementDifference: Minor;
  /* Keeping the records. */
  storageUsedBytes: number;

  /* How long the money lasts. */
  usableCash: Minor;
  monthlyNeed: Minor;
  runwayMonths: number;

  /*
   * Selling part of a holding.
   *
   * These come from the same relief engine that records the sale, not from a
   * second calculation done for the explanation - so the worked example and
   * the entry that lands in the ledger cannot disagree.
   */
  saleParcels: number;
  saleCostRelieved: Minor;
  saleProceeds: Minor;
  saleGain: Minor;

  /*
   * Money you paid on somebody else's behalf.
   *
   * `claimOutstanding` is what is still owed across every open claim;
   * `claimSettling` is what this one settlement is about to return, which the
   * settle sheet knows and the add sheet does not.
   */
  claimOutstanding: Minor;
  claimSettling: Minor;

  /* Moving money between two accounts, including across a currency. */
  transferOut: Minor;
  transferIn: Minor;

  /* Telling Sovereign what something is worth now. */
  valuationWas: Minor;
  valuationNow: Minor;

  /*
   * One entry, both books.
   *
   * The two totals a `two-books` example needs: what the money side of an
   * entry adds to and what the category side adds to. They are equal by
   * construction, and printing them both is the entire point -- an example
   * where they differ would mean the invariant had failed.
   */
  entryFinancialTotal: Minor;
  entryBudgetTotal: Minor;
  entryPostingCount: number;

  /*
   * Getting back to the mix you chose.
   *
   * Shares of the whole, in basis points, for the class that is furthest from
   * where it was meant to be - plus what putting money in would take to fix
   * it. No class name: every field here is a number, and naming the class
   * would mean the explanation could disagree with the tile that opened it.
   */
  mixCurrentBp: number;
  mixTargetBp: number;
  mixDepositToFix: Minor;

  /*
   * Looking back at a period.
   *
   * Four figures rather than the two the flow graph leads with, and the
   * distinction is the whole reason these exist. `totalIn` and `totalOut` are
   * conservation figures: the graph adds a synthetic source when a period did
   * more with its money than arrived in it, so that no ribbon has to run
   * backwards, and `totalIn` carries it. An explanation built from those two
   * would tell somebody that money they already had was income.
   *
   * `periodSaved` is money given a job rather than money that moved --
   * `assign` posts to the budget book only -- so it is separate from
   * `periodSpent` and never folded in with it. `periodRetained` is signed:
   * negative means the period did more than arrived.
   */
  periodIncome: Minor;
  periodSpent: Minor;
  periodSaved: Minor;
  periodRetained: Minor;

  /*
   * Getting out from under a debt.
   *
   * `debtMonthsToClear` is null when the payment never gets ahead of the
   * interest, which the simulation decides by running out of months rather
   * than by any formula -- so it is carried as null rather than as a large
   * number, and the worked example has a branch for it.
   *
   * `debtInterestThisMonth` is the first month of the simulation's own
   * timeline, not an annual rate divided down for display. One month's charge
   * is a fact; a year's interest is the simulation's result and cannot be had
   * by multiplying, because each month's charge lands on a balance the
   * previous month's payment already moved.
   */
  debtTotal: Minor;
  debtMonthlyPayment: Minor;
  debtMinimumTotal: Minor;
  debtInterestThisMonth: Minor;
  debtMonthsToClear: number | null;
  debtTotalInterest: Minor;
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
