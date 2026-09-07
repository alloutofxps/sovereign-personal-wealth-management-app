/* ===========================================================================
 * THE LEDGER REPOSITORY
 * ---------------------------------------------------------------------------
 * The only place in the app that writes SQL. Everything above it deals in
 * domain types; everything below it is the worker.
 *
 * Writes go through `saveEntry`, which validates the entry and then commits it
 * as one transaction. A journal entry is meaningless in pieces, so it is
 * written whole or not at all.
 * ======================================================================== */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { minor, type Minor } from '@/core/money';
import {
  LedgerError,
  assertBalanced,
  type AccountId,
  type Book,
  type Clearance,
  type EntryId,
  type EntryKind,
  type IsoDate,
  type JournalEntry,
  type LedgerAccount,
  type LedgerAccountType,
  type Normal,
  type Posting,
  type PostingId,
} from '@/core/ledger';
import { db, runBatch } from '../client';
import { accounts, entries, postings } from '../schema/tables';

/* --- accounts ------------------------------------------------------------ */

type AccountRow = typeof accounts.$inferSelect;

function toAccount(row: AccountRow): LedgerAccount {
  return {
    id: row.id as AccountId,
    book: row.book as Book,
    type: row.type as LedgerAccountType,
    name: row.name,
    normal: row.normal as Normal,
    parentId: (row.parentId as AccountId | null) ?? null,
    status: row.status as LedgerAccount['status'],
    onBudget: row.onBudget === 1,
    liquid: row.liquid === 1,
    paymentEnvelopeId: (row.paymentEnvelopeId as AccountId | null) ?? null,
    envelopeRole: (row.envelopeRole as LedgerAccount['envelopeRole']) ?? null,
    archivedAt: row.archivedAt ?? null,
    colorToken: row.colorToken ?? null,
    icon: row.icon ?? null,
    // v10. Null on the three accounts that predate it, which is read as "one
    // of the originals" rather than guessed at from the type.
    accountClass: (row.class as LedgerAccount['accountClass']) ?? null,
    currency: row.currency ?? null,
    institution: row.institution ?? null,
    depreciationModel: (row.depreciationModel as LedgerAccount['depreciationModel']) ?? null,
    depreciationRateBp: row.depreciationRateBp ?? null,
    salvageValue: row.salvageValue === null ? null : minor(row.salvageValue),
  };
}

export async function listAccounts(): Promise<LedgerAccount[]> {
  const rows = await db.select().from(accounts).orderBy(accounts.sortOrder, accounts.name);
  return rows.map(toAccount);
}

export async function accountsById(): Promise<Map<AccountId, LedgerAccount>> {
  return new Map((await listAccounts()).map((a) => [a.id, a]));
}

/**
 * Insert the chart of accounts. Existing rows are left alone.
 *
 * Accounts reference each other — a credit card points at the pot holding
 * money for its bill — and those references are foreign keys checked as each
 * row goes in. Rather than depending on the list happening to be in a workable
 * order, every account is inserted with its references empty and they are
 * filled in afterwards. The whole thing is one transaction, so the references
 * are never visibly missing.
 */
export async function saveAccounts(list: readonly LedgerAccount[]): Promise<void> {
  if (list.length === 0) return;

  const inserts = list.map((account, index) =>
    db
      .insert(accounts)
      .values({
        id: account.id,
        book: account.book,
        type: account.type,
        name: account.name,
        normal: account.normal,
        status: account.status,
        onBudget: account.onBudget ? 1 : 0,
        liquid: account.liquid ? 1 : 0,
        // Filled in by the second pass below.
        parentId: null,
        paymentEnvelopeId: null,
        envelopeRole: account.envelopeRole,
        sortOrder: index,
      })
      .onConflictDoNothing()
      .toSQL(),
  );

  // Parents are linked in a second pass because an account can name one that
  // has not been inserted yet. Only ever filled in where nothing is there:
  // this runs again whenever the starter chart gains an account, and somebody
  // who has since moved a category into a group of their own must not find it
  // put back on next launch.
  const links = list
    .filter((account) => account.parentId || account.paymentEnvelopeId)
    .map((account) =>
      db
        .update(accounts)
        .set({ parentId: account.parentId, paymentEnvelopeId: account.paymentEnvelopeId })
        .where(
          and(
            eq(accounts.id, account.id),
            isNull(accounts.parentId),
            isNull(accounts.paymentEnvelopeId),
          ),
        )
        .toSQL(),
    );

  await runBatch([...inserts, ...links].map((s) => ({ sql: s.sql, params: s.params })));
}

