/* ===========================================================================
 * LOANS
 * ---------------------------------------------------------------------------
 * The balance of a loan comes from the journal, like every other balance. What
 * lives here is everything the journal cannot tell you: the rate, the term,
 * the contractual payment, and what the lender holds each month for tax and
 * insurance. Those are the terms of a contract, not the consequences of one,
 * and they are the only things a loan needs beyond its balance.
 *
 * `loan_payments` is written alongside each entry in the same transaction. It
 * is an audit trail, not state — every figure in it can be recomputed from the
 * terms — but recomputing a payment made three years ago gives the split those
 * terms imply *today*, and rates change. Recording what the split actually was
 * is the difference between explaining a payment and re-deriving it.
 * ======================================================================== */

import { and, asc, eq, sql } from 'drizzle-orm';
import { basisPoints, minor, type BasisPoints, type Minor } from '@/core/money';
import {
  LedgerError,
  entryId as toEntryId,
  isoDate,
  type AccountId,
  type IsoDate,
  type LedgerAccount,
} from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import { loanPayment } from '@/core/ledger/entries/loanPayment';
import {
  calculateNextLoanSplit,
  type LoanTerms,
  type PaymentSplit,
} from '@/core/debt/amortization';
import { SYSTEM_ACCOUNTS } from '@/data/seed';
import { db } from '../client';
import { accounts, loanPayments } from '../schema/tables';
import { listAccounts, saveEntry } from './ledgerRepo';

export const LOAN_TABLES = ['accounts', 'entries', 'postings', 'loan_payments'] as const;

/**
 * The account classes that amortise.
 *
 * A credit card is deliberately not one of them. Revolving debt has no term
 * and no contractual payment, so it has no schedule to draw — showing one
 * would mean inventing a payoff date out of a minimum payment somebody is
 * under no obligation to keep making.
 */
const AMORTIZING = new Set(['mortgage', 'loan']);

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): IsoDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return isoDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
}

export interface Loan {
  account: LedgerAccount;
  /** What is still owed, as a positive amount. */
  balance: Minor;
  originalPrincipal: Minor | null;
  termMonths: number | null;
  startDate: string | null;
  monthlyPayment: Minor | null;
  escrowMonthly: Minor;
  aprBp: BasisPoints;
  interestType: 'fixed' | 'variable';
  /** How many payments have been recorded against it here. */
  paymentsMade: number;
  /** True once there is enough to work out a schedule. */
  hasTerms: boolean;
}

/**
 * Every loan, with its terms and what is still owed.
 *
 * The balance is summed on `base_amount`, so a foreign-currency loan is
 * reported in the household's currency like everything else on the balance
 * sheet — even though a payment against it has to be made in its own.
 */
export async function listLoans(): Promise<Loan[]> {
  const all = await listAccounts();
  const candidates = all.filter(
    (a) => a.type === 'LIABILITY' && !a.archivedAt && AMORTIZING.has(a.accountClass ?? ''),
  );
  if (candidates.length === 0) return [];

  const rows = (await db.all(sql`
    SELECT a.id,
           a.original_principal, a.term_months, a.start_date, a.monthly_payment,
           a.escrow_monthly, a.apr_bp, a.interest_type,
           coalesce((SELECT sum(p.base_amount) FROM postings p
                      WHERE p.account_id = a.id), 0) AS owed,
           coalesce((SELECT count(*) FROM loan_payments lp
                      WHERE lp.account_id = a.id), 0)  AS payments
      FROM accounts a
     WHERE a.type = 'LIABILITY'
  `)) as unknown[][];

  const byId = new Map(rows.map((r) => [String(r[0]), r]));

  return candidates.map((account) => {
    const row = byId.get(account.id);
    const monthly = numberOrNull(row?.[4]);

    return {
      account,
      // Liabilities carry credit balances, so negate to read as money owed.
      balance: minor(-Number(row?.[8] ?? 0)),
      originalPrincipal: nullableMinor(row?.[1]),
      termMonths: numberOrNull(row?.[2]),
      startDate: (row?.[3] as string | null) ?? null,
      monthlyPayment: monthly === null ? null : minor(monthly),
      escrowMonthly: minor(Number(row?.[5] ?? 0)),
      aprBp: basisPoints(Number(row?.[6] ?? 0)),
      interestType: (row?.[7] as 'fixed' | 'variable') ?? 'fixed',
      paymentsMade: Number(row?.[9] ?? 0),
      hasTerms: monthly !== null && monthly > 0,
    };
  });
}

