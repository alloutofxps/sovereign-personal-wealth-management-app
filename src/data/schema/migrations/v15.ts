/* ===========================================================================
 * VERSION 15 — WHAT A MORTGAGE PAYMENT ACTUALLY DOES
 * ---------------------------------------------------------------------------
 * A mortgage payment is two entirely different things wearing one number.
 * Part of it buys a piece of the house and makes you richer; the rest is rent
 * paid to a bank for the money, and is gone. Consumer finance apps almost
 * universally record one or the other:
 *
 *   · Book the whole payment as spending, and a person paying down a mortgage
 *     for twenty years is shown as having spent everything and built nothing.
 *     Their equity is invisible.
 *   · Book the whole payment against the liability, and the interest vanishes.
 *     Net worth rises by the full payment every month, which is a lie in the
 *     flattering direction — the worst kind.
 *
 * The split is arithmetic, not opinion, and the terms below are what it needs.
 * With them, one payment reduces cash by the whole amount, reduces the debt by
 * the principal, and records the interest as the cost it is.
 *
 * `apr_bp` is not added here. It has existed since v3 and already holds the
 * rate for every card and loan; the brief called it `interest_rate_bp`, and
 * adding a second column for the same fact would create two rates that can
 * disagree — with nothing to say which is right.
 *
 * `loan_payments` is an audit trail rather than state. The journal is what
 * every balance comes from; this records what the split was and why, so a
 * payment made three years ago can be explained rather than only recomputed
 * from terms that may since have changed.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

export const INTEREST_TYPES = ['fixed', 'variable'] as const;

const LOAN_PAYMENTS = `CREATE TABLE IF NOT EXISTS loan_payments (
   id                TEXT PRIMARY KEY,
   account_id        TEXT NOT NULL REFERENCES accounts(id),
   entry_id          TEXT NOT NULL REFERENCES entries(id),
   -- Which payment of the contract this was. 1 is the first.
   payment_number    INTEGER NOT NULL,
   date              TEXT NOT NULL CHECK (date LIKE '____-__-__'),
   total_payment     INTEGER NOT NULL,
   -- The part that bought a piece of the thing.
   principal_amount  INTEGER NOT NULL,
   -- The part that was rent on the money.
   interest_amount   INTEGER NOT NULL,
   escrow_amount     INTEGER NOT NULL DEFAULT 0,
   extra_principal   INTEGER NOT NULL DEFAULT 0,
   remaining_balance INTEGER NOT NULL,
   created_at        TEXT NOT NULL
 );`;

/**
 * What somebody was worth at a point in time.
 *
 * Derived rather than authoritative: every figure here can be recomputed from
 * the journal, and the history engine does exactly that. The table exists so a
 * ten-year timeline does not mean aggregating ten years of postings on every
 * paint, and so a month that has closed keeps the figure it closed at.
 */
const SNAPSHOTS = `CREATE TABLE IF NOT EXISTS net_worth_snapshots (
   id                TEXT PRIMARY KEY,
   date              TEXT NOT NULL UNIQUE CHECK (date LIKE '____-__-__'),
   total_assets      INTEGER NOT NULL,
   total_liabilities INTEGER NOT NULL,
   net_worth         INTEGER NOT NULL,
   created_at        TEXT NOT NULL
 );`;

export function v15Statements(): string[] {
  return [
    LOAN_PAYMENTS,
    // Exactly the shape the schedule reads in: one loan, in payment order.
    `CREATE INDEX IF NOT EXISTS idx_loan_payments_account
       ON loan_payments(account_id, payment_number ASC);`,
    `CREATE INDEX IF NOT EXISTS idx_loan_payments_entry ON loan_payments(entry_id);`,

    SNAPSHOTS,
    `CREATE INDEX IF NOT EXISTS idx_nw_snapshots_date ON net_worth_snapshots(date ASC);`,
  ];
}

export const V15: MigrationStep = {
  to: 15,
  reason:
    'The terms a loan payment has to be split by, what each past payment came to, and ' +
    'what you were worth as the years went along.',
  addColumns: [
    // What was borrowed. Never changes, and is what progress is measured
    // against — "24 of 360 months" means nothing without it.
    { table: 'accounts', column: 'original_principal', declaration: 'INTEGER' },
    { table: 'accounts', column: 'term_months', declaration: 'INTEGER' },
    { table: 'accounts', column: 'start_date', declaration: 'TEXT' },
    // The contractual payment, principal and interest only. Escrow is kept
    // apart because it is not borrowing — it is your money held by the lender
    // to pay bills that are yours.
    { table: 'accounts', column: 'monthly_payment', declaration: 'INTEGER' },
    { table: 'accounts', column: 'escrow_monthly', declaration: 'INTEGER NOT NULL DEFAULT 0' },
    {
      table: 'accounts',
      column: 'interest_type',
      declaration: `TEXT NOT NULL DEFAULT 'fixed' CHECK (interest_type IN ('fixed','variable'))`,
    },
  ],
  statements: v15Statements(),
};