/* --- one posting, read back ---------------------------------------------- */

type PostingRow = typeof postings.$inferSelect;

/**
 * A stored row as the domain sees it.
 *
 * The only place `clearance: 'reconciled'` is ever produced. The database
 * stores whether a line has gone through and, separately, when it was checked
 * against a statement; the domain wants one answer, and this is where the two
 * become one. Keeping it to a single function is what stops the two ever
 * disagreeing — see migrations/v16.ts.
 */
export function toPosting(row: PostingRow): Posting {
  return {
    id: row.id as PostingId,
    entryId: row.entryId as EntryId,
    book: row.book as Book,
    accountId: row.accountId as AccountId,
    amount: minor(row.amount),
    baseAmount: minor(row.baseAmount),
    fxRateScaled: row.fxRateScaled,
    clearance: row.reconciledAt ? 'reconciled' : (row.clearance as Clearance),
    reconciledAt: row.reconciledAt ?? null,
    memo: row.memo,
    sequence: row.sequence,
  };
}

/* --- entries ------------------------------------------------------------- */

/**
 * Commit one journal entry.
 *
 * The balance check runs again here even though the builders already enforce
 * it, because this is the last point before the data becomes permanent and an
 * entry could have been assembled by something other than a builder.
 */
export async function saveEntry(
  entry: JournalEntry,
  /**
   * Extra statements committed in the same transaction — the claim row that
   * goes with money you fronted, for instance. Either both land or neither
   * does, so a claim can never disagree with the ledger behind it.
   */
  alongside: { sql: string; params: unknown[] }[] = [],
): Promise<void> {
  assertBalanced(entry.id, entry.kind, entry.postings);

  const entryStatement = db
    .insert(entries)
    .values({
      id: entry.id,
      kind: entry.kind,
      date: entry.date,
      description: entry.description,
      sourceTransactionId: entry.sourceTransactionId,
      reversesEntryId: entry.reversesEntryId,
      sealed: entry.sealed ? 1 : 0,
      createdAt: new Date().toISOString(),
      claimId: claimIdOf(entry),
    })
    .toSQL();

  const postingStatements = entry.postings.map((posting) =>
    db
      .insert(postings)
      .values({
        id: posting.id,
        entryId: posting.entryId,
        book: posting.book,
        accountId: posting.accountId,
        amount: posting.amount,
        // 'reconciled' is derived on the way out and never written in. If one
        // arrives here it came from a round trip through the domain, and the
        // fact it stands for lives in `reconciled_at` below.
        clearance: posting.clearance === 'reconciled' ? 'cleared' : posting.clearance,
        reconciledAt: posting.reconciledAt,
        memo: posting.memo,
        sequence: posting.sequence,
        baseAmount: posting.baseAmount,
        fxRateScaled: posting.fxRateScaled,
      })
      .toSQL(),
  );

  await runBatch([
    ...[entryStatement, ...postingStatements].map((s) => ({ sql: s.sql, params: s.params })),
    ...alongside,
  ]);
}

/* ===========================================================================
 * CHANGING WHAT AN ENTRY SAYS, WITHOUT CHANGING WHAT IT COST
 * ---------------------------------------------------------------------------
 * A note was set-once until now: you could write one while recording a payment
 * and never afterwards. That is the wrong way round. Nobody knows on the day
 * that they will want to remember which trip the taxi was for — they find out
 * three months later, looking at a statement and unable to place it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ALLOWED ON A LOCKED ENTRY
 *
 * A statement check locks the money: the amount, the date, the accounts, the
 * lines. This function touches none of them. It writes a memo, and a memo
 * takes part in no total, no balance and no invariant — nothing in this
 * application reads one except to show it to the person who wrote it.
 *
 * Refusing it would also get the timing exactly backwards. The moment somebody
 * is most likely to want to annotate a payment is while they are checking it
 * against a bank statement, which is the moment it becomes locked. A note you
 * cannot add after checking is a note you can almost never add.
 *
 * The amount stays untouchable. That is what the lock is for, and it still is.
 * ======================================================================== */

export interface EntryMetadata {
  /** The person's own words. An empty string clears the note. */
  memo?: string;
}

/**
 * Write a note onto an entry, or clear it.
 *
 * The note rides on the entry's first FINANCIAL line, which is the line every
 * builder writes to say what the money was actually for — the same place
 * `presentEntry` looks for it. Writing it anywhere else would produce a note
 * that saves and never appears.
 */
