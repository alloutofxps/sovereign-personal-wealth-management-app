/* ===========================================================================
 * WHAT A CURRENCY WAS WORTH, AND WHEN
 * ---------------------------------------------------------------------------
 * A rate is only ever true on a day. Converting last January's purchase at
 * today's rate produces a figure that is arithmetically clean and historically
 * false, and it moves every past month every time the market does — which is
 * the one thing a ledger must never do.
 *
 * So rates are stored per day and read as "the latest rate on or before this
 * date". A gap in the history is filled by carrying the last known rate
 * forward, because that is what actually happened: nobody looked, and the
 * figure they had was the one they were working from.
 *
 * Nothing here fetches anything. Rates arrive because somebody typed or pasted
 * them, exactly as prices do — this app has never made a network request and
 * this slice is not where that starts.
 * ======================================================================== */

import { sql } from 'drizzle-orm';
import { MoneyError, minor, type CurrencyCode, type Minor } from '@/core/money';
// Deep import on purpose: see the note in the money barrel.
import {
  IDENTITY_RATE_1E6,
  rate1e6,
  toBaseCurrency,
  type Rate1e6,
} from '@/core/money/fx';
import {
  LedgerError,
  entryId as toEntryId,
  isoDate,
  type AccountId,
  type IsoDate,
  type LedgerAccount,
} from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import { fxRevaluation } from '@/core/ledger/entries/transferCrossCurrency';
import { SYSTEM_ACCOUNTS } from '@/data/seed';
import { db, runBatch } from '../client';
import { fxRates } from '../schema/tables';
import { listAccounts, saveEntry } from './ledgerRepo';

export const FX_TABLES = ['fx_rates', 'accounts', 'entries', 'postings'] as const;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): IsoDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return isoDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
}

export interface SaveFxRateParams {
  baseCurrency: string;
  quoteCurrency: string;
  rateScaled: Rate1e6;
  date: IsoDate;
  source?: 'manual' | 'ecb' | 'csv';
}

/**
 * Record what a currency was worth on a day.
 *
 * One row per pair per day. A second figure for the same day is a correction
 * rather than a second fact, so it replaces the first — which is also what a
 * person means when they type a rate over one they got wrong.
 */
export async function saveFxRate(params: SaveFxRateParams): Promise<void> {
  if (params.baseCurrency === params.quoteCurrency) {
    throw new MoneyError('A currency is always worth exactly one of itself.');
  }

  const statement = db
    .insert(fxRates)
    .values({
      id: newId('fx'),
      baseCurrency: params.baseCurrency,
      quoteCurrency: params.quoteCurrency,
      rateScaled: params.rateScaled,
      date: params.date,
      source: params.source ?? 'manual',
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.date],
      set: { rateScaled: params.rateScaled, source: params.source ?? 'manual' },
    })
    .toSQL();

  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Several at once, for a pasted batch. One transaction. */
export async function saveFxRates(rates: readonly SaveFxRateParams[]): Promise<number> {
  const usable = rates.filter((r) => r.baseCurrency !== r.quoteCurrency && r.rateScaled > 0);
  if (usable.length === 0) return 0;

  const now = new Date().toISOString();
  const statements = usable.map((params) =>
    db
      .insert(fxRates)
      .values({
        id: newId('fx'),
        baseCurrency: params.baseCurrency,
        quoteCurrency: params.quoteCurrency,
        rateScaled: params.rateScaled,
        date: params.date,
        source: params.source ?? 'manual',
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.date],
        set: { rateScaled: params.rateScaled, source: params.source ?? 'manual' },
      })
      .toSQL(),
  );

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
  return usable.length;
}

/**
 * The rate that applied on a given day.
 *
 * Latest on or before the date, because that is the figure somebody would have
 * been working from. When nothing precedes it — a purchase older than any rate
 * on record — the earliest known rate is used rather than refusing, and the
 * caller is told so, because a balance sheet that will not render is worse than
 * one carrying a stated approximation.
 */
export async function getRateAsOf(
  quoteCurrency: string,
  date: IsoDate,
  baseCurrency: string,
): Promise<{ rate: Rate1e6; asOf: string | null; extrapolated: boolean }> {
  if (quoteCurrency === baseCurrency) {
    return { rate: IDENTITY_RATE_1E6, asOf: date, extrapolated: false };
  }

  const [onOrBefore] = (await db.all(sql`
    SELECT rate_scaled, date FROM fx_rates
     WHERE base_currency = ${baseCurrency} AND quote_currency = ${quoteCurrency}
       AND date <= ${date}
     ORDER BY date DESC LIMIT 1`)) as unknown as Record<number, unknown>[];

  if (onOrBefore) {
    return {
      rate: rate1e6(Number(onOrBefore[0])),
      asOf: String(onOrBefore[1]),
      extrapolated: false,
    };
  }

  // Nothing before it. The earliest known rate is the closest thing to the
  // truth available, and saying it was extrapolated is more useful than
  // refusing to show a figure at all.
  const [earliest] = (await db.all(sql`
    SELECT rate_scaled, date FROM fx_rates
     WHERE base_currency = ${baseCurrency} AND quote_currency = ${quoteCurrency}
     ORDER BY date ASC LIMIT 1`)) as unknown as Record<number, unknown>[];

  if (!earliest) {
    throw new MoneyError(
      `There is no exchange rate on record for ${quoteCurrency}. Add one and every ` +
        `${quoteCurrency} figure will be shown in your own currency too.`,
    );
  }

  return {
    rate: rate1e6(Number(earliest[0])),
    asOf: String(earliest[1]),
    extrapolated: true,
  };
}

