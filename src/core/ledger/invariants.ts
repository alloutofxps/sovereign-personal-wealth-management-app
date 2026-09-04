/* ===========================================================================
 * THE INVARIANT ENGINE — I1 to I10
 * ---------------------------------------------------------------------------
 * Ten properties that must hold over the whole journal, written as executable
 * checks rather than as comments. They run in the property tests over randomly
 * generated sequences of entries, and they will run again as database triggers
 * once storage exists in Phase 4.
 *
 * Three of the ten were written in the Phase 1 draft against a multi-currency
 * ledger with an ingestion layer. v1 has neither, so they are stated here in
 * the strongest form the current model can actually enforce, and each says
 * plainly what it becomes later:
 *
 *   I2   was "the FX residual is posted explicitly".
 *        Now: every amount is an exact integer in the one ledger currency.
 *   I3   was "split amounts sum to the parent transaction".
 *        Restored in Slice 6.2, now that splits exist — and in the stronger
 *        form the two-book model makes possible: the split must add up to the
 *        payment in *both* books, and to the same allocation in each. A split
 *        of 80/40 financially and 60/60 in the budget balances perfectly and
 *        is nonsense, and nothing else here would catch it.
 *   I10  was "an FX round trip drifts by at most one minor unit".
 *        Now: an entry and its reversal cancel exactly, on every account.
 *
 * Violation messages are user-facing. If one of these ever fires in front of
 * a person, they should be able to read it and understand what is wrong with
 * their books without knowing what a posting is.
 * ======================================================================== */

import { minorUnitExponent, type CurrencyCode, type Minor } from '@/core/money';
// Deep import on purpose: see the note in the money barrel.
import { convertCurrency, convertMinorUnits, rate1e6 } from '@/core/money/fx';
import { allRawBalances, bookTotal, totalWhere } from './balances';
import {
  BOOK_BY_TYPE,
  LedgerError,
  type AccountId,
  type Book,
  type EntryId,
  type JournalEntry,
  type LedgerAccount,
  type LedgerSnapshot,
} from './types';

export type InvariantCode =
  | 'I1' | 'I2' | 'I3' | 'I4' | 'I5'
  | 'I6' | 'I7' | 'I8' | 'I9' | 'I10';

export interface InvariantViolation {
  code: InvariantCode;
  /** A short name for the rule, for logs and the audit screen. */
  rule: string;
  /** A complete sentence explaining what is wrong, in plain English. */
  message: string;
  entryId?: EntryId;
  accountId?: AccountId;
  observed?: number;
  expected?: number;
}

type Check = (snapshot: LedgerSnapshot) => InvariantViolation[];

/* --- I1: both books balance, on every single entry ----------------------
 *
 * Asserted on the reporting currency, because that is the only figure every
 * line of a cross-currency entry shares. €1,000 out and $1,080 in is a correct
 * transfer whose native amounts sum to 80; "does this balance?" is only
 * answerable once both sides are expressed the same way. For an entry that
 * never left the base currency the two are identical, so nothing changes for
 * the overwhelming majority of what this ledger holds.
 * ---------------------------------------------------------------------- */

const i1: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  for (const entry of snapshot.entries) {
    for (const book of ['FINANCIAL', 'BUDGET'] as Book[]) {
      const lines = entry.postings.filter((p) => p.book === book);
      if (lines.length === 0) continue;
      const total = lines.reduce((sum, p) => sum + p.baseAmount, 0);
      if (total !== 0) {
        violations.push({
          code: 'I1',
          rule: 'Every entry balances in every book',
          message:
            `"${entry.description}" does not add up. The money going in and the money ` +
            `coming out differ by ${Math.abs(total)}, so this record is incomplete.`,
          entryId: entry.id,
          observed: total,
          expected: 0,
        });
      }
    }
  }
  return violations;
};