export async function updateEntryMetadata(
  id: EntryId,
  metadata: EntryMetadata,
): Promise<void> {
  if (metadata.memo === undefined) return;

  const note = metadata.memo.trim();
  const rows = await db
    .select({ id: postings.id })
    .from(postings)
    .where(and(eq(postings.entryId, id), eq(postings.book, 'FINANCIAL')))
    .orderBy(postings.sequence)
    .limit(1);

  const first = rows[0]?.id;
  if (first === undefined) {
    throw new LedgerError(
      'That payment could not be found, so the note has not been saved. Nothing has changed.',
    );
  }

  await runBatch([
    {
      sql: `UPDATE postings SET memo = ? WHERE id = ?`,
      params: [note === '' ? null : note, first],
    },
  ]);
}

/** Claims are attached to an entry through an optional field on the domain
 *  object, so the ledger core stays unaware that claims exist at all. */
function claimIdOf(entry: JournalEntry & { claimId?: string | null }): string | null {
  return entry.claimId ?? null;
}

export interface EntryWithPostings extends JournalEntry {
  createdAt: string;
  /** Set when the entry opened or settled money somebody owes you. */
  claimId?: string | null;
}

/** Most recent entries first, with their lines attached. */
export async function listRecentEntries(limit = 50): Promise<EntryWithPostings[]> {
  const entryRows = await db
    .select()
    .from(entries)
    .orderBy(desc(entries.date), desc(entries.createdAt))
    .limit(limit);

  if (entryRows.length === 0) return [];

  const ids = entryRows.map((e) => e.id);
  const postingRows = await db.select().from(postings).where(inArray(postings.entryId, ids));

  const byEntry = new Map<string, Posting[]>();
  for (const row of postingRows) {
    const list = byEntry.get(row.entryId) ?? [];
    list.push(toPosting(row));
    byEntry.set(row.entryId, list);
  }

  return entryRows.map((row) => ({
    id: row.id as EntryId,
    kind: row.kind as EntryKind,
    date: row.date as IsoDate,
    description: row.description,
    postings: (byEntry.get(row.id) ?? []).sort((a, b) => a.sequence - b.sequence),
    sourceTransactionId: row.sourceTransactionId,
    reversesEntryId: (row.reversesEntryId as EntryId | null) ?? null,
    sealed: row.sealed === 1,
    createdAt: row.createdAt,
  }));
}

/** One entry with its lines, or null. Used before undoing something. */
export async function entryById(id: EntryId): Promise<EntryWithPostings | null> {
  const [row] = await db.select().from(entries).where(eq(entries.id, id)).limit(1);
  if (!row) return null;

  const postingRows = await db.select().from(postings).where(eq(postings.entryId, id));

  return {
    id: row.id as EntryId,
    kind: row.kind as EntryKind,
    date: row.date as IsoDate,
    description: row.description,
    postings: postingRows.map(toPosting).sort((a, b) => a.sequence - b.sequence),
    sourceTransactionId: row.sourceTransactionId,
    reversesEntryId: (row.reversesEntryId as EntryId | null) ?? null,
    sealed: row.sealed === 1,
    claimId: row.claimId,
    createdAt: row.createdAt,
  };
}

/**
 * Has this entry already been undone?
 *
 * Undoing twice would post the mirror image twice and leave every balance
 * wrong by the amount of the original, so it is checked rather than assumed.
 */
export async function isReversed(id: EntryId): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(entries)
    .where(eq(entries.reversesEntryId, id));
  return Number(row?.n ?? 0) > 0;
}

export async function countEntries(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(entries);
  return Number(row?.n ?? 0);
}

/* --- balances ------------------------------------------------------------
 * This is where SQL earns its place. One grouped aggregate replaces a fold
 * over every posting in the journal, and it stays fast as the ledger grows.
 * ---------------------------------------------------------------------- */

export interface AccountBalance {
  accountId: AccountId;
  /** Raw signed total in the account's own currency. */
  raw: Minor;
  /** As a person reads it — a card with money owed shows a positive number. */
  presented: Minor;
  /**
   * The same, in the currency the household reports in.
   *
   * Identical to `presented` for anything already in the base currency. Sum
   * this across accounts, never `presented` — adding dollars to euros produces
   * a number that looks like money and is not.
   */
  presentedBase: Minor;
}

