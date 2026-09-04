/* ===========================================================================
 * THE LEDGER — TYPES
 * ---------------------------------------------------------------------------
 * One journal. Two books. Every entry balances independently in each.
 *
 *   FINANCIAL  assets, liabilities, equity, income, expense. This is the
 *              balance sheet and everything anyone would call "spending".
 *   BUDGET     fund accounting over the same events: budgetable cash on one
 *              side, envelopes and Ready-to-Assign on the other. This is
 *              Safe-to-Spend, envelope balances and burn pacing.
 *
 * Holding the envelope layer as a second *balanced* book — rather than as a
 * budgets table off to the side — is what makes credit cards, transfers,
 * reimbursements and refunds fall out of the arithmetic instead of each
 * needing its own special case in feature code.
 *
 * Sign convention, used everywhere and never varied:
 *
 *     amount > 0  is a DEBIT
 *     amount < 0  is a CREDIT
 *
 * regardless of whether the account is debit- or credit-normal. Presentation
 * flips the sign for credit-normal accounts; the arithmetic never does. This
 * is why "does this entry balance?" is always just `sum === 0`.
 * ======================================================================== */

import type { Minor } from '@/core/money';

/* --- identifiers --------------------------------------------------------- */

declare const idBrand: unique symbol;
type Id<K extends string> = string & { readonly [idBrand]: K };

export type AccountId = Id<'Account'>;
export type EntryId = Id<'Entry'>;
export type PostingId = Id<'Posting'>;
export type ClaimId = Id<'Claim'>;
export type TransferLinkId = Id<'TransferLink'>;

/** 'YYYY-MM-DD'. The accounting date; drives every period boundary. */
export type IsoDate = string & { readonly [idBrand]: 'IsoDate' };

export const accountId = (value: string): AccountId => value as AccountId;
export const entryId = (value: string): EntryId => value as EntryId;
export const claimId = (value: string): ClaimId => value as ClaimId;
export const isoDate = (value: string): IsoDate => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LedgerError(`A date must look like 2026-09-02, received "${value}".`);
  }
  return value as IsoDate;
};

export class LedgerError extends Error {
  override name = 'LedgerError';
}

/* --- the chart of accounts ----------------------------------------------- */

export type Book = 'FINANCIAL' | 'BUDGET';

export type LedgerAccountType =
  // FINANCIAL
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'EXPENSE'
  // BUDGET
  | 'BUDGETABLE_CASH'
  | 'ENVELOPE'
  | 'READY_TO_ASSIGN';

/** Which direction increases this account in ordinary presentation. */
export type Normal = 'DEBIT' | 'CREDIT';

export const NORMAL_BY_TYPE: Record<LedgerAccountType, Normal> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  BUDGETABLE_CASH: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
  ENVELOPE: 'CREDIT',
  READY_TO_ASSIGN: 'CREDIT',
};

export const BOOK_BY_TYPE: Record<LedgerAccountType, Book> = {
  ASSET: 'FINANCIAL',
  LIABILITY: 'FINANCIAL',
  EQUITY: 'FINANCIAL',
  INCOME: 'FINANCIAL',
  EXPENSE: 'FINANCIAL',
  BUDGETABLE_CASH: 'BUDGET',
  ENVELOPE: 'BUDGET',
  READY_TO_ASSIGN: 'BUDGET',
};

/**
 * What kind of thing an account is, as a person would name it.
 *
 * Deliberately about the thing rather than about how it behaves. How it
 * behaves is `onBudget` and `liquid`, which are set from the class when the
 * account is created and can then be overridden by somebody who knows their
 * own money better than a default does.
 */
export type AccountClass =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit_card'
  | 'loan'
  | 'mortgage'
  | 'brokerage'
  | 'retirement'
  | 'real_estate'
  | 'vehicle'
  | 'other_asset';

/** How something loses value on its own, with nothing being spent. */
export type DepreciationModel = 'none' | 'straight_line' | 'declining_balance';

/** What an envelope is for. Drives how the budget layer treats it. */
export type EnvelopeRole =
  | 'category'
  /** A parent node holding other envelopes, so a budget can roll up by group. */
  | 'group'
  | 'sinking_fund'
  | 'goal'
  | 'card_payment'
  | 'reimbursements'
  | 'safety_cushion';

export interface LedgerAccount {
  id: AccountId;
  book: Book;
  type: LedgerAccountType;
  /** How this account is named to the person using it. Plain English. */
  name: string;
  normal: Normal;
  parentId: AccountId | null;
  status: 'active' | 'archived' | 'closed';

