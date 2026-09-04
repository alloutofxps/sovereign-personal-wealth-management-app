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
  buildEntry,
  credit,
  debit,
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

export type {
  AccountDraft,
  AccountGroup,
  AccountPlan,
  ClassProfile,
} from './accountClasses';
export {
  CLASS_PROFILES,
  GROUP_HINTS,
  GROUP_TITLES,
  groupOf,
  isRevaluable,
  planAccountCreation,
} from './accountClasses';

export type { DepreciationTerms, ValuationParams } from './entries/valuation';
export { depreciatedValue, describeDepreciation, valuation } from './entries/valuation';

export type { SplitLine, SpendSplitParams } from './entries/spendSplit';
export { spendSplit, splitTotal } from './entries/spendSplit';

export type {
  CardCredit,
  CardCreditKind,
  StatementFiling,
  StatementLine,
} from './entries/fromStatement';
export { entryFromStatementLine, needsCardCreditChoice } from './entries/fromStatement';

export type { BalanceFilter } from './balances';
export {
  allRawBalances,
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

export type { InvariantCode, InvariantViolation } from './invariants';
export {
  INVARIANTS,
  assertInvariants,
  booksBalance,
  checkInvariant,
  checkInvariants,
} from './invariants';