export async function accountBalances(): Promise<Map<AccountId, AccountBalance>> {
  const rows = await db
    .select({
      accountId: postings.accountId,
      total: sql<number>`sum(${postings.amount})`,
      base: sql<number>`sum(${postings.baseAmount})`,
      normal: accounts.normal,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .groupBy(postings.accountId, accounts.normal);

  return new Map(
    rows.map((row) => {
      const raw = minor(Number(row.total));
      const base = minor(Number(row.base));
      const flip = row.normal === 'CREDIT';
      return [
        row.accountId as AccountId,
        {
          accountId: row.accountId as AccountId,
          raw,
          presented: minor(flip ? -raw : raw),
          presentedBase: minor(flip ? -base : base),
        },
      ];
    }),
  );
}

/** Cash you could actually spend today, across on-budget liquid accounts. */
export async function spendableCash(): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.baseAmount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(sql`${accounts.type} = 'ASSET' AND ${accounts.onBudget} = 1 AND ${accounts.liquid} = 1`);
  return minor(Number(row?.total ?? 0));
}

/** Total spending over a date range, net of refunds. */
export async function spendingBetween(from: IsoDate, to: IsoDate): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.baseAmount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(sql`${accounts.type} = 'EXPENSE' AND ${entries.date} >= ${from} AND ${entries.date} <= ${to}`);
  return minor(Number(row?.total ?? 0));
}

/**
 * Spending per day across a range, net of refunds.
 *
 * One grouped aggregate rather than a fold over every posting — this is the
 * query behind the cumulative curve, and it stays fast as the ledger grows.
 */
export async function spendByDay(from: IsoDate, to: IsoDate): Promise<Map<string, Minor>> {
  const rows = await db
    .select({ date: entries.date, total: sql<number>`sum(${postings.baseAmount})` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(sql`${accounts.type} = 'EXPENSE' AND ${entries.date} >= ${from} AND ${entries.date} <= ${to}`)
    .groupBy(entries.date);

  return new Map(rows.map((row) => [row.date, minor(Number(row.total))]));
}

/** Presented balances for every account of a given type. */
export async function balancesByType(
  type: 'LIABILITY' | 'ENVELOPE' | 'ASSET',
): Promise<
  {
    id: AccountId;
    name: string;
    amount: Minor;
    baseAmount: Minor;
    role: string | null;
    /** What kind of thing this is: 'mortgage', 'credit_card', and so on. */
    accountClass: string | null;
  }[]
> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      role: accounts.envelopeRole,
      normal: accounts.normal,
      accountClass: accounts.class,
      total: sql<number>`coalesce(sum(${postings.amount}), 0)`,
      base: sql<number>`coalesce(sum(${postings.baseAmount}), 0)`,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .where(eq(accounts.type, type))
    .groupBy(
      accounts.id,
      accounts.name,
      accounts.envelopeRole,
      accounts.normal,
      accounts.class,
    );

  return rows.map((row) => {
    const raw = Number(row.total);
    const base = Number(row.base);
    const flip = row.normal === 'CREDIT';
    return {
      id: row.id as AccountId,
      name: row.name,
      amount: minor(flip ? -raw : raw),
      // Sum this across accounts, never `amount`.
      baseAmount: minor(flip ? -base : base),
      role: row.role,
      accountClass: row.accountClass ?? null,
    };
  });
}

/**
 * What you were worth at the end of a given day.
 *
 * Used for the calm month-on-month line under net worth. Assets carry debit
 * balances and debts carry credit balances, so adding the two raw totals
 * already subtracts what is owed.
 */
export async function netWorthAsOf(date: IsoDate): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.baseAmount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    // Opening balances count whenever they were typed in. They record what was
    // already there, so treating one as this month's growth would tell someone
    // they had gained their entire savings in a fortnight.
    .where(
      sql`${accounts.type} IN ('ASSET','LIABILITY')
          AND (${entries.date} <= ${date} OR ${entries.kind} = 'OPENING_BALANCE')`,
    );
  return minor(Number(row?.total ?? 0));
}

/**
 * Every asset and liability posting, for drawing the net worth line.
 *
 * Opening balances are dated to the first day anything was recorded rather
 * than to the day somebody typed them. They describe what was already there
 * when the records begin, and leaving them on their own date would put a
 * lifetime of savings into a single month as though it had appeared that
 * fortnight — the same reasoning as `netWorthAsOf`, applied along the whole
 * line instead of at one point.
 */
export async function netWorthPostings(): Promise<
  { date: string; baseAmount: Minor; side: 'ASSET' | 'LIABILITY' }[]
