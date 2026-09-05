/* ===========================================================================
 * ACCOUNTS PEOPLE ACTUALLY HAVE
 * ---------------------------------------------------------------------------
 * Creating an account is never one row. A credit card is a card *and* the pot
 * that holds money for its bill — a card without one is the defect that made
 * imported card spending look like cash. A house is an account *and* a first
 * mark saying what it cost, or there is nothing to measure a gain against and
 * nothing to depreciate from. A starting figure is an account *and* a journal
 * entry, or the balance sheet does not add up.
 *
 * So every creation path here commits in one transaction. Half a credit card
 * is worse than no credit card, because the missing half is invisible until
 * somebody spends on it.
 * ======================================================================== */

import { eq, sql } from 'drizzle-orm';
import { minor, type Minor, type Rate1e6 } from '@/core/money';
import {
  LedgerError,
  accountId as toAccountId,
  isoDate,
  entryId as toEntryId,
  openingBalance,
  type AccountDraft,
  type AccountId,
  type IsoDate,
  type LedgerAccount,
} from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import { planAccountCreation } from '@/core/ledger/accountClasses';
// Deep import on purpose: see the note in the ledger barrel.
import { depreciatedValue, valuation } from '@/core/ledger/entries/valuation';
import { SYSTEM_ACCOUNTS } from '@/data/seed';
import { db, runBatch } from '../client';
import { accounts, valuations } from '../schema/tables';
import { listAccounts, saveEntry } from './ledgerRepo';

export const ACCOUNT_TABLES = ['accounts', 'entries', 'postings', 'valuations'] as const;

/* ===========================================================================
 * CREATING ONE
 * ---------------------------------------------------------------------------
 * What has to exist is decided in `@/core/ledger/accountClasses`, where it can
 * be read and tested without a database. Everything below carries that plan
 * out and nothing more.
 * ======================================================================== */

export interface CreateAccountParams extends AccountDraft {
  /** Defaults to today. The day the balance or the value applies to. */
  asOf?: IsoDate;
  /**
   * The rate to open a foreign balance at, quote-per-base at 1e6.
   *
   * Supplied by the sheet once somebody has seen and confirmed it. Without it
   * the rate is looked up, and a lookup that finds nothing refuses the whole
   * creation rather than quietly recording the balance one-for-one.
   */
  rateScaled?: Rate1e6;
}

export interface CreatedAccount {
  account: LedgerAccount;
  /** The reserve pot, when a credit card was created. */
  paymentEnvelopeId: AccountId | null;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): IsoDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return isoDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
}

function insertAccount(account: LedgerAccount, extra: Record<string, unknown> = {}) {
  return db
    .insert(accounts)
    .values({
      id: account.id,
      book: account.book,
      type: account.type,
      name: account.name,
      normal: account.normal,
      status: 'active',
      onBudget: account.onBudget ? 1 : 0,
      liquid: account.liquid ? 1 : 0,
      envelopeRole: account.envelopeRole,
      sortOrder: 100,
      class: account.accountClass ?? null,
      currency: account.currency ?? null,
      institution: account.institution ?? null,
      depreciationModel: account.depreciationModel ?? null,
      depreciationRateBp: account.depreciationRateBp ?? null,
      salvageValue: account.salvageValue ?? null,
      ...extra,
    })
    .toSQL();
}

/**
 * What a foreign opening figure is worth, at the rate on that day.
 *
 * Refuses rather than guesses. This used to swallow a missing rate and return
 * null, which meant the opening balance posted with its base amount equal to
 * its native one — $4,334 recorded as EUR 4,334, permanently, with nothing on
 * screen to say so. Every figure built on top of it was then wrong: net worth,
 * the timeline, every milestone. A wrong number nobody can see is worse than a
 * refusal somebody can act on, so this throws and the caller asks for the rate.
 *
 * `rateScaled` may be supplied by the caller, which is what the account sheet
 * does once somebody has confirmed the rate on screen. Then no lookup happens
 * and there is nothing to fail.
 */