export async function getLoan(accountId: AccountId): Promise<Loan | null> {
  return (await listLoans()).find((l) => l.account.id === accountId) ?? null;
}

/** The terms in the shape the amortisation core wants. */
export function termsOf(loan: Loan): LoanTerms {
  return {
    currentBalance: loan.balance,
    annualRateBp: loan.aprBp,
    monthlyPayment: loan.monthlyPayment ?? minor(0),
    escrowMonthly: loan.escrowMonthly,
    paymentsMade: loan.paymentsMade,
    ...(loan.termMonths === null ? {} : { termMonths: loan.termMonths }),
    ...(loan.startDate === null ? {} : { nextPaymentDate: loan.startDate }),
  };
}

/* ===========================================================================
 * SETTING THE TERMS
 * ======================================================================== */

export interface LoanTermsInput {
  accountId: AccountId;
  originalPrincipal?: Minor | null;
  termMonths?: number | null;
  startDate?: string | null;
  monthlyPayment?: Minor | null;
  escrowMonthly?: Minor;
  aprBp?: BasisPoints;
  interestType?: 'fixed' | 'variable';
}

export async function saveLoanTerms(input: LoanTermsInput): Promise<void> {
  const set: Record<string, unknown> = {};
  if (input.originalPrincipal !== undefined) set['originalPrincipal'] = input.originalPrincipal;
  if (input.termMonths !== undefined) set['termMonths'] = input.termMonths;
  if (input.startDate !== undefined) set['startDate'] = input.startDate;
  if (input.monthlyPayment !== undefined) set['monthlyPayment'] = input.monthlyPayment;
  if (input.escrowMonthly !== undefined) set['escrowMonthly'] = input.escrowMonthly;
  if (input.aprBp !== undefined) set['aprBp'] = input.aprBp;
  if (input.interestType !== undefined) set['interestType'] = input.interestType;

  if (Object.keys(set).length === 0) return;
  await db.update(accounts).set(set).where(eq(accounts.id, input.accountId));
}

/* ===========================================================================
 * RECORDING A PAYMENT
 * ======================================================================== */

export interface RecordPaymentInput {
  loanId: AccountId;
  fundingAccountId: AccountId;
  envelopeId?: AccountId;
  date?: string;
  /**
   * Anything paid over the contractual amount.
   *
   * All of it goes against the debt. Interest is charged on the balance at the
   * start of the month, so an extra payment does not change this month's
   * interest — it changes every month after.
   */
  extraPrincipal?: Minor;
  /**
   * The split, when the statement disagrees with the arithmetic.
   *
   * Lenders round differently, and a bank statement is the fact — so when one
   * is in front of somebody, what it says wins over what this would compute.
   */
  override?: { principal: Minor; interest: Minor; escrow?: Minor };
}

export interface RecordedPayment {
  split: PaymentSplit;
  paymentNumber: number;
  remainingBalance: Minor;
}