export interface FxRateRow {
  quoteCurrency: string;
  rateScaled: Rate1e6;
  date: string;
  source: string;
}

/** The latest rate on record for every currency that has one. */
export async function latestRates(baseCurrency: string): Promise<FxRateRow[]> {
  const rows = (await db.all(sql`
    SELECT f.quote_currency, f.rate_scaled, f.date, f.source
      FROM fx_rates f
      JOIN (SELECT quote_currency, MAX(date) AS d FROM fx_rates
             WHERE base_currency = ${baseCurrency}
             GROUP BY quote_currency) latest
        ON latest.quote_currency = f.quote_currency AND latest.d = f.date
     WHERE f.base_currency = ${baseCurrency}
     ORDER BY f.quote_currency`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    quoteCurrency: String(row[0]),
    rateScaled: rate1e6(Number(row[1])),
    date: String(row[2]),
    source: String(row[3]),
  }));
}

/** Every rate recorded for one currency, newest first. */
export async function rateHistory(
  quoteCurrency: string,
  baseCurrency: string,
  limit = 24,
): Promise<FxRateRow[]> {
  const rows = (await db.all(sql`
    SELECT quote_currency, rate_scaled, date, source FROM fx_rates
     WHERE base_currency = ${baseCurrency} AND quote_currency = ${quoteCurrency}
     ORDER BY date DESC LIMIT ${limit}`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    quoteCurrency: String(row[0]),
    rateScaled: rate1e6(Number(row[1])),
    date: String(row[2]),
    source: String(row[3]),
  }));
}

/** Every currency in use across the accounts, other than the base one. */
export async function currenciesInUse(baseCurrency: string): Promise<string[]> {
  const accounts = await listAccounts();
  const found = new Set<string>();

  for (const account of accounts) {
    if (account.archivedAt) continue;
    if (account.currency && account.currency !== baseCurrency) found.add(account.currency);
  }

  const securityRows = (await db.all(sql`
    SELECT DISTINCT currency FROM securities`)) as unknown as Record<number, unknown>[];
  for (const row of securityRows) {
    const code = String(row[0]);
    if (code && code !== baseCurrency) found.add(code);
  }

  return [...found].sort();
}

/* ===========================================================================
 * RESTATING FOREIGN BALANCES
 * ======================================================================== */

export interface RevaluationResult {
  account: LedgerAccount;
  nativeBalance: Minor;
  previousBase: Minor;
  newBase: Minor;
  delta: Minor;
}

/**
 * Bring every foreign balance into line with today's rate.
 *
 * Nothing moves. The dollars in the account are the same dollars; what changed
 * is what they are worth in the currency the household reports in — so this
 * touches net worth and touches neither spending nor what is safe to spend, in
 * exactly the way a house being revalued does.
 *
 * Accounts already at the current rate are skipped rather than written with a
 * zero, so running this twice in a day leaves one entry rather than two.
 */
export async function revalueForeignBalances(
  baseCurrency: string,
  asOfDate: IsoDate = today(),
): Promise<RevaluationResult[]> {
  const accounts = await listAccounts();
  const done: RevaluationResult[] = [];

  for (const account of accounts) {
    if (account.archivedAt) continue;
    if (!account.currency || account.currency === baseCurrency) continue;
    if (account.type !== 'ASSET' && account.type !== 'LIABILITY') continue;

    // An on-budget foreign account is refused at creation, so reaching one
    // here means older data. Skipping it is safer than writing an entry that
    // would break the mirror between budgeted and real money.
    if (account.onBudget) continue;

    const { nativeBalance, baseValue } = await balancesOf(account.id);
    if (nativeBalance === 0) continue;

    const { rate } = await getRateAsOf(account.currency, asOfDate, baseCurrency);
    const newBase = toBaseCurrency({
      amount: nativeBalance,
      rateScaled: rate,
      quoteCurrency: account.currency as CurrencyCode,
      baseCurrency: baseCurrency as CurrencyCode,
    });

    if (newBase === baseValue) continue;

    await saveEntry(
      fxRevaluation({
        id: toEntryId(newId('ent')),
        date: asOfDate,
        account,
        nativeBalance,
        currentBaseValue: baseValue,
        newBaseValue: newBase,
        newRateScaled: rate,
        system: SYSTEM_ACCOUNTS,
      }),
    );

    done.push({
      account,
      nativeBalance,
      previousBase: baseValue,
      newBase,
      delta: minor(newBase - baseValue),
    });
  }

  return done;
}

/** One account's balance, in its own currency and in the reporting one. */
export async function balancesOf(
  accountId: AccountId,
): Promise<{ nativeBalance: Minor; baseValue: Minor }> {
  const [row] = (await db.all(sql`
    SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(base_amount), 0)
      FROM postings WHERE account_id = ${accountId}`)) as unknown as Record<number, unknown>[];

  return {
    nativeBalance: minor(Number(row?.[0] ?? 0)),
    baseValue: minor(Number(row?.[1] ?? 0)),
  };
}

/** Guards against an account that no longer exists. */
export async function requireAccount(id: AccountId): Promise<LedgerAccount> {
  const account = (await listAccounts()).find((a) => a.id === id);
  if (!account) {
    throw new LedgerError('That account could not be found, so nothing has been recorded.');
  }
  return account;
}