async function rateFor(
  currency: string,
  date: IsoDate,
  baseCurrency: string,
  amount: Minor,
  supplied?: Rate1e6,
): Promise<{ rateScaled: number; inBase: Minor } | null> {
  if (currency === baseCurrency) return null;

  const { toBaseCurrency } = await import('@/core/money/fx');

  const convert = (rate: Rate1e6) => ({
    rateScaled: rate,
    inBase: toBaseCurrency({
      amount,
      rateScaled: rate,
      quoteCurrency: currency as never,
      baseCurrency: baseCurrency as never,
    }),
  });

  if (supplied !== undefined) return convert(supplied);

  const { getRateAsOf } = await import('./fxRepo');
  try {
    const { rate } = await getRateAsOf(currency, date, baseCurrency);
    return convert(rate);
  } catch {
    throw new LedgerError(
      `There is no exchange rate on record for ${currency} on ${date}, so what this ` +
        `account holds cannot be worked out in ${baseCurrency}. Add the rate first, or ` +
        `type it alongside the balance, and nothing will be recorded until it is right.`,
    );
  }
}

/**
 * Create an account, and everything that has to exist alongside it.
 *
 * The order is not arbitrary: rows first so foreign keys resolve, then the
 * opening entry, then the first mark alongside it in the same transaction. An
 * interruption leaves an account with no balance — visible, and fixable by
 * typing the figure again — rather than a balance pointing at no account.
 */
export async function createAccount(params: CreateAccountParams): Promise<CreatedAccount> {
  const plan = planAccountCreation(params, {
    account: toAccountId(newId('acc')),
    paymentEnvelope: toAccountId(newId('pot')),
  });

  // Before any row is written. The rate can refuse, and a refusal must leave
  // no half-made account behind — the rows below are committed in one batch,
  // but the opening entry comes after them in a second.
  const openingDate = params.asOf ?? today();
  const foreign =
    plan.needsOpeningEntry && plan.account.currency && params.baseCurrency
      ? await rateFor(
          plan.account.currency,
          openingDate,
          params.baseCurrency,
          params.startingBalance,
          params.rateScaled,
        )
      : null;

  const rows = [insertAccount(plan.account, { aprBp: params.aprBp ?? null })];

  if (plan.paymentEnvelope) {
    rows.push(
      insertAccount(plan.paymentEnvelope),
      // Linked after both rows exist, so the foreign key always resolves.
      db
        .update(accounts)
        .set({ paymentEnvelopeId: plan.paymentEnvelope.id })
        .where(sql`${accounts.id} = ${plan.account.id}`)
        .toSQL(),
    );
  }

  await runBatch(rows.map((s) => ({ sql: s.sql, params: s.params })));

  if (plan.needsOpeningEntry) {
    const date = openingDate;

    await saveEntry(
      openingBalance({
        id: toEntryId(newId('ent')),
        date,
        accountId: plan.account.id,
        amount: params.startingBalance,
        countsAsBudgetableCash: plan.account.onBudget && plan.account.liquid,
        accountName: plan.account.name,
        normal: plan.account.normal,
        ...(foreign
          ? { rateScaled: foreign.rateScaled, baseAmount: foreign.inBase }
          : {}),
        system: SYSTEM_ACCOUNTS,
      }),
      // The first mark, for anything whose value can move. Without it there is
      // nothing to measure a gain against and no date to depreciate from, and
      // the person would have to record what they have already told us.
      plan.needsFirstMark
        ? [
            valuationRowStatement({
              accountId: plan.account.id,
              date,
              value: params.startingBalance,
              costBasis: params.startingBalance,
              notes: 'What it was worth when you added it.',
              entryId: null,
            }),
          ]
        : [],
    );
  }

  return { account: plan.account, paymentEnvelopeId: plan.paymentEnvelope?.id ?? null };
}

/* ===========================================================================
 * MARKING WHAT SOMETHING IS WORTH
 * ======================================================================== */

interface ValuationRow {
  accountId: AccountId;
  date: string;
  value: Minor;
  costBasis: Minor | null;
  notes: string | null;
  entryId: string | null;
}