/* --- I2: the FX residual is posted explicitly ---------------------------
 *
 * Restored to its Phase 1 specification now that there is more than one
 * currency to have a residual between.
 *
 * Converting several lines of one entry rounds each of them on its own, so the
 * base amounts can land a unit apart from each other. That unit has to go
 * somewhere, and the entire rule is that it goes somewhere *nameable*: an
 * explicit posting to the rounding-variance account, rather than being nudged
 * into whichever line is largest and disappearing.
 *
 * The check has teeth because it works the other way round. Every line except
 * the variance account must have a base amount that is exactly its own native
 * amount converted at its own rate. If a builder quietly adjusted a line to
 * make the books balance, that line no longer matches its rate and this says
 * so — which is the only way to catch a residual that was hidden rather than
 * posted.
 *
 * The integer checks stay here too. An amount that is not a whole number, or
 * is nothing at all, is the same class of failure: arithmetic that cannot be
 * relied on to the penny.
 * ---------------------------------------------------------------------- */

/**
 * What a line's base amount ought to be, given its own rate.
 *
 * Exponent-aware when both currencies are known, because ¥16,000 and €160.00
 * are the same integer meaning a hundredfold different amount. When they are
 * not known the two are assumed to have two decimal places, which is true of
 * every pair this app can currently produce and makes the check a no-op rather
 * than a false alarm.
 */
function expectedBaseAmount(
  posting: { amount: Minor; fxRateScaled: number },
  account: LedgerAccount | undefined,
  baseCurrency: string | undefined,
): Minor {
  const rate = rate1e6(posting.fxRateScaled);
  const quote = account?.currency ?? null;

  if (!quote || !baseCurrency || quote === baseCurrency) {
    return convertCurrency(posting.amount, rate, 'quoteToBase');
  }

  return convertMinorUnits({
    amount: posting.amount,
    rateScaled: rate,
    direction: 'quoteToBase',
    quoteExponent: minorUnitExponent(quote as CurrencyCode),
    baseExponent: minorUnitExponent(baseCurrency as CurrencyCode),
  });
}

const i2: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];

  for (const entry of snapshot.entries) {
    for (const posting of entry.postings) {
      if (!Number.isSafeInteger(posting.amount) || !Number.isSafeInteger(posting.baseAmount)) {
        violations.push({
          code: 'I2',
          rule: 'Amounts are exact whole numbers',
          message:
            `An amount in "${entry.description}" is not a whole number of pence, ` +
            `which means it can no longer be relied on to the penny.`,
          entryId: entry.id,
          accountId: posting.accountId,
          observed: posting.amount,
        });
      }
      if (posting.amount === 0) {
        violations.push({
          code: 'I2',
          rule: 'Amounts are exact whole numbers',
          message: `"${entry.description}" contains a line for nothing at all.`,
          entryId: entry.id,
          accountId: posting.accountId,
        });
      }

      // Every line has to be its own amount at its own rate. A line that is
      // not is a line somebody adjusted to force a balance.
      //
      // Skipped when the amounts are not whole numbers: that has already been
      // reported just above, and the conversion below is integer arithmetic
      // that would throw rather than report anything useful about it.
      if (
        !Number.isSafeInteger(posting.amount) ||
        !Number.isSafeInteger(posting.baseAmount) ||
        !Number.isSafeInteger(posting.fxRateScaled) ||
        posting.fxRateScaled <= 0
      ) {
        continue;
      }

      const account = snapshot.accounts.get(posting.accountId);
      const expected = expectedBaseAmount(posting, account, snapshot.baseCurrency);
      if (posting.baseAmount !== expected) {
        violations.push({
          code: 'I2',
          rule: 'Every converted line matches the rate it was converted at',
          message:
            `A line in "${entry.description}" says it was converted at ` +
            `${(posting.fxRateScaled / 1_000_000).toFixed(6)} but does not come to that. ` +
            `A rounding difference has been absorbed into it instead of being ` +
            `recorded on its own.`,
          entryId: entry.id,
          accountId: posting.accountId,
          observed: posting.baseAmount,
          expected,
        });
      }
    }
  }

  return violations;
};

/* --- I3: entries are well formed, and splits agree across both books ---- */

/** Total debited to a book, which for a split is what its lines add up to. */
function debitsIn(entry: JournalEntry, book: Book): number {
  return entry.postings
    .filter((p) => p.book === book && p.amount > 0)
    .reduce((sum, p) => sum + p.amount, 0);
}

