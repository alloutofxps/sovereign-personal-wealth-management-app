/* The ledger's public surface. Import from '@/core/ledger'. */

export type {
  AccountId,
  Book,
  Clearance,
  ClaimId,
  EntryId,
  EntryKind,
  EnvelopeRole,
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
  Funding,
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
