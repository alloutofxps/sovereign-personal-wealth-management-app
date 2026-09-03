/* ===========================================================================
 * THINGS A PERSON CAN DO WITH THEIR MONEY
 * ---------------------------------------------------------------------------
 * Each of these takes what somebody entered on a screen, builds the journal
 * entry for it, and commits it. The double entry happens here; nothing above
 * this file needs to know a ledger exists.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import {
  assign,
  cardPayment,
  income as incomeEntry,
  claimId as makeClaimId,
  entryId,
  isoDate,
  reimbursable,
  reimbursement,
  spend,
  writeOff,
  type AccountId,
  type Funding,
  type JournalEntry,
} from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import { saveEntry } from '@/data/repositories/ledgerRepo';
import {
  openClaim,
  settleClaimStatement,
  writeOffStatement,
  type Claim,
  type ClaimKind,
} from '@/data/repositories/claimsRepo';
import { markReviewedStatement, type StagedRow } from '@/data/repositories/stagingRepo';
import { ACCOUNT_IDS, SYSTEM_ACCOUNTS } from '@/data/seed';

const today = () => isoDate(toIsoDate(new Date()));
const newEntry = () => ({ id: entryId(crypto.randomUUID()), date: today() });

/** Attach a claim to an entry on its way to storage. */
type WithClaim = JournalEntry & { claimId?: string };

/* --- ordinary spending --------------------------------------------------- */

export interface RecordSpendInput {
  amount: Minor;
  categoryId: AccountId;
  envelopeId: AccountId;
  categoryName: string;
  funding: Funding;
  payee?: string;
}

export async function recordSpend(input: RecordSpendInput): Promise<void> {
  await saveEntry(
    spend({
      ...newEntry(),
      amount: input.amount,
      categoryId: input.categoryId,
      envelopeId: input.envelopeId,
      funding: input.funding,
      ...(input.payee ? { payee: input.payee } : {}),
      categoryName: input.categoryName,
      system: SYSTEM_ACCOUNTS,
    }),
  );
}

/**
 * Confirming a row from the review queue.
 *
 * The journal entry and the queue update commit together, so a row can never
 * show as reviewed without the entry existing — and confirming the same row
 * twice cannot produce two entries.
 */
export async function confirmStagedRow(
  row: StagedRow,
  choice: { categoryId: AccountId; envelopeId: AccountId; categoryName: string },
): Promise<void> {
  const id = entryId(crypto.randomUUID());
  const date = isoDate(row.date);
  const outgoing = row.amount < 0;

  const entry = outgoing
    ? spend({
        id,
        date,
        amount: minor(-row.amount),
        categoryId: choice.categoryId,
        envelopeId: choice.envelopeId,
        funding: { via: 'cash', accountId: row.accountId },
        payee: row.description,
        categoryName: choice.categoryName,
        system: SYSTEM_ACCOUNTS,
      })
    : incomeEntry({
        id,
        date,
        amount: row.amount,
        sourceId: ACCOUNT_IDS.otherIncome,
        depositAccountId: row.accountId,
        countsAsBudgetableCash: true,
        payer: row.description,
        system: SYSTEM_ACCOUNTS,
      });

  const update = markReviewedStatement(row.id, id);
  await saveEntry(entry, [{ sql: update.sql, params: update.params }]);
}

/* --- money you fronted for somebody else --------------------------------- */

export interface RecordFrontedInput {
  amount: Minor;
  funding: Funding;
  /** Who will pay you back. */
  counterparty: string;
  kind: ClaimKind;
  note?: string;
}

/**
 * Something you paid for that will come back to you.
 *
 * No expense is recorded at all — the debit goes to the register of money you
 * are owed. Your spending figures and the pacing curve do not move, because
 * this was never your spending.
 */