> {
  const rows = await db
    .select({
      date: entries.date,
      kind: entries.kind,
      amount: postings.baseAmount,
      type: accounts.type,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .innerJoin(entries, eq(entries.id, postings.entryId))
    .where(sql`${accounts.type} IN ('ASSET','LIABILITY')`);

  if (rows.length === 0) return [];

  let earliest = rows[0]!.date;
  for (const row of rows) {
    if (row.kind !== 'OPENING_BALANCE' && row.date < earliest) earliest = row.date;
  }

  return rows.map((row) => ({
    date: row.kind === 'OPENING_BALANCE' ? earliest : row.date,
    baseAmount: minor(row.amount),
    side: row.type === 'ASSET' ? ('ASSET' as const) : ('LIABILITY' as const),
  }));
}

/** Everything you own, including money other people owe you. */
export async function totalAssets(): Promise<Minor> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${postings.baseAmount}), 0)` })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(eq(accounts.type, 'ASSET'));
  return minor(Number(row?.total ?? 0));
}

/**
 * What each category typically costs a month, over the trailing window.
 *
 * Used by the runway calculation, where the question is not what you spent
 * last month but what a normal month looks like.
 */
export async function monthlySpendByCategory(
  from: IsoDate,
  to: IsoDate,
  maxMonths: number,
): Promise<{ id: AccountId; name: string; monthly: Minor }[]> {
  // Divide by the months that actually have records in them, not by the width
  // of the window. Three days of spending divided over three months would put
  // a weekly shop at a few pounds a month and quietly triple every runway.
  const [span] = await db
    .select({ earliest: sql<string | null>`min(${entries.date})` })
    .from(entries)
    .where(sql`${entries.date} >= ${from} AND ${entries.date} <= ${to}`);

  const monthsWithData = span?.earliest
    ? Math.min(maxMonths, Math.max(1, monthsBetween(span.earliest, to)))
    : 1;

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      total: sql<number>`coalesce(sum(${postings.baseAmount}), 0)`,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .leftJoin(entries, eq(entries.id, postings.entryId))
    .where(
      sql`${accounts.type} = 'EXPENSE'
          AND (${entries.date} IS NULL OR (${entries.date} >= ${from} AND ${entries.date} <= ${to}))`,
    )
    .groupBy(accounts.id, accounts.name);

  const divisor = monthsWithData;
  return rows
    .map((row) => ({
      id: row.id as AccountId,
      name: row.name,
      monthly: minor(Math.max(0, Math.round(Number(row.total) / divisor))),
    }))
    .filter((row) => row.monthly > 0);
}

/** Whole months spanned by two dates, at least one. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(1, ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 1) - (fm ?? 1)) + 1);
}

export interface DebtTermsRow {
  id: AccountId;
  name: string;
  balance: Minor;
  aprBp: number | null;
  minPayment: number | null;
  creditLimit: number | null;
  dueDay: number | null;
}

/** Borrowing terms for everything you owe, for the payoff planner. */
export async function debtTerms(): Promise<DebtTermsRow[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      aprBp: accounts.aprBp,
      minPayment: accounts.minPayment,
      creditLimit: accounts.creditLimit,
      dueDay: accounts.dueDay,
      total: sql<number>`coalesce(sum(${postings.baseAmount}), 0)`,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .where(eq(accounts.type, 'LIABILITY'))
    .groupBy(
      accounts.id,
      accounts.name,
      accounts.aprBp,
      accounts.minPayment,
      accounts.creditLimit,
      accounts.dueDay,
    );

  return rows.map((row) => ({
    id: row.id as AccountId,
    name: row.name,
    // Liabilities carry credit balances, so negate to read as money owed.
    balance: minor(-Number(row.total)),
    aprBp: row.aprBp,
    minPayment: row.minPayment,
    creditLimit: row.creditLimit,
    dueDay: row.dueDay,
  }));
}

/** Set the borrowing terms on something you owe. */
export async function saveDebtTerms(
  id: AccountId,
  terms: { aprBp: number; minPayment: number; creditLimit: number; dueDay: number },
): Promise<void> {
  const statement = db
    .update(accounts)
    .set({
      aprBp: terms.aprBp,
      minPayment: terms.minPayment,
      // Zero means "not set" rather than "a limit of nothing".
      creditLimit: terms.creditLimit > 0 ? terms.creditLimit : null,
      dueDay: terms.dueDay,
    })
    .where(eq(accounts.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Every table this repository reads, for `useLiveQuery` subscriptions. */
export const LEDGER_TABLES = ['accounts', 'entries', 'postings'] as const;
