/* ===========================================================================
 * WHAT SOMETHING IS WORTH NOW
 * ---------------------------------------------------------------------------
 * A house is worth more than it was. A car is worth less. Neither of those is
 * something anybody earned or spent, and the whole point of this file is that
 * the ledger says so.
 *
 * The failure this exists to prevent is the one every spreadsheet makes: a
 * property revalued as income, or a car's decline booked as an expense. Do
 * that and the person is told their spending doubled the month they revalued
 * their car, that they earned €15,000 they cannot touch, and — worst — that
 * they have more to spend than they do. It is the exact opposite of what a
 * balance sheet is for.
 *
 * So a valuation moves an asset against EQUITY and nothing else:
 *
 *     worth more    debit  the asset      credit unrealised gains
 *     worth less    credit the asset      debit  unrealised losses
 *
 * Net worth moves by the difference. Income, spending, pacing, the budget and
 * Safe-to-Spend do not move at all — not by rounding, not by a penny.
 *
 * The BUDGET book is not touched. It cannot be: budgetable cash mirrors
 * on-budget liquid assets (I4), so writing a budget leg for a house would
 * claim the house is spendable, and writing none for an on-budget account
 * would break the mirror. Rather than pick, the builder refuses an on-budget
 * account outright and says why.
 * ======================================================================== */

import type { Minor } from '@/core/money';
import { minor } from '@/core/money';
import {
  LedgerError,
  type JournalEntry,
  type LedgerAccount,
  type SystemAccounts,
} from '../types';
import { buildEntry, credit, debit, type EntryBase } from './common';

const FIN = 'FINANCIAL' as const;

export interface ValuationParams extends EntryBase {
  /**
   * The whole account, not an id.
   *
   * Whether a valuation is allowed at all depends on what the account is, and
   * a caller passing an id plus its own opinion of the rules is exactly how
   * the two come to disagree.
   */
  account: LedgerAccount;
  /** What it is reckoned to be worth on `date`, in minor units. */
  newValue: Minor;
  /** What the books currently say it is worth. The repository supplies it. */
  currentValue: Minor;
  /** The person's own note: "Local market reassessment". */
  notes?: string;
  system: SystemAccounts;
}

/**
 * Mark an asset to what it is now worth.
 *
 * Throws rather than returning null when nothing has changed. A null return
 * is silently discardable, and a caller that forgets to check it shows a
 * confirmation for an entry that was never written; the message below is
 * written to be shown to the person as it stands.
 */
export function valuation(p: ValuationParams): JournalEntry {
  if (p.account.type !== 'ASSET') {
    throw new LedgerError(
      `${p.account.name} is not something you own, so there is nothing to value. ` +
        `What you owe changes when you pay it, not when it is reassessed.`,
    );
  }

  if (p.account.onBudget) {
    throw new LedgerError(
      `${p.account.name} is one of your everyday accounts, and those change when money ` +
        `moves rather than when they are reassessed. Record what came in or went out ` +
        `instead, or move this account to tracking-only first.`,
    );
  }

  const delta = p.newValue - p.currentValue;

  if (delta === 0) {
    throw new LedgerError(
      `${p.account.name} is already recorded at that value, so there is nothing to change.`,
    );
  }

  const size = minor(Math.abs(delta));
  const worthMore = delta > 0;

  return buildEntry(
    p,
    'VALUATION',
    worthMore
      ? `${p.account.name} is now worth more than it was.`
      : `${p.account.name} is now worth less than it was.`,
    worthMore
      ? [debit(FIN, p.account.id, size), credit(FIN, p.system.unrealizedGain, size)]
      : [credit(FIN, p.account.id, size), debit(FIN, p.system.unrealizedLoss, size)],
    // Note what is *not* here: no BUDGET postings, and no INCOME or EXPENSE
    // account on either side. Both absences are the point of the entry.
  );
}

/* ===========================================================================
 * LOSING VALUE BY STANDING STILL
 * ---------------------------------------------------------------------------
 * A car does not wait to be revalued. Between the day it is bought and the day
 * somebody remembers to look, it has been quietly losing value the whole time,
 * and a balance sheet that shows the purchase price until then is wrong every
 * day in between.
 *
 * These are projections, not records. Nothing here writes to the journal —
 * they answer "what is this probably worth today?", and it takes somebody
 * accepting that figure to turn it into an entry. Same rule as every other
 * projection in the app: derived on the fly, never stored.
 * ======================================================================== */