const i3: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  for (const entry of snapshot.entries) {
    // The restored half of I3. A split records the same allocation twice, once
    // per book; if the two ever disagree the money has been categorised one
    // way and budgeted another, and every figure downstream is wrong.
    if (entry.kind === 'SPEND_SPLIT') {
      const financial = debitsIn(entry, 'FINANCIAL');
      const budget = debitsIn(entry, 'BUDGET');
      if (financial !== budget) {
        violations.push({
          code: 'I3',
          rule: 'A split adds up to the same payment in both books',
          message:
            `"${entry.description}" splits into ${financial} one way and ${budget} the ` +
            `other. The parts of a payment have to add up to the same total however ` +
            `they are looked at.`,
          entryId: entry.id,
        });
      }

      // Matching totals are not enough: 80/40 and 60/60 both come to 120.
      // The shares themselves have to correspond, so compare the two books'
      // allocations as multisets — sorted, because order is a convention of
      // the builder rather than something stored data can be trusted to keep.
      const categories = entry.postings
        .filter((p) => p.book === 'FINANCIAL' && p.amount > 0)
        .map((p) => p.amount)
        .sort((a, b) => a - b);
      const envelopes = entry.postings
        .filter((p) => p.book === 'BUDGET' && p.amount > 0)
        .map((p) => p.amount)
        .sort((a, b) => a - b);

      const sameShares =
        categories.length === envelopes.length &&
        categories.every((amount, index) => amount === envelopes[index]);

      if (!sameShares) {
        violations.push({
          code: 'I3',
          rule: 'A split adds up to the same payment in both books',
          message:
            `"${entry.description}" divides the payment one way against your categories ` +
            `and a different way against your pots. The shares have to match.`,
          entryId: entry.id,
        });
      }
    }

    const booksTouched = new Set(entry.postings.map((p) => p.book));

    for (const book of booksTouched) {
      const lines = entry.postings.filter((p) => p.book === book);
      if (lines.length < 2) {
        violations.push({
          code: 'I3',
          rule: 'Every movement has two sides',
          message:
            `"${entry.description}" records money moving without saying where it ` +
            `came from or where it went.`,
          entryId: entry.id,
        });
      }
    }

    for (const posting of entry.postings) {
      const account = snapshot.accounts.get(posting.accountId);
      if (!account) {
        violations.push({
          code: 'I3',
          rule: 'Every line points at a real account',
          message: `"${entry.description}" refers to an account that no longer exists.`,
          entryId: entry.id,
          accountId: posting.accountId,
        });
        continue;
      }
      if (BOOK_BY_TYPE[account.type] !== posting.book) {
        violations.push({
          code: 'I3',
          rule: 'Every line points at a real account',
          message:
            `"${entry.description}" files ${account.name} under the wrong set of books.`,
          entryId: entry.id,
          accountId: posting.accountId,
        });
      }
    }
  }
  return violations;
};

/* --- I4: budgetable cash mirrors real spendable money ------------------- */

const i4: Check = (snapshot) => {
  const budgetable = totalWhere(snapshot, (a) => a.type === 'BUDGETABLE_CASH');
  const liquid = totalWhere(snapshot, (a) => a.type === 'ASSET' && a.onBudget && a.liquid);

  if (budgetable === liquid) return [];
  return [
    {
      code: 'I4',
      rule: 'Budgeted money matches money you actually have',
      message:
        `The amount your budget thinks you have does not match what is really in ` +
        `your everyday accounts. They differ by ${Math.abs(budgetable - liquid)}.`,
      observed: budgetable,
      expected: liquid,
    },
  ];
};

/* --- I5: every penny is either in a pot or waiting to be given a job ---- */

const i5: Check = (snapshot) => {
  const cash = totalWhere(snapshot, (a) => a.type === 'BUDGETABLE_CASH');
  const envelopes = totalWhere(snapshot, (a) => a.type === 'ENVELOPE');
  const readyToAssign = totalWhere(snapshot, (a) => a.type === 'READY_TO_ASSIGN');

  // Envelopes and Ready-to-Assign hold credit balances, so a consistent
  // budget book nets to exactly zero against budgetable cash.
  const total = cash + envelopes + readyToAssign;
  if (total === 0) return [];
  return [
    {
      code: 'I5',
      rule: 'Every penny is accounted for',
      message:
        `${Math.abs(total)} is unaccounted for: the money in your pots plus the money ` +
        `still waiting to be given a job does not add up to what you have.`,
      observed: total,
      expected: 0,
    },
  ];
};