  /**
   * On-budget accounts back the BUDGET book's budgetable cash. Off-budget
   * ("tracking") accounts — a pension, a house — move net worth only.
   * Meaningful on ASSET and LIABILITY accounts.
   */
  onBudget: boolean;
  /** Counts as cash you could actually spend today. Feeds Safe-to-Spend. */
  liquid: boolean;

  /** For a credit card: the envelope holding cash back for its bill. */
  paymentEnvelopeId: AccountId | null;
  /** For an ENVELOPE: what it is for. */
  envelopeRole: EnvelopeRole | null;

  /**
   * When this was retired, or null while it is still in use.
   *
   * Nothing is ever deleted. A category with history cannot be removed without
   * orphaning every posting that points at it and changing what past months
   * add up to, so retiring means hiding it from what comes next.
   */
  archivedAt?: string | null;
  colorToken?: string | null;
  icon?: string | null;

  /**
   * What kind of thing this is. Null on the three accounts that predate v10 —
   * read as "one of the originals" rather than guessed at from the type.
   */
  accountClass?: AccountClass | null;
  /** Who holds it, as the person would say it: "Revolut", "the credit union". */
  institution?: string | null;

  /** Set only on things that lose value by sitting still, like a car. */
  depreciationModel?: DepreciationModel | null;
  /** Annual rate in basis points: 1500 is 15% a year. */
  depreciationRateBp?: number | null;
  /** The floor it never falls below. Scrap value. */
  salvageValue?: Minor | null;
}

/**
 * How a payment was funded.
 *
 * `card` is the case that breaks naive budgeting apps: no cash moves, but the
 * envelope must still go down and cash must be set aside for the eventual
 * bill. Making it a distinct shape means a caller cannot forget the reserve.
 *
 * It carries the whole account rather than an id on purpose. `via` and the
 * account's type are two statements about the same fact, and when a caller
 * supplies them separately they can disagree — which is exactly how imported
 * card spending came to be recorded as cash. Holding the account here lets
 * `assertFundingMatchesAccount` check the two against each other, and lets
 * `fundingFor` derive the whole thing from the account so there is nothing
 * left to get wrong.
 */
export type Funding =
  | { via: 'cash'; account: LedgerAccount }
  | { via: 'card'; account: LedgerAccount; paymentEnvelopeId: AccountId };

/**
 * The handful of accounts the builders need to know by name rather than by
 * lookup. Passing them explicitly keeps every builder a pure function.
 */
export interface SystemAccounts {
  /** BUDGET: money that has arrived but has not been given a job yet. */
  readyToAssign: AccountId;
  /** BUDGET: mirror of every on-budget liquid balance. */
  budgetableCash: AccountId;
  /** FINANCIAL: the other side of an opening balance. */
  openingBalances: AccountId;
  /** FINANCIAL: money you fronted that is owed back to you. */
  receivables: AccountId;
  /** BUDGET: holds the cash committed to money you have fronted. */
  reimbursementsEnvelope: AccountId;
  /** FINANCIAL: money paid out by things you hold. Real income. */
  dividendIncome: AccountId;
  /**
   * FINANCIAL: tax withheld at source, which never reaches your account.
   *
   * EQUITY, not EXPENSE — and that distinction is the whole point. EXPENSE in
   * this ledger does not mean "a cost", it means "money you chose to spend",
   * and every spending figure, the daily burn rate, the pacing curve and
   * Safe-to-Spend are built on that meaning. Tax deducted before a dividend
   * reached you was never money you could have kept, so counting it as
   * spending would show a month of purchases nobody made.
   *
   * Debited, like `realizedLoss` — something that reduced what you are worth
   * without being a purchase.
   */
  investmentTaxWithheld: AccountId;
  /**
   * FINANCIAL: where a rise in what something is worth is booked.
   *
   * Equity, never income. A house going up in value has not paid anybody
   * anything, and counting it as income would tell somebody they could spend
   * their kitchen.
   */
  unrealizedGain: AccountId;
  /** FINANCIAL: the other direction. Equity, never an expense. */
  unrealizedLoss: AccountId;
  /**
   * FINANCIAL: a gain that has actually been taken, by selling.
   *
   * Equity, never income — for the same reason a valuation is not income. The
   * money did not come from anywhere new; a holding that was already yours
   * turned into cash that is also yours. Counting it as earnings would tell
   * somebody who sold a fund that they had their best month in years.
   */
  realizedGain: AccountId;
  /** FINANCIAL: a loss taken by selling. Equity, never an expense. */
  realizedLoss: AccountId;
}

/* --- the journal --------------------------------------------------------- */