export async function recordFronted(input: RecordFrontedInput): Promise<void> {
  const claim = makeClaimId(crypto.randomUUID());
  const base = newEntry();

  const entry: WithClaim = {
    ...reimbursable({
      ...base,
      amount: input.amount,
      funding: input.funding,
      counterparty: input.counterparty,
      system: SYSTEM_ACCOUNTS,
    }),
    claimId: claim,
  };

  // The claim row is written first so the entry's reference always resolves.
  await openClaim({
    id: claim,
    counterparty: input.counterparty,
    kind: input.kind,
    expected: input.amount,
    openedOn: base.date,
    ...(input.note ? { note: input.note } : {}),
  });

  await saveEntry(entry);
}

/**
 * Being paid back. Not income — you are only getting your own money returned,
 * so counting it as earnings would overstate what you make.
 *
 * The ledger entry and the claim update commit together, so a claim can never
 * show as settled without the money having landed in the ledger.
 */
export async function recordPayback(claim: Claim, amount: Minor): Promise<void> {
  const base = newEntry();

  const entry: WithClaim = {
    ...reimbursement({
      ...base,
      amount,
      depositAccountId: ACCOUNT_IDS.everyday,
      counterparty: claim.counterparty,
      system: SYSTEM_ACCOUNTS,
    }),
    claimId: claim.id,
  };

  const update = settleClaimStatement(claim, amount);
  await saveEntry(entry, [{ sql: update.sql, params: update.params }]);
}

/**
 * Accepting that money you fronted is not coming back.
 *
 * Only at this point does it become your spending, and it lands in the month
 * you accept it rather than the month you paid it — backdating would rewrite a
 * month you have already looked at and closed.
 */
export async function writeOffClaim(
  claim: Claim,
  categoryId: AccountId,
  envelopeId: AccountId,
  categoryName: string,
): Promise<void> {
  const base = newEntry();

  const entry: WithClaim = {
    ...writeOff({
      ...base,
      amount: claim.outstanding,
      categoryId,
      categoryName,
      envelopeId,
      counterparty: claim.counterparty,
      system: SYSTEM_ACCOUNTS,
    }),
    claimId: claim.id,
  };

  const update = writeOffStatement(claim);
  await saveEntry(entry, [{ sql: update.sql, params: update.params }]);
}

/* --- paying a card bill -------------------------------------------------- */

/**
 * Cash goes down and the debt goes down by the same amount. It touches no
 * expense account, so this cannot change what a period shows as spending, and
 * it cannot change what is safe to spend either — the money was already held
 * back the moment the card was used.
 */
export async function recordCardPayment(amount: Minor, cardName = 'credit card'): Promise<void> {
  await saveEntry(
    cardPayment({
      ...newEntry(),
      amount,
      cardAccountId: ACCOUNT_IDS.card,
      cardName,
      paymentEnvelopeId: ACCOUNT_IDS.potCardBill,
      fromAccountId: ACCOUNT_IDS.everyday,
      fromName: 'your everyday account',
      system: SYSTEM_ACCOUNTS,
    }),
  );
}

/* --- putting money into a pot -------------------------------------------- */

/** Give money a job. Nothing leaves the bank; it is simply spoken for. */
export async function putIntoPot(
  envelopeId: AccountId,
  envelopeName: string,
  amount: Minor,
): Promise<void> {
  await saveEntry(
    assign({
      ...newEntry(),
      envelopeId,
      envelopeName,
      amount,
      system: SYSTEM_ACCOUNTS,
    }),
  );
}

/** Take money back out of a pot and return it to the unassigned pile. */
export async function takeOutOfPot(
  envelopeId: AccountId,
  envelopeName: string,
  amount: Minor,
): Promise<void> {
  const base = newEntry();
  const forward = assign({
    ...base,
    envelopeId,
    envelopeName,
    amount,
    system: SYSTEM_ACCOUNTS,
  });

  // The same two lines, the other way round.
  await saveEntry({
    ...forward,
    description: `Took money back out of ${envelopeName}.`,
    postings: forward.postings.map((posting) => ({ ...posting, amount: minor(-posting.amount) })),
  });
}
