/* The ledger's public surface. Import from '@/core/ledger'. */

export type {
  AccountClass,
  AccountId,
  Book,
  Clearance,
  ClaimId,
  DepreciationModel,
  EntryId,
  EntryKind,
  EnvelopeRole,
  Funding,
  IsoDate,
  JournalEntry,
  LedgerAccount,
  LedgerAccountType,
  LedgerSnapshot,
  Normal,
  Posting,
  PostingId,
  ReimbursementClaim,
  SystemAccounts,
  TransferLink,
  TransferLinkId,
  TransferMatchMethod,
} from './types';
export {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  accountId,
  claimId,
  entryId,
  isoDate,
} from './types';

export type { EntryBase, PostingSpec } from './entries/common';
export {
  assertBalanced,
  assertNotReconciled,
  buildEntry,
  clearanceOf,
  credit,
  debit,
  isReconciled,
  requirePositiveAmount,
  reverseEntry,
} from './entries/common';

export type {
  AssignParams,
  CardPaymentParams,
  IncomeParams,
  OpeningBalanceParams,
  RefundParams,
  ReimbursableParams,
  ReimbursementParams,
  SpendParams,
  TransferParams,
  WriteOffParams,
} from './entries/builders';
export {
  assign,
  cardPayment,
  income,
  openingBalance,
  refund,
  reimbursable,
  reimbursement,
  spend,
  transfer,
  writeOff,
} from './entries/builders';

export { assertFundingMatchesAccount, fundingFor } from './funding';

// Everything about what kind of thing an account is — the profiles, the group
// titles, the creation planner — is reached only from the balance sheet and
// the sheets hanging off it, all of which are lazily loaded. A re-export here
// would put every one of those sentences in front of somebody who has only
// opened the app to see what is safe to spend. Import from './accountClasses'.
export type {
  AccountDraft,
  AccountGroup,
  AccountPlan,
  ClassProfile,
} from './accountClasses';

// The trade builders are deliberately NOT re-exported here. The dashboard
// pulls this barrel in on the first paint, and a re-export is enough of an
// edge to drag buys, sells and dividends along with it — in front of everybody
// who opens the app, including the many people who hold no investments at all.
// Import them from './entries/trade' directly, from lazily loaded code only.

// Deliberately not re-exported alongside the trade builders: see the note
// above. Cross-currency work is reached from lazily loaded code only.
export type { TransferCrossCurrencyParams } from './entries/transferCrossCurrency';

// Marking something to what it is worth now is done from the balance sheet and
// from the investments register, both lazily loaded. Same reasoning as the
// trade builders above. Import from './entries/valuation'.
export type { DepreciationTerms, ValuationParams } from './entries/valuation';

// Not re-exported, same reasoning as the trade builders: splitting a payment
// happens in the split editor, and filing a bank row happens in the review
// queue, both lazily loaded. Import from './entries/spendSplit' and
// './entries/fromStatement'.
export type { SplitLine, SpendSplitParams } from './entries/spendSplit';

export type {
  CardCredit,
  CardCreditKind,
  StatementFiling,
  StatementLine,
} from './entries/fromStatement';


export type { BalanceFilter } from './balances';
export {
  allRawBalances,
  baseBalance,
  bookTotal,
  eachPosting,
  liquidCash,
  netWorth,
  presentedBalance,
  rawBalance,
  totalByType,
  totalIncome,
  totalSpending,
  totalWhere,
} from './balances';

// The invariant engine is not re-exported, and that is not only about size.
// Nothing in the running app checks invariants — entries are validated as they
// are built and again as they are saved, which is where a bad entry has to be
// stopped. The engine is the second opinion the test suite holds the ledger to,
// and it belongs in the tests rather than in every first paint. Import from
// './invariants'.
export type { InvariantCode, InvariantViolation } from './invariants';