export type EntryKind =
  | 'OPENING_BALANCE'
  | 'SPEND'
  | 'SPEND_SPLIT'
  | 'INCOME'
  | 'TRANSFER'
  | 'CC_PAYMENT'
  | 'REIMBURSABLE'
  | 'REIMBURSEMENT'
  | 'WRITE_OFF'
  | 'REFUND'
  | 'ASSIGN'
  | 'REVERSAL'
  /**
   * A change in what something is worth, with no money moving.
   *
   * Kept apart from every other kind because it is the one entry that changes
   * net worth without anybody earning or spending anything, and every figure
   * that describes behaviour — spending, income, pacing, Safe-to-Spend — has
   * to keep ignoring it.
   */
  | 'VALUATION'
  /**
   * Money moved from cash into an investment account.
   *
   * A kind of its own rather than a plain TRANSFER, so "how much did I put in
   * this year?" is answerable — but it is added to I6's neutral set alongside
   * transfers, so the rule that a buy is not spending is enforced by the same
   * check that enforces it for moving money between your own accounts.
   */
  | 'INVESTMENT_BUY'
  /** Shares sold, or uninvested cash withdrawn. Also covered by I6. */
  | 'INVESTMENT_SELL'
  /** Money paid out by something you hold. Real income, unlike a valuation. */
  | 'DIVIDEND';

/**
 * Whether the bank has settled this line yet.
 *
 * Pending lines reduce what is safe to spend immediately — the money is gone
 * in every sense that matters to the person spending it — but they are left
 * out of statement reconciliation, because the bank has not finalised them
 * and the amount can still change.
 */
export type Clearance = 'pending' | 'cleared';

export interface Posting {
  id: PostingId;
  entryId: EntryId;
  book: Book;
  accountId: AccountId;
  /** Signed minor units. Positive is a debit, negative is a credit. */
  amount: Minor;
  clearance: Clearance;
  memo: string | null;
  /** Stable ordering for the audit view. */
  sequence: number;
}

export interface JournalEntry {
  id: EntryId;
  kind: EntryKind;
  date: IsoDate;
  /** A complete sentence describing what happened, in plain English. */
  description: string;
  postings: Posting[];
  /** The ingested bank row this came from, when there was one. */
  sourceTransactionId: string | null;
  /** Corrections append a reversal; a posted entry is never edited. */
  reversesEntryId: EntryId | null;
  /** Locked by a completed statement reconciliation. */
  sealed: boolean;
}

/* --- money you fronted --------------------------------------------------- */

/**
 * Money you paid out that somebody else owes you back — a work expense, or
 * your share of a dinner someone else will settle up. It is deliberately not
 * counted as spending, and the repayment is deliberately not counted as
 * income, because neither is true of your own finances.
 */
export interface ReimbursementClaim {
  id: ClaimId;
  /** Who owes you. Shown to the user, so keep it human: "Work", "Sam". */
  counterparty: string;
  kind: 'work_expense' | 'shared_with_friends' | 'insurance' | 'other';
  expectedAmount: Minor;
  settledAmount: Minor;
  status: 'open' | 'partly_settled' | 'settled' | 'written_off';
  openedOn: IsoDate;
  /** The entries that created the claim, and those that settled it. */
  expenseEntryIds: EntryId[];
  settlementEntryIds: EntryId[];
  /**
   * If a claim is written off, the money finally does become spending, and
   * this is the category it lands in.
   */
  writeOffCategoryId: AccountId | null;
}

/* --- matched transfers --------------------------------------------------- */

export type TransferMatchMethod = 'exact_amount' | 'descriptor' | 'manual';

/**
 * Two imported bank rows — money leaving one account and the same money
 * arriving in another — recognised as a single move between your own
 * accounts. The evidence is kept so the match can be explained and undone.
 */
export interface TransferLink {
  id: TransferLinkId;
  /** The single TRANSFER entry that replaced the two rows. */
  entryId: EntryId;
  outflowTransactionId: string;
  inflowTransactionId: string;
  match: {
    /** How far apart the two rows were. The default window is 72 hours. */
    hoursApart: number;
    /** Zero when the amounts matched exactly. */
    amountDelta: Minor;
    /** 0..1. Anything below the threshold is proposed, never applied. */
    confidence: number;
    method: TransferMatchMethod;
  };
  confirmedByUser: boolean;
}

/* --- a readable snapshot for queries and checks -------------------------- */

export interface LedgerSnapshot {
  accounts: ReadonlyMap<AccountId, LedgerAccount>;
  entries: readonly JournalEntry[];
  claims?: readonly ReimbursementClaim[];
}