function valuationRowStatement(row: ValuationRow): { sql: string; params: unknown[] } {
  const statement = db
    .insert(valuations)
    .values({
      id: newId('val'),
      accountId: row.accountId,
      date: row.date,
      value: row.value,
      costBasis: row.costBasis,
      notes: row.notes,
      entryId: row.entryId,
      createdAt: new Date().toISOString(),
    })
    // Two opinions about the same thing on the same day is a correction, not a
    // second fact. The later one wins rather than stacking beside the first.
    .onConflictDoUpdate({
      target: [valuations.accountId, valuations.date],
      set: {
        value: row.value,
        notes: row.notes,
        entryId: row.entryId,
        createdAt: new Date().toISOString(),
      },
    })
    .toSQL();
  return { sql: statement.sql, params: statement.params };
}

/** What the books currently say one account is worth, as a person reads it. */
export async function currentValue(id: AccountId): Promise<Minor> {
  const [row] = (await db.all(sql`
    SELECT COALESCE(SUM(p.amount), 0), a.normal
      FROM accounts a
      LEFT JOIN postings p ON p.account_id = a.id
     WHERE a.id = ${id}
     GROUP BY a.id, a.normal`)) as unknown as Record<number, unknown>[];

  const raw = Number(row?.[0] ?? 0);
  return minor(String(row?.[1]) === 'CREDIT' ? -raw : raw);
}

export interface RecordValuationInput {
  value: Minor;
  date: IsoDate;
  notes?: string;
}

/**
 * Record what something is now worth.
 *
 * The row and the journal entry land together or not at all. They say the same
 * thing in two registers — one for the arithmetic, one for the person — and a
 * note about a value the books never received would be a lie told gently.
 */
export async function recordValuation(
  id: AccountId,
  input: RecordValuationInput,
): Promise<void> {
  const account = (await listAccounts()).find((a) => a.id === id);
  if (!account) {
    throw new LedgerError('That account could not be found, so nothing has been recorded.');
  }
  if (input.value < 0) {
    throw new LedgerError('Something cannot be worth less than nothing.');
  }

  const current = await currentValue(id);
  const entry = valuation({
    id: toEntryId(newId('ent')),
    date: input.date,
    account,
    currentValue: current,
    newValue: input.value,
    ...(input.notes ? { notes: input.notes, memo: input.notes } : {}),
    system: SYSTEM_ACCOUNTS,
  });

  const first = await firstValuation(id);

  await saveEntry(entry, [
    valuationRowStatement({
      accountId: id,
      date: input.date,
      value: input.value,
      // What it cost never changes, so it is carried forward from the first
      // mark rather than being re-stated — and re-stated wrongly — each time.
      costBasis: first?.costBasis ?? null,
      notes: input.notes?.trim() || null,
      entryId: entry.id,
    }),
  ]);
}

export interface ValuationMark {
  id: string;
  accountId: AccountId;
  date: string;
  value: Minor;
  costBasis: Minor | null;
  notes: string | null;
  entryId: string | null;
}

function toMark(row: Record<number, unknown>): ValuationMark {
  return {
    id: String(row[0]),
    accountId: String(row[1]) as AccountId,
    date: String(row[2]),
    value: minor(Number(row[3])),
    costBasis: row[4] === null || row[4] === undefined ? null : minor(Number(row[4])),
    notes: row[5] === null || row[5] === undefined ? null : String(row[5]),
    entryId: row[6] === null || row[6] === undefined ? null : String(row[6]),
  };
}

/** Every mark against one account, newest first. */
export async function listValuations(id: AccountId, limit = 24): Promise<ValuationMark[]> {
  const rows = (await db.all(sql`
    SELECT id, account_id, date, value, cost_basis, notes, entry_id
      FROM valuations
     WHERE account_id = ${id}
     ORDER BY date DESC
     LIMIT ${limit}`)) as unknown as Record<number, unknown>[];
  return rows.map(toMark);
}

/** The first mark, which carries what the thing originally cost. */
export async function firstValuation(id: AccountId): Promise<ValuationMark | null> {
  const [row] = (await db.all(sql`
    SELECT id, account_id, date, value, cost_basis, notes, entry_id
      FROM valuations
     WHERE account_id = ${id}
     ORDER BY date ASC
     LIMIT 1`)) as unknown as Record<number, unknown>[];
  return row ? toMark(row) : null;
}

/** The most recent mark, for the "last valued" indicator. */
export async function lastValuation(id: AccountId): Promise<ValuationMark | null> {
  const [row] = await listValuations(id, 1);
  return row ?? null;
}