/* --- I6, I7, I8: what does and does not count as spending --------------- */

function contributionOf(
  snapshot: LedgerSnapshot,
  entries: readonly JournalEntry[],
  type: 'EXPENSE' | 'INCOME',
): Minor {
  return totalWhere({ ...snapshot, entries }, (a) => a.type === type);
}

const i6: Check = (snapshot) => {
  // Buying an investment is here deliberately. It is an exchange of one asset
  // for another — cash out, holding in — and treating it as spending would
  // tell somebody who saved hard into a pension that they had a terrible
  // month. The rule that protects transfers protects buys for the same reason.
  const neutral = snapshot.entries.filter(
    (e) =>
      e.kind === 'TRANSFER' ||
      e.kind === 'CC_PAYMENT' ||
      e.kind === 'INVESTMENT_BUY' ||
      e.kind === 'INVESTMENT_SELL',
  );
  const spending = contributionOf(snapshot, neutral, 'EXPENSE');
  const income = contributionOf(snapshot, neutral, 'INCOME');

  const violations: InvariantViolation[] = [];
  if (spending !== 0) {
    violations.push({
      code: 'I6',
      rule: 'Moving your own money is not spending',
      message:
        `Moving money between your accounts, paying off a card, or putting money into ` +
        `an investment has been counted as spending. That would show ` +
        `${Math.abs(spending)} you have not actually spent.`,
      observed: spending,
      expected: 0,
    });
  }
  if (income !== 0) {
    violations.push({
      code: 'I6',
      rule: 'Moving your own money is not income',
      message:
        `Moving your own money — between accounts, or in and out of an investment — ` +
        `has been counted as money coming in, which would make your income look ` +
        `${Math.abs(income)} higher than it is.`,
      observed: income,
      expected: 0,
    });
  }
  return violations;
};

const i7: Check = (snapshot) => {
  const fronted = snapshot.entries.filter(
    (e) => e.kind === 'REIMBURSABLE' || e.kind === 'REIMBURSEMENT',
  );
  const spending = contributionOf(snapshot, fronted, 'EXPENSE');
  const income = contributionOf(snapshot, fronted, 'INCOME');

  const violations: InvariantViolation[] = [];
  if (spending !== 0) {
    violations.push({
      code: 'I7',
      rule: 'Money you fronted is not your spending',
      message:
        `Money you paid out for someone else has been counted as your own spending. ` +
        `That would overstate what you spent by ${Math.abs(spending)}.`,
      observed: spending,
      expected: 0,
    });
  }
  if (income !== 0) {
    violations.push({
      code: 'I7',
      rule: 'Being paid back is not income',
      message:
        `Being paid back has been counted as money you earned. Getting your own money ` +
        `returned is not income, and this would overstate it by ${Math.abs(income)}.`,
      observed: income,
      expected: 0,
    });
  }
  return violations;
};

const i8: Check = (snapshot) => {
  const refunds = snapshot.entries.filter((e) => e.kind === 'REFUND');
  const income = contributionOf(snapshot, refunds, 'INCOME');
  const spending = contributionOf(snapshot, refunds, 'EXPENSE');

  const violations: InvariantViolation[] = [];
  if (income !== 0) {
    violations.push({
      code: 'I8',
      rule: 'A refund is not income',
      message:
        `A refund has been counted as money you earned. It should reduce what you ` +
        `spent instead, or your income looks ${Math.abs(income)} higher than it is.`,
      observed: income,
      expected: 0,
    });
  }
  if (spending > 0) {
    violations.push({
      code: 'I8',
      rule: 'A refund reduces what you spent',
      message: `A refund has increased what you spent rather than reducing it.`,
      observed: spending,
    });
  }
  return violations;
};

/* --- I9, I10: corrections are appended, and cancel exactly -------------- */

