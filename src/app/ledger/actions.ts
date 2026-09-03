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
  entryFromStatementLine,
  claimId as makeClaimId,
  entryId,
  fundingFor,
  isoDate,
  reimbursable,
  reimbursement,
  reverseEntry,
  spend,
  spendSplit,
  writeOff,
  type AccountId,
  type CardCredit,
  type EntryId,
  type Funding,
  type IsoDate,
  type JournalEntry,
  type SplitLine,
} from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import {
  accountsById,
  entryById,
  isReversed,
  saveEntry,
} from '@/data/repositories/ledgerRepo';
import {
  openClaim,
  settleClaimStatement,
  writeOffStatement,
  type Claim,
  type ClaimKind,
} from '@/data/repositories/claimsRepo';
import {
  markReviewedStatement,
  returnToQueueStatement,
  type StagedRow,
} from '@/data/repositories/stagingRepo';
import { ACCOUNT_IDS, SYSTEM_ACCOUNTS } from '@/data/seed';

const today = () => isoDate(toIsoDate(new Date()));

/**
 * A fresh id and a date.
 *
 * The date is now the caller's to choose. It used to be hardcoded to today,
 * which meant there was no way at all to record yesterday's coffee — you
 * either entered it against the wrong day or did not enter it.
 */
const newEntry = (date?: IsoDate) => ({ id: entryId(crypto.randomUUID()), date: date ?? today() });

/**
 * Work out how a payment from this account is funded.
 *
 * Every path that spends money goes through here, so the card-versus-cash
 * decision is made once, from the account itself, rather than assumed
 * separately at each call site.
 */
async function fundedFrom(accountId: AccountId): Promise<Funding> {
  const account = (await accountsById()).get(accountId);
  if (!account) {
    throw new Error('That account could not be found, so nothing has been recorded.');
  }
  return fundingFor(account);
}

/** Attach a claim to an entry on its way to storage. */
type WithClaim = JournalEntry & { claimId?: string };

/* --- ordinary spending --------------------------------------------------- */

export interface RecordSpendInput {
  amount: Minor;
  categoryId: AccountId;
  envelopeId: AccountId;
  categoryName: string;
  /** The account or card it was paid from. How it is funded follows from it. */
  paidFrom: AccountId;
  payee?: string;
  /** Defaults to today. */
  date?: IsoDate;
  /** The person's own note about it. */
  memo?: string;
}

/** Returns the new entry's id, so the caller can offer to undo it. */
export async function recordSpend(input: RecordSpendInput): Promise<EntryId> {
  const entry = spend({
    ...newEntry(input.date),
    amount: input.amount,
    categoryId: input.categoryId,
    envelopeId: input.envelopeId,
    funding: await fundedFrom(input.paidFrom),
    ...(input.payee ? { payee: input.payee } : {}),
    ...(input.memo ? { memo: input.memo } : {}),
    categoryName: input.categoryName,
    system: SYSTEM_ACCOUNTS,
  });
  await saveEntry(entry);
  return entry.id;
}

export interface RecordSplitInput {
  lines: SplitLine[];
  paidFrom: AccountId;
  payee?: string;
  date?: IsoDate;
  memo?: string;
}

/**
 * One payment across several categories.
 *
 * The lines are the person's own allocation — the editor will not let them
 * submit until the parts add up to the whole — so nothing is inferred here.
 */
export async function recordSplitSpend(input: RecordSplitInput): Promise<EntryId> {
  const entry = spendSplit({
    ...newEntry(input.date),
    lines: input.lines,
    funding: await fundedFrom(input.paidFrom),
    ...(input.payee ? { payee: input.payee } : {}),
    ...(input.memo ? { memo: input.memo } : {}),
    system: SYSTEM_ACCOUNTS,
  });
  await saveEntry(entry);
  return entry.id;
}

/**
 * Confirming a row from the review queue.
 *
 * The journal entry and the queue update commit together, so a row can never
 * show as reviewed without the entry existing — and confirming the same row
 * twice cannot produce two entries.
 */
export interface StagedChoice {
  categoryId: AccountId;
  envelopeId: AccountId;
  categoryName: string;
  /** Set when the person split this row across several categories. */
  split?: SplitLine[];
  /** Required for a positive row on a card statement. */
  cardCredit?: CardCredit;
}

export async function confirmStagedRow(
  row: StagedRow,
  choice: StagedChoice,
): Promise<EntryId> {
  const account = (await accountsById()).get(row.accountId);
  if (!account) {
    throw new Error('The account that row came from could not be found.');
  }

  const id = entryId(crypto.randomUUID());
  const date = isoDate(row.date);

  // A split from the queue takes the same path as a split typed by hand, so
  // the two cannot drift apart in how they post.
  const entry =
    choice.split && choice.split.length > 1 && row.amount < 0
      ? spendSplit({
          id,
          date,
          lines: choice.split,
          funding: fundingFor(account),
          payee: row.description,
          system: SYSTEM_ACCOUNTS,
        })
      : entryFromStatementLine({
          id,
          line: { date, amount: row.amount, description: row.description },
          account,
          category: choice,
          incomeAccountId: ACCOUNT_IDS.otherIncome,
          ...(choice.cardCredit ? { cardCredit: choice.cardCredit } : {}),
          system: SYSTEM_ACCOUNTS,
        });

  const update = markReviewedStatement(row.id, entry.id);
  await saveEntry(entry, [{ sql: update.sql, params: update.params }]);
  return entry.id;
}

/* --- undoing something --------------------------------------------------- */

/**
 * Undo an entry by posting its mirror image.
 *
 * Nothing is edited and nothing is deleted: a correction is two entries that
 * cancel out, and both stay visible. That is what makes the history worth
 * trusting — a figure that changed can always be explained.
 *
 * A row that came from a statement goes back to the review queue, because
 * undoing the filing should leave it waiting rather than losing it.
 */
export async function voidEntry(id: EntryId, reason?: string): Promise<void> {
  const original = await entryById(id);
  if (!original) {
    throw new Error('That payment could not be found, so nothing has been changed.');
  }
  if (original.kind === 'REVERSAL') {
    throw new Error(
      'That entry is itself a correction. Undoing it would put back what it undid, ' +
        'so record the payment again instead.',
    );
  }
  if (await isReversed(id)) {
    throw new Error('That has already been undone, so nothing has been changed.');
  }
  if (original.claimId) {
    throw new Error(
      'That one is tied to money somebody owes you. Settle it or write it off from ' +
        'the claim itself, so the two cannot end up disagreeing.',
    );
  }

  const reversal = reverseEntry(
    original,
    entryId(crypto.randomUUID()),
    today(),
    reason ?? `Undid: ${original.description}`,
  );

  const back = returnToQueueStatement(id);
  await saveEntry(reversal, [{ sql: back.sql, params: back.params }]);
}

/* --- money you fronted for somebody else --------------------------------- */

export interface RecordFrontedInput {
  amount: Minor;
  /** The account or card it was paid from. */
  paidFrom: AccountId;
  /** Who will pay you back. */
  counterparty: string;
  kind: ClaimKind;
  note?: string;
  /** Defaults to today. */
  date?: IsoDate;
  /** The person's own note about it. */
  memo?: string;
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
  const base = newEntry(input.date);

  const entry: WithClaim = {
    ...reimbursable({
      ...base,
      amount: input.amount,
      funding: await fundedFrom(input.paidFrom),
      ...(input.memo ? { memo: input.memo } : {}),
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