export interface DepreciationTerms {
  /** What it cost, in minor units. */
  costBasis: Minor;
  /** The day the clock starts — usually the day it was bought. */
  from: string;
  /** Annual rate in basis points: 1500 is 15% a year. */
  rateBp: number;
  /** The floor it never falls below. Scrap value; defaults to nothing. */
  salvage?: Minor;
  model: 'straight_line' | 'declining_balance';
}

const MS_PER_DAY = 86_400_000;

function parseDay(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  // Local, not UTC: the day something was bought is a calendar day where the
  // person is, the same convention every other date in the app uses.
  return new Date(y, m - 1, d);
}

/**
 * How many years have passed, counted by anniversaries rather than by days.
 *
 * Dividing elapsed days by an average year length is the obvious way to do
 * this and it is wrong in a way people notice: at 365.25 days per year, a car
 * bought on the 1st of January is 0.9993 years old the following 1st of
 * January, so the first anniversary shows slightly less than a full year of
 * depreciation and the figure never lands on a round number. Counting whole
 * anniversaries and then prorating across the year actually in progress makes
 * an anniversary an anniversary, and handles leap years without a constant.
 */
function yearsBetween(from: string, to: string): number {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end) return 0;
  if (end <= start) return 0;

  let whole = end.getFullYear() - start.getFullYear();
  const anniversary = (years: number) => {
    const at = new Date(start.getFullYear() + years, start.getMonth(), start.getDate());
    // A 29 February anniversary rolls to 1 March in ordinary years, which is
    // the convention everywhere else that has to answer this question.
    return at;
  };

  if (anniversary(whole) > end) whole -= 1;

  const last = anniversary(whole);
  const next = anniversary(whole + 1);
  const spanDays = Math.round((next.getTime() - last.getTime()) / MS_PER_DAY);
  const doneDays = Math.round((end.getTime() - last.getTime()) / MS_PER_DAY);

  return whole + (spanDays > 0 ? doneDays / spanDays : 0);
}

/**
 * What something is probably worth after standing still for a while.
 *
 * Straight line takes the same slice off the original cost every year, which
 * is how most people think about a car and how tax authorities generally
 * compute one. Declining balance takes the same *proportion* off what is left,
 * which never quite reaches zero and matches how things actually hold value —
 * steep at first, then flattening.
 *
 * Both floor at the salvage value, and neither ever climbs: a rate applied
 * backwards from the start date would have a car appreciating before it was
 * bought, so anything before `from` is worth what it cost.
 */
export function depreciatedValue(terms: DepreciationTerms, asOf: string): Minor {
  const years = yearsBetween(terms.from, asOf);
  const salvage = terms.salvage ?? minor(0);

  if (years <= 0) return terms.costBasis;
  if (terms.rateBp <= 0) return terms.costBasis;

  const rate = terms.rateBp / 10_000;

  const raw =
    terms.model === 'straight_line'
      ? terms.costBasis - terms.costBasis * rate * years
      : terms.costBasis * Math.pow(1 - Math.min(1, rate), years);

  // Round once, at the end, and never below the floor or above what it cost.
  const bounded = Math.min(terms.costBasis, Math.max(salvage, Math.round(raw)));
  return minor(bounded);
}

/**
 * How much a thing has lost since it was bought, as a plain sentence.
 *
 * Written to be reassuring rather than alarming: a car losing value is the
 * most ordinary fact in personal finance, and an app that reports it as a
 * problem is teaching somebody to dread opening it.
 */
export function describeDepreciation(
  terms: DepreciationTerms,
  asOf: string,
  format: (amount: Minor) => string,
): string {
  const now = depreciatedValue(terms, asOf);
  const lost = minor(terms.costBasis - now);

  if (lost <= 0) {
    return `Still recorded at the ${format(terms.costBasis)} it cost.`;
  }

  return (
    `Reckoned at ${format(now)} today, about ${format(lost)} below what it cost, ` +
    `which is what things like this do.`
  );
}
