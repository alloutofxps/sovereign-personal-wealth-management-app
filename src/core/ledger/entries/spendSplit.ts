/* ===========================================================================
 * ONE PAYMENT, SEVERAL CATEGORIES
 * ---------------------------------------------------------------------------
 * A supermarket trip is rarely one thing. €120 at Costco is groceries and
 * household and something for the bathroom cabinet, and forcing it into a
 * single category is the most-complained-about limitation in every budgeting
 * app that has it.
 *
 * The storage has always been able to hold this — an entry is a set of
 * postings, not a pair — so nothing about the schema changes. What was missing
 * was a builder that lays the lines down in both books at once and refuses to
 * let them drift apart.
 *
 * That last part is the whole point. A split allocated €80/€40 in the
 * financial book and €60/€60 in the budget book balances perfectly and is
 * completely wrong; it is the same shape of bug as the card-import defect,
 * where both books summed to zero and the figures still meant the wrong thing.
 * So the correspondence is asserted here at construction, and again over
 * stored data by invariant I3.
 * ======================================================================== */

import { ZERO, minor, type Minor } from '@/core/money';
import {
  LedgerError,
  type AccountId,
  type Funding,
  type JournalEntry,
  type SystemAccounts,
} from '../types';
import { assertFundingMatchesAccount } from '../funding';
import { buildEntry, credit, debit, type EntryBase, type PostingSpec } from './common';

const FIN = 'FINANCIAL' as const;
const BUD = 'BUDGET' as const;

export interface SplitLine {
  /** The EXPENSE account — what this part of the payment was for. */
  categoryId: AccountId;
  /** The envelope that part draws from. */
  envelopeId: AccountId;
  /** Positive minor units. */
  amount: Minor;
  /** A note about this line alone: "Sam's half", "for the office". */
  memo?: string;
}

export interface SpendSplitParams extends EntryBase {
  /** What the whole payment was, as the person would say it. */
  payee?: string;
  funding: Funding;
  lines: readonly SplitLine[];
  system: SystemAccounts;
}

/** What the split adds up to. Exported because the editor needs the same sum. */
export function splitTotal(lines: readonly SplitLine[]): Minor {
  return minor(lines.reduce((sum, line) => sum + line.amount, 0));
}

/**
 * Money spent on several things at once.
 *
 * Each line debits its own category and its own envelope; the funding account
 * and the cash-or-reserve side are credited once, for the whole amount. The
 * two books therefore carry the same allocation twice over, which is exactly
 * what makes the correspondence checkable.
 */
export function spendSplit(p: SpendSplitParams): JournalEntry {
  if (p.lines.length < 2) {
    throw new LedgerError(
      'A split needs at least two categories. For a payment that was all one thing, ' +
        'record it as an ordinary payment instead.',
    );
  }

  for (const line of p.lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) {
      throw new LedgerError(
        'Every part of a split has to be more than zero. Remove the empty line, or ' +
          'put an amount in it.',
      );
    }
  }

  const total = splitTotal(p.lines);
  if (total <= ZERO) {
    throw new LedgerError('A split has to add up to more than nothing.');
  }

  assertFundingMatchesAccount(p.funding.account, p.funding);

  // Both books get the same allocation, line for line and in the same order,
  // so I3 can check them against each other afterwards.
  const financial: PostingSpec[] = p.lines.map((line) =>
    line.memo === undefined
      ? debit(FIN, line.categoryId, line.amount)
      : debit(FIN, line.categoryId, line.amount, line.memo),
  );

  const budget: PostingSpec[] = p.lines.map((line) => debit(BUD, line.envelopeId, line.amount));

  const fundingSide =
    p.funding.via === 'card'
      ? credit(BUD, p.funding.paymentEnvelopeId, total)
      : credit(BUD, p.system.budgetableCash, total);

  const description = p.payee
    ? `Paid ${p.payee}, split ${p.lines.length} ways.`
    : `A payment split ${p.lines.length} ways.`;

  return buildEntry(p, 'SPEND_SPLIT', description, [
    ...financial,
    credit(FIN, p.funding.account.id, total),
    ...budget,
    fundingSide,
  ]);
}