export async function recordLoanPayment(input: RecordPaymentInput): Promise<RecordedPayment> {
  const loan = await getLoan(input.loanId);
  if (!loan) {
    throw new LedgerError('That loan could not be found.');
  }
  if (loan.balance <= 0) {
    throw new LedgerError(`${loan.account.name} is already paid off, so there is nothing to pay.`);
  }

  const funding = (await listAccounts()).find((a) => a.id === input.fundingAccountId);
  if (!funding) {
    throw new LedgerError('That account could not be found.');
  }

  const extra = minor(Math.max(0, input.extraPrincipal ?? 0));
  const date = isoDate(input.date ?? today());

  const split: PaymentSplit = input.override
    ? {
        principal: input.override.principal,
        interest: input.override.interest,
        escrow: input.override.escrow ?? loan.escrowMonthly,
        totalPayment: minor(
          input.override.principal +
            extra +
            input.override.interest +
            (input.override.escrow ?? loan.escrowMonthly),
        ),
        remainingBalance: minor(
          Math.max(0, loan.balance - input.override.principal - extra),
        ),
        isFinal: loan.balance - input.override.principal - extra <= 0,
      }
    : calculateNextLoanSplit(termsOf(loan), extra);

  if (!input.override && !loan.hasTerms) {
    throw new LedgerError(
      `${loan.account.name} has no monthly payment set, so its payment cannot be split. ` +
        `Add the terms first, or type the amounts from your statement.`,
    );
  }

  const entry = loanPayment({
    id: toEntryId(newId('e')),
    date,
    fundingAccount: funding,
    loanAccount: loan.account,
    principal: minor(Math.max(0, split.principal - extra)),
    interest: split.interest,
    escrow: split.escrow,
    extraPrincipal: extra,
    ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
    system: SYSTEM_ACCOUNTS,
  });

  const paymentNumber = loan.paymentsMade + 1;

  const audit = db
    .insert(loanPayments)
    .values({
      id: newId('lp'),
      accountId: loan.account.id,
      entryId: entry.id,
      paymentNumber,
      date,
      totalPayment: split.totalPayment,
      principalAmount: split.principal,
      interestAmount: split.interest,
      escrowAmount: split.escrow,
      extraPrincipal: extra,
      remainingBalance: split.remainingBalance,
      createdAt: new Date().toISOString(),
    })
    .toSQL();

  // One transaction: a payment that reached the journal but not the audit
  // trail would be a payment nobody could explain afterwards.
  await saveEntry(entry, [{ sql: audit.sql, params: audit.params }]);

  return { split, paymentNumber, remainingBalance: split.remainingBalance };
}

/* ===========================================================================
 * WHAT HAS BEEN PAID
 * ======================================================================== */

export interface LoanPaymentRow {
  id: string;
  entryId: string;
  paymentNumber: number;
  date: string;
  totalPayment: Minor;
  principalAmount: Minor;
  interestAmount: Minor;
  escrowAmount: Minor;
  extraPrincipal: Minor;
  remainingBalance: Minor;
}

export async function listLoanPayments(
  accountId: AccountId,
  limit = 120,
): Promise<LoanPaymentRow[]> {
  const rows = await db
    .select()
    .from(loanPayments)
    .where(eq(loanPayments.accountId, accountId))
    .orderBy(asc(loanPayments.paymentNumber))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    entryId: row.entryId,
    paymentNumber: row.paymentNumber,
    date: row.date,
    totalPayment: minor(row.totalPayment),
    principalAmount: minor(row.principalAmount),
    interestAmount: minor(row.interestAmount),
    escrowAmount: minor(row.escrowAmount),
    extraPrincipal: minor(row.extraPrincipal),
    remainingBalance: minor(row.remainingBalance),
  }));
}

/** What every payment ever recorded on this loan came to, split in two. */
export async function paidToDate(
  accountId: AccountId,
): Promise<{ principal: Minor; interest: Minor; escrow: Minor; payments: number }> {
  const rows = await db
    .select({
      principal: sql<number>`coalesce(sum(${loanPayments.principalAmount}), 0)`,
      interest: sql<number>`coalesce(sum(${loanPayments.interestAmount}), 0)`,
      escrow: sql<number>`coalesce(sum(${loanPayments.escrowAmount}), 0)`,
      payments: sql<number>`count(*)`,
    })
    .from(loanPayments)
    .where(and(eq(loanPayments.accountId, accountId)));

  const row = rows[0];
  return {
    principal: minor(Number(row?.principal ?? 0)),
    interest: minor(Number(row?.interest ?? 0)),
    escrow: minor(Number(row?.escrow ?? 0)),
    payments: Number(row?.payments ?? 0),
  };
}

/* --- reading rows -------------------------------------------------------- */

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableMinor(value: unknown): Minor | null {
  const n = numberOrNull(value);
  return n === null ? null : minor(n);
}