const i9: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  const byId = new Map(snapshot.entries.map((e) => [e.id, e]));
  const reversedTargets = new Set<EntryId>();

  for (const entry of snapshot.entries) {
    if (!entry.reversesEntryId) continue;

    const original = byId.get(entry.reversesEntryId);
    if (!original) {
      violations.push({
        code: 'I9',
        rule: 'Corrections point at what they correct',
        message: `A correction refers to a record that is no longer there.`,
        entryId: entry.id,
      });
      continue;
    }

    if (reversedTargets.has(original.id)) {
      violations.push({
        code: 'I9',
        rule: 'A record is only corrected once',
        message:
          `"${original.description}" has been cancelled more than once, which would ` +
          `remove the same amount twice.`,
        entryId: entry.id,
      });
    }
    reversedTargets.add(original.id);

    if (original.postings.length !== entry.postings.length) {
      violations.push({
        code: 'I9',
        rule: 'A correction mirrors the original exactly',
        message: `The correction to "${original.description}" does not match it line for line.`,
        entryId: entry.id,
      });
    }
  }
  return violations;
};

const i10: Check = (snapshot) => {
  const violations: InvariantViolation[] = [];
  const byId = new Map(snapshot.entries.map((e) => [e.id, e]));

  for (const entry of snapshot.entries) {
    if (!entry.reversesEntryId) continue;
    const original = byId.get(entry.reversesEntryId);
    if (!original) continue;

    const pair: LedgerSnapshot = { ...snapshot, entries: [original, entry] };

    // The reporting currency, which is what every balance is read in.
    for (const [accountId, balance] of allRawBalances(pair)) {
      if (balance !== 0) {
        violations.push({
          code: 'I10',
          rule: 'A cancelled record leaves nothing behind',
          message:
            `Cancelling "${original.description}" left ${Math.abs(balance)} behind on one ` +
            `of your accounts, so the correction did not fully undo it.`,
          entryId: entry.id,
          accountId,
          observed: balance,
          expected: 0,
        });
      }
    }

    // And the native side, account by account. Restored to its Phase 1 form:
    // a multi-currency reversal that cancelled what you are worth while
    // leaving the dollar account a few dollars out would pass every other
    // check in this file and be plainly wrong on the statement.
    const native = new Map<AccountId, number>();
    for (const posting of [...original.postings, ...entry.postings]) {
      native.set(posting.accountId, (native.get(posting.accountId) ?? 0) + posting.amount);
    }

    for (const [accountId, balance] of native) {
      if (balance !== 0) {
        violations.push({
          code: 'I10',
          rule: 'A cancelled record leaves nothing behind',
          message:
            `Cancelling "${original.description}" left ${Math.abs(balance)} behind in the ` +
            `currency of one of your accounts, even though what you are worth came back ` +
            `to where it started.`,
          entryId: entry.id,
          accountId,
          observed: balance,
          expected: 0,
        });
      }
    }
  }
  return violations;
};

/* --- the suite ----------------------------------------------------------- */

export const INVARIANTS: Record<InvariantCode, Check> = {
  I1: i1,
  I2: i2,
  I3: i3,
  I4: i4,
  I5: i5,
  I6: i6,
  I7: i7,
  I8: i8,
  I9: i9,
  I10: i10,
};

/** Run every rule. An empty array means the books are sound. */
export function checkInvariants(snapshot: LedgerSnapshot): InvariantViolation[] {
  return (Object.keys(INVARIANTS) as InvariantCode[]).flatMap((code) =>
    INVARIANTS[code](snapshot),
  );
}

/** Run one rule by name. Used by the tests to isolate failures. */
export function checkInvariant(
  code: InvariantCode,
  snapshot: LedgerSnapshot,
): InvariantViolation[] {
  return INVARIANTS[code](snapshot);
}

/** Throw on the first problem. For use at a write boundary. */
export function assertInvariants(snapshot: LedgerSnapshot): void {
  const violations = checkInvariants(snapshot);
  if (violations.length > 0) {
    const first = violations[0]!;
    throw new LedgerError(
      `${first.code} (${first.rule}): ${first.message}` +
        (violations.length > 1 ? ` — and ${violations.length - 1} more.` : ''),
    );
  }
}

/** Convenience: does the whole of each book net to zero? */
export function booksBalance(snapshot: LedgerSnapshot): boolean {
  return bookTotal(snapshot, 'FINANCIAL') === 0 && bookTotal(snapshot, 'BUDGET') === 0;
}