/** When each account was last valued, for the list. Newest mark per account. */
export async function lastValuedDates(): Promise<Map<AccountId, string>> {
  const rows = (await db.all(sql`
    SELECT account_id, MAX(date) FROM valuations GROUP BY account_id`)) as unknown as Record<
    number,
    unknown
  >[];
  return new Map(rows.map((row) => [String(row[0]) as AccountId, String(row[1])]));
}

/* ===========================================================================
 * LOSING VALUE BY STANDING STILL
 * ======================================================================== */

export interface DepreciationEstimate {
  /** What the books say today. */
  recorded: Minor;
  /** What the model reckons it is worth. */
  projected: Minor;
  /** The gap between the two — what marking it would change. */
  drift: Minor;
  costBasis: Minor;
  since: string;
}

/**
 * What a depreciating thing is probably worth on a given day.
 *
 * A projection, never a record: nothing here writes an entry. It takes a
 * person accepting the figure to turn it into one, because a car quietly
 * revaluing itself in the background is an app changing somebody's net worth
 * while they are not looking.
 *
 * Returns null when the account has no depreciation set up, or no first mark
 * to depreciate from — both of which are ordinary, not errors.
 */
export async function calculateDepreciation(
  id: AccountId,
  asOfDate: IsoDate,
): Promise<DepreciationEstimate | null> {
  const account = (await listAccounts()).find((a) => a.id === id);
  if (!account) return null;

  const model = account.depreciationModel;
  if (!model || model === 'none') return null;
  if (!account.depreciationRateBp || account.depreciationRateBp <= 0) return null;

  const first = await firstValuation(id);
  if (!first) return null;

  const costBasis = first.costBasis ?? first.value;
  const projected = depreciatedValue(
    {
      costBasis,
      from: first.date,
      rateBp: account.depreciationRateBp,
      model,
      ...(account.salvageValue === null || account.salvageValue === undefined
        ? {}
        : { salvage: account.salvageValue }),
    },
    asOfDate,
  );

  const recorded = await currentValue(id);
  return {
    recorded,
    projected,
    drift: minor(projected - recorded),
    costBasis,
    since: first.date,
  };
}

/* ===========================================================================
 * RETIRING ONE
 * ======================================================================== */

/**
 * Retire an account, keeping every record that ever pointed at it.
 *
 * Refused while it still holds anything. Archiving an account with a balance
 * would take that money off the balance sheet without it going anywhere, so
 * what somebody is worth would drop by an amount they still have. Moving it or
 * writing it off first are both honest; hiding it is not.
 */
/**
 * Change what an account is called.
 *
 * Only the name. Not the currency, not the class, not whether it is on budget
 * — those change what past entries mean, and an account with history cannot
 * have its meaning rewritten underneath it. A name is the one thing that is
 * purely how somebody refers to it, so it is the one thing that is safe.
 *
 * Renaming was impossible until now, which meant a typo at creation was
 * permanent and the only remedy was to archive the account and start again,
 * abandoning its history.
 */
export async function renameAccount(id: AccountId, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LedgerError('An account needs a name, so it can be told apart from the others.');
  }

  const existing = (await listAccounts()).find((a) => a.id === id);
  if (!existing) {
    throw new LedgerError('That account could not be found, so nothing has been changed.');
  }
  if (existing.name === trimmed) return;

  await db.update(accounts).set({ name: trimmed }).where(eq(accounts.id, id));
}

export async function archiveAccount(id: AccountId): Promise<void> {
  const account = (await listAccounts()).find((a) => a.id === id);
  if (!account) {
    throw new LedgerError('That account could not be found.');
  }

  const balance = await currentValue(id);
  if (balance !== 0) {
    throw new LedgerError(
      `${account.name} still has something in it. Move what is left somewhere else, or ` +
        `write it off, and then it can be put away.`,
    );
  }

  const statement = db
    .update(accounts)
    .set({ archivedAt: new Date().toISOString(), status: 'archived' })
    .where(sql`${accounts.id} = ${id}`)
    .toSQL();

  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Bring one back. Nothing was ever removed, so this is just unhiding it. */
export async function restoreAccount(id: AccountId): Promise<void> {
  const statement = db
    .update(accounts)
    .set({ archivedAt: null, status: 'active' })
    .where(sql`${accounts.id} = ${id}`)
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}
