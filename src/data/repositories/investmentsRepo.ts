/* ===========================================================================
 * THE HOLDINGS REGISTER
 * ---------------------------------------------------------------------------
 * Two records of the same money, and this file's whole job is keeping them
 * from disagreeing.
 *
 * The ledger says a brokerage account is worth some figure. The register says
 * what is actually in it, share by share. Both have to be true at once, and
 * the register is the one that moves — prices change, the account balance does
 * not know about it — so after any change to holdings or prices the account is
 * marked to what the register now adds up to, through the same `valuation()`
 * entry Slice 7.1 built. Unrealised gains go to equity, nothing touches income
 * or spending, and the balance sheet and the register are equal again.
 *
 * Doing it the other way round — letting the account balance be edited freely
 * and hoping the register keeps up — is how a portfolio screen comes to show
 * a total that is not the sum of the rows underneath it.
 * ======================================================================== */

import { asc, inArray, sql } from 'drizzle-orm';
import { REGISTER_MARK_NOTE } from '@/data/schema/migrations/v20';
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
import { valuation } from '@/core/ledger/entries/valuation';
// Deep import on purpose: see the note in the ledger barrel.
import { investmentDividend, investmentSell } from '@/core/ledger/entries/trade';
import {
  allocationOf,
  assertTargetsComplete,
  planRebalance,
  reconcileTarget,
  relieveLotsFIFO,
  totalRemaining,
  totalsOf,
  type AssetClass,
  type Holding,
  type RebalancePlan,
  type Security,
  type TargetAllocation,
  type TaxLot,
} from '@/core/investments';
import { SYSTEM_ACCOUNTS } from '@/data/seed';
import { db, runBatch } from '../client';
import {
  holdings,
  investmentTrades,
  securities,
  securityPrices,
  targetAllocations,
  taxLots,
  valuations,
} from '../schema/tables';
import { currentValue } from './accountsRepo';
import { listAccounts, saveEntry } from './ledgerRepo';

export const INVESTMENT_TABLES = [
  'securities',
  'tax_lots',
  'investment_trades',
  'target_allocations',
  'valuations',
  'holdings',
  'security_prices',
  'accounts',
  'entries',
  'postings',
] as const;

/** The account classes that can hold securities. */
const INVESTABLE = new Set(['brokerage', 'retirement']);

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): IsoDate {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return isoDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
}

/** Every account that can hold securities. */
export async function listInvestmentAccounts(): Promise<LedgerAccount[]> {
  return (await listAccounts()).filter(
    (a) => !a.archivedAt && a.accountClass !== null && INVESTABLE.has(a.accountClass ?? ''),
  );
}

/* ===========================================================================
 * READING THE REGISTER
 * ======================================================================== */

/**
 * Every holding, with its security and its latest price.
 *
 * One query rather than one per holding. The correlated subquery picks the
 * newest price per security — newest by date, then by insertion, so two marks
 * on the same day resolve to the later one rather than to whichever the
 * planner happened to reach first.
 */
export async function listPortfolio(accountId?: AccountId): Promise<Holding[]> {
  const rows = (await db.all(sql`
    SELECT h.id, h.account_id, h.quantity_1e8, h.cost_basis,
           s.id, s.symbol, s.name, s.isin, s.asset_class, s.currency, s.expense_ratio_bp,
           (SELECT p.price_minor FROM security_prices p
             WHERE p.security_id = s.id
             ORDER BY p.date DESC, p.created_at DESC LIMIT 1),
           (SELECT p.date FROM security_prices p
             WHERE p.security_id = s.id
             ORDER BY p.date DESC, p.created_at DESC LIMIT 1),
           s.currency,
           -- The day the earliest parcel arrived, and what the currency was
           -- worth then. Both derived rather than stored: the lots already
           -- know when they were bought, and the rate table already knows what
           -- a currency was worth on a day, so a third copy could only drift.
           (SELECT MIN(l.acquired_date) FROM tax_lots l
             WHERE l.holding_id = h.id),
           (SELECT f.rate_scaled FROM fx_rates f
             WHERE f.quote_currency = s.currency
               AND f.date <= COALESCE(
                     (SELECT MIN(l.acquired_date) FROM tax_lots l WHERE l.holding_id = h.id),
                     date('now'))
             ORDER BY f.date DESC LIMIT 1)
      FROM holdings h
      JOIN securities s ON s.id = h.security_id
      JOIN accounts a   ON a.id = h.account_id
     WHERE a.archived_at IS NULL
       ${accountId ? sql`AND h.account_id = ${accountId}` : sql``}
     ORDER BY s.symbol`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    id: String(row[0]),
    accountId: String(row[1]),
    quantity1e8: Number(row[2]),
    costBasis: minor(Number(row[3])),
    security: {
      id: String(row[4]),
      symbol: String(row[5]),
      name: String(row[6]),
      isin: row[7] === null || row[7] === undefined ? null : String(row[7]),
      assetClass: String(row[8]) as AssetClass,
      currency: String(row[9]),
      expenseRatioBp: basisPoints(Number(row[10])),
    },
    // A holding with no price yet is worth nothing until somebody says
    // otherwise, which is more honest than assuming it is worth what it cost.
    priceMinor: minor(Number(row[11] ?? 0)),
    pricedOn: row[12] === null || row[12] === undefined ? null : String(row[12]),
    acquiredOn: row[14] === null || row[14] === undefined ? null : String(row[14]),
    purchaseRateScaled:
      row[15] === null || row[15] === undefined ? null : Number(row[15]),
  }));
}

/** Every security on record, for the batch price sheet. */
export async function listSecurities(): Promise<Security[]> {
  const rows = (await db.all(sql`
    SELECT s.id, s.symbol, s.name, s.isin, s.asset_class, s.currency, s.expense_ratio_bp
      FROM securities s
     ORDER BY s.symbol`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    id: String(row[0]),
    symbol: String(row[1]),
    name: String(row[2]),
    isin: row[3] === null || row[3] === undefined ? null : String(row[3]),
    assetClass: String(row[4]) as AssetClass,
    currency: String(row[5]),
    expenseRatioBp: basisPoints(Number(row[6])),
  }));
}

/* ===========================================================================
 * KEEPING THE TWO RECORDS EQUAL
 * ======================================================================== */

/**
 * Mark an investment account to what its holdings now add up to.
 *
 * The one place the register and the balance sheet are reconciled. Called
 * after anything that could have changed either — a new holding, a price, an
 * edited cost — and does nothing at all when they already agree, so it is safe
 * to call more often than strictly necessary.
 *
 * The subtlety is money sitting in the account that has not been invested yet.
 * Somebody who transfers €500 into a broker on Monday and buys on Friday has
 * an account worth €500 more than its holdings all week, and a sync that
 * simply set the balance to the register's total would delete that €500 —
 * silently, and on a screen they were not looking at.
 *
 * So the register's value is not the target; the *change* in it is. What the
 * account was last marked at is remembered in `valuations`, which is what that
 * table is for, and whatever the balance holds above that figure is cash the
 * register does not know about and must not lose.
 */
export async function syncAccountValue(
  accountId: AccountId,
  asOf: IsoDate = today(),
  statedCash?: Minor,
): Promise<{
  changed: boolean;
  delta: Minor;
  uninvestedCash: Minor;
  /** True when nothing was written because the difference is still unexplained. */
  needsReconciling: boolean;
}> {
  const account = (await listAccounts()).find((a) => a.id === accountId);
  if (!account) {
    throw new LedgerError('That account could not be found, so nothing has been recorded.');
  }

  const registerValue = totalsOf(await listPortfolio(accountId)).marketValue;
  const ledgerValue = await currentValue(accountId);

  // The rule itself lives in `@/core/investments`, where it can be reasoned
  // about and tested without a database standing by.
  const lastMark = await lastRegisterMark(accountId);
  const { target, delta, uninvestedCash, needsReconciling } = reconcileTarget({
    registerValue,
    ledgerValue,
    lastRegisterValue: lastMark,
    ...(statedCash === undefined ? {} : { statedCash }),
  });

  /*
   * The engine refused to guess, so nothing is written — not the valuation and
   * not the register mark either.
   *
   * Recording the mark here would be worse than the loss it replaced: the
   * residual would then be measured from an incomplete register, and the next
   * holding somebody typed would *inflate* the account by its whole value.
   * The account stays exactly as they left it until someone states the cash.
   */
  if (needsReconciling) {
    return { changed: false, delta, uninvestedCash, needsReconciling: true };
  }

  if (delta === 0) {
    // Still record where the register stands, so the next sync measures from
    // here rather than from whenever it last happened to move the balance.
    if (lastMark !== registerValue) await writeRegisterMark(accountId, asOf, registerValue);
    return { changed: false, delta, uninvestedCash, needsReconciling: false };
  }

  await saveEntry(
    valuation({
      id: toEntryId(newId('ent')),
      date: asOf,
      account,
      currentValue: ledgerValue,
      newValue: target,
      memo: 'Brought into line with what the account holds.',
      system: SYSTEM_ACCOUNTS,
    }),
    [registerMarkStatement(accountId, asOf, registerValue)],
  );

  return { changed: true, delta, uninvestedCash, needsReconciling: false };
}

/** What the register was worth when the two records were last reconciled. */
async function lastRegisterMark(accountId: AccountId): Promise<Minor | null> {
  /*
   * `kind = 'register'` is the whole point of this query.
   *
   * Without it this read the newest valuation of any kind, so a figure a
   * person typed themselves came back as though the register had been squared
   * against it. The residual then computed to zero and their figure was
   * written off. See P24 in AUDIT.md.
   */
  const [row] = (await db.all(sql`
    SELECT value FROM valuations
     WHERE account_id = ${accountId} AND kind = 'register'
     ORDER BY date DESC, created_at DESC
     LIMIT 1`)) as unknown as Record<number, unknown>[];
  return row === undefined ? null : minor(Number(row[0]));
}

function registerMarkStatement(
  accountId: AccountId,
  date: string,
  value: Minor,
): { sql: string; params: unknown[] } {
  const now = new Date().toISOString();
  const statement = db
    .insert(valuations)
    .values({
      id: newId('val'),
      accountId,
      date,
      value,
      costBasis: null,
      notes: REGISTER_MARK_NOTE,
      kind: 'register',
      entryId: null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      // `kind` is in the key, so this can only ever replace another register
      // mark. It used to be able to replace the person's own opening figure.
      target: [valuations.accountId, valuations.date, valuations.kind],
      set: { value, createdAt: now },
    })
    .toSQL();
  return { sql: statement.sql, params: statement.params };
}

async function writeRegisterMark(
  accountId: AccountId,
  date: string,
  value: Minor,
): Promise<void> {
  await runBatch([registerMarkStatement(accountId, date, value)]);
}

/* ===========================================================================
 * WRITING TO THE REGISTER
 * ======================================================================== */

export interface AddHoldingInput {
  accountId: AccountId;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  isin?: string;
  /** Annual charge in basis points. 22 is 0.22% a year. */
  expenseRatioBp: BasisPoints;
  /** Shares as an exact integer at 1e8. */
  quantity1e8: number;
  /** What the whole position cost, in minor units. */
  costBasis: Minor;
  /** Minor units for one whole share, today, in the security's own currency. */
  priceMinor: Minor;
  /**
   * What the security is priced in. Defaults to the household's currency.
   *
   * A US fund quotes in dollars whatever account holds it, so this belongs to
   * the security rather than to the holding — which is also why correcting it
   * corrects every account that holds the same thing.
   */
  currency?: string;
  asOf?: IsoDate;
}

/**
 * Record a holding, creating the security behind it if this is the first time
 * it has been seen.
 *
 * Buying more of something already held adds to the position rather than
 * sitting beside it — two rows for the same fund in the same account would
 * each show a plausible return and neither would be the truth.
 */
export async function addHolding(input: AddHoldingInput): Promise<void> {
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name.trim();

  if (!symbol) throw new LedgerError('A holding needs a symbol, like VWCE or ASML.');
  if (!name) throw new LedgerError('A holding needs a name, so it is recognisable later.');
  if (input.quantity1e8 <= 0) throw new LedgerError('A holding needs a number of shares.');
  if (input.costBasis < 0) throw new LedgerError('What something cost cannot be less than nothing.');
  if (input.priceMinor < 0) throw new LedgerError('A price cannot be less than nothing.');

  const date = input.asOf ?? today();
  const now = new Date().toISOString();

  // Same ticker, same fund, same fee — wherever it is held. Reusing the row
  // means correcting an expense ratio corrects it everywhere at once.
  const existing = (await db.all(sql`
    SELECT id FROM securities WHERE symbol = ${symbol} LIMIT 1`)) as unknown as Record<
    number,
    unknown
  >[];

  const securityId = existing[0] ? String(existing[0][0]) : newId('sec');

  // The holding's id has to be known before the batch, because the tax lot
  // points at it. Adding to a position you already hold reuses the row.
  const heldRow = (await db.all(sql`
    SELECT id FROM holdings WHERE account_id = ${input.accountId} AND security_id = ${securityId}
     LIMIT 1`)) as unknown as Record<number, unknown>[];
  const holdingId = heldRow[0] ? String(heldRow[0][0]) : newId('hold');

  const statements = [
    existing[0]
      ? db
          .update(securities)
          .set({
            name,
            assetClass: input.assetClass,
            expenseRatioBp: input.expenseRatioBp,
            ...(input.currency ? { currency: input.currency } : {}),
            ...(input.isin?.trim() ? { isin: input.isin.trim() } : {}),
          })
          .where(sql`${securities.id} = ${securityId}`)
          .toSQL()
      : db
          .insert(securities)
          .values({
            id: securityId,
            symbol,
            name,
            isin: input.isin?.trim() || null,
            assetClass: input.assetClass,
            currency: input.currency ?? 'EUR',
            expenseRatioBp: input.expenseRatioBp,
            createdAt: now,
          })
          .toSQL(),

    db
      .insert(holdings)
      .values({
        id: holdingId,
        accountId: input.accountId,
        securityId,
        quantity1e8: input.quantity1e8,
        costBasis: input.costBasis,
        createdAt: now,
        updatedAt: now,
      })
      // Adding to a position you already hold: the shares and the cost both
      // accumulate, which is what a second purchase actually does to it.
      .onConflictDoUpdate({
        target: [holdings.accountId, holdings.securityId],
        set: {
          quantity1e8: sql`${holdings.quantity1e8} + ${input.quantity1e8}`,
          costBasis: sql`${holdings.costBasis} + ${input.costBasis}`,
          updatedAt: now,
        },
      })
      .toSQL(),

    db
      .insert(securityPrices)
      .values({
        id: newId('px'),
        securityId,
        date,
        priceMinor: input.priceMinor,
        source: 'manual',
        createdAt: now,
      })
      .toSQL(),

    // Every purchase opens its own parcel. Which parcel a future sale takes
    // decides the gain, so they cannot be reconstructed after the fact from a
    // holding that only remembers a running total.
    db
      .insert(taxLots)
      .values({
        id: newId('lot'),
        accountId: input.accountId,
        securityId,
        holdingId,
        acquiredDate: date,
        quantity1e8: input.quantity1e8,
        remainingQuantity1e8: input.quantity1e8,
        costBasisMinor: input.costBasis,
        isClosed: 0,
        createdAt: now,
      })
      .toSQL(),

    db
      .insert(investmentTrades)
      .values({
        id: newId('trade'),
        accountId: input.accountId,
        securityId,
        tradeType: 'buy',
        date,
        quantity1e8: input.quantity1e8,
        priceMinor: input.priceMinor,
        grossAmountMinor: input.costBasis,
        feesMinor: 0,
        realizedGainMinor: null,
        entryId: null,
        createdAt: now,
      })
      .toSQL(),
  ];

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
  await syncAccountValue(input.accountId, date);
}

/** Change how many shares are held, or what the position cost. */
export async function editHolding(
  holdingId: string,
  accountId: AccountId,
  patch: { quantity1e8?: number; costBasis?: Minor },
): Promise<void> {
  if (patch.quantity1e8 !== undefined && patch.quantity1e8 < 0) {
    throw new LedgerError('A holding cannot be a negative number of shares.');
  }

  const statement = db
    .update(holdings)
    .set({
      ...(patch.quantity1e8 === undefined ? {} : { quantity1e8: patch.quantity1e8 }),
      ...(patch.costBasis === undefined ? {} : { costBasis: patch.costBasis }),
      updatedAt: new Date().toISOString(),
    })
    .where(sql`${holdings.id} = ${holdingId}`)
    .toSQL();

  await runBatch([{ sql: statement.sql, params: statement.params }]);
  await syncAccountValue(accountId);
}

/** Remove a position entirely. The prices and the security stay. */
export async function removeHolding(holdingId: string, accountId: AccountId): Promise<void> {
  const statement = db.delete(holdings).where(sql`${holdings.id} = ${holdingId}`).toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
  await syncAccountValue(accountId);
}

/** Correct what a fund is called, what kind of thing it is, or what it charges. */
export async function updateSecurity(
  securityId: string,
  patch: { name?: string; assetClass?: AssetClass; expenseRatioBp?: BasisPoints; isin?: string },
): Promise<void> {
  const statement = db
    .update(securities)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.assetClass === undefined ? {} : { assetClass: patch.assetClass }),
      ...(patch.expenseRatioBp === undefined ? {} : { expenseRatioBp: patch.expenseRatioBp }),
      ...(patch.isin === undefined ? {} : { isin: patch.isin.trim() || null }),
    })
    .where(sql`${securities.id} = ${securityId}`)
    .toSQL();

  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/* ===========================================================================
 * PRICES
 * ======================================================================== */

export interface PriceUpdate {
  securityId: string;
  priceMinor: Minor;
}

/**
 * Record new prices, then bring every affected account back into line.
 *
 * One transaction for all the prices, then one valuation per account rather
 * than one per holding: twenty price updates on one portfolio should leave one
 * entry in the journal saying what the account is now worth, not twenty saying
 * how it got there. The register already holds the detail.
 */
export async function updatePrices(
  updates: readonly PriceUpdate[],
  source: 'manual' | 'csv' = 'manual',
  asOf: IsoDate = today(),
): Promise<{ prices: number; accounts: number }> {
  const usable = updates.filter((u) => u.priceMinor >= 0);
  if (usable.length === 0) return { prices: 0, accounts: 0 };

  const now = new Date().toISOString();
  const statements = usable.map((update) =>
    db
      .insert(securityPrices)
      .values({
        id: newId('px'),
        securityId: update.securityId,
        date: asOf,
        priceMinor: update.priceMinor,
        source,
        createdAt: now,
      })
      .toSQL(),
  );

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));

  const affected = (await db.all(sql`
    SELECT DISTINCT h.account_id FROM holdings h`)) as unknown as Record<number, unknown>[];

  let changed = 0;
  for (const row of affected) {
    const result = await syncAccountValue(String(row[0]) as AccountId, asOf);
    if (result.changed) changed += 1;
  }

  return { prices: usable.length, accounts: changed };
}

/** Every price recorded for one security, newest first. */
export async function priceHistory(
  securityId: string,
  limit = 24,
): Promise<{ date: string; priceMinor: Minor; source: string }[]> {
  const rows = (await db.all(sql`
    SELECT date, price_minor, source FROM security_prices
     WHERE security_id = ${securityId}
     ORDER BY date DESC, created_at DESC
     LIMIT ${limit}`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    date: String(row[0]),
    priceMinor: minor(Number(row[1])),
    source: String(row[2]),
  }));
}

/**
 * The last `limit` prices for each of several securities, oldest first.
 *
 * One query for the whole screen. The holdings list draws a sparkline in every
 * row, and a per-row query would turn a list of twelve into twelve round trips
 * to the worker - the shape that makes a local database feel like a network.
 *
 * Securities with fewer than two prices are simply absent from the map. There
 * is no line to draw from one point, and an entry of length one would invite
 * the caller to draw a flat one, which would be a claim rather than a gap.
 */
export async function priceHistories(
  securityIds: readonly string[],
  limit = 12,
): Promise<Map<string, Minor[]>> {
  const out = new Map<string, Minor[]>();
  if (securityIds.length === 0) return out;

  const rows = await db
    .select({
      securityId: securityPrices.securityId,
      priceMinor: securityPrices.priceMinor,
    })
    .from(securityPrices)
    .where(inArray(securityPrices.securityId, [...securityIds]))
    .orderBy(asc(securityPrices.date), asc(securityPrices.createdAt));

  for (const row of rows) {
    const series = out.get(row.securityId);
    if (series) series.push(minor(Number(row.priceMinor)));
    else out.set(row.securityId, [minor(Number(row.priceMinor))]);
  }

  for (const [id, series] of out) {
    // Oldest first, so the tail is the most recent `limit`.
    if (series.length < 2) out.delete(id);
    else if (series.length > limit) out.set(id, series.slice(-limit));
  }

  return out;
}

/* ===========================================================================
 * SELLING
 * ======================================================================== */

function toTaxLot(row: Record<number, unknown>): TaxLot {
  return {
    id: String(row[0]),
    accountId: String(row[1]),
    securityId: String(row[2]),
    holdingId: String(row[3]),
    acquiredDate: String(row[4]),
    quantity1e8: Number(row[5]),
    remainingQuantity1e8: Number(row[6]),
    costBasisMinor: minor(Number(row[7])),
    isClosed: Number(row[8]) === 1,
  };
}

/** Every parcel on record for one holding, whether open or spent. */
export async function listTaxLots(
  accountId: AccountId,
  securityId: string,
): Promise<TaxLot[]> {
  const rows = (await db.all(sql`
    SELECT id, account_id, security_id, holding_id, acquired_date,
           quantity_1e8, remaining_quantity_1e8, cost_basis_minor, is_closed
      FROM tax_lots
     WHERE account_id = ${accountId} AND security_id = ${securityId}
     ORDER BY acquired_date ASC, id ASC`)) as unknown as Record<number, unknown>[];
  return rows.map(toTaxLot);
}

/**
 * The parcels for a holding, inventing one if the holding predates them.
 *
 * A position recorded before this slice existed has a quantity and a cost but
 * no parcels, and a sale cannot relieve what is not there. Rather than refuse
 * to sell — which would strand an existing register — the unaccounted part of
 * the holding is treated as a single parcel acquired on the day it was first
 * priced. That is the most honest thing available: it says the cost is known
 * and the acquisition dates are not, which is exactly the situation.
 */
async function lotsForSale(
  accountId: AccountId,
  securityId: string,
  holding: Holding,
): Promise<{ lots: TaxLot[]; opening: TaxLot | null }> {
  const lots = await listTaxLots(accountId, securityId);
  if (totalRemaining(lots) >= holding.quantity1e8) return { lots, opening: null };

  const [row] = (await db.all(sql`
    SELECT MIN(date) FROM security_prices WHERE security_id = ${securityId}`)) as unknown as Record<
    number,
    unknown
  >[];

  const missing = holding.quantity1e8 - totalRemaining(lots);
  const knownCost = lots.reduce((sum, lot) => sum + lot.costBasisMinor, 0);

  const opening: TaxLot = {
    id: newId('lot'),
    accountId,
    securityId,
    holdingId: holding.id,
    acquiredDate: row?.[0] ? String(row[0]) : today(),
    quantity1e8: missing,
    remainingQuantity1e8: missing,
    costBasisMinor: minor(Math.max(0, holding.costBasis - knownCost)),
    isClosed: false,
  };

  return { lots: [opening, ...lots], opening };
}

export interface SellParams {
  accountId: AccountId;
  securityId: string;
  cashAccountId: AccountId;
  quantity1e8: number;
  pricePerShare: Minor;
  feesMinor?: Minor;
  /** Where the proceeds land in the budget. Defaults to money without a job. */
  toEnvelopeId?: AccountId;
  date?: IsoDate;
}

export interface SellResult {
  proceeds: Minor;
  costBasisRelieved: Minor;
  realizedGain: Minor;
  sharesLeft: number;
}

/**
 * Sell shares: relieve the parcels, move the money, take the gain.
 *
 * The parcel updates and the journal entry go into storage together. A sale
 * that wrote one without the other would leave the register and the books
 * telling different stories about the same trade, and neither would be
 * obviously the wrong one.
 */
export async function executeSell(params: SellParams): Promise<SellResult> {
  const date = params.date ?? today();
  const holdingsHere = await listPortfolio(params.accountId);
  const holding = holdingsHere.find((h) => h.security.id === params.securityId);

  if (!holding) {
    throw new LedgerError('You do not hold that, so there is nothing to sell.');
  }

  const accounts = await listAccounts();
  const brokerage = accounts.find((a) => a.id === params.accountId);
  const cash = accounts.find((a) => a.id === params.cashAccountId);
  if (!brokerage || !cash) {
    throw new LedgerError('One of those accounts could not be found, so nothing was recorded.');
  }

  const { lots, opening } = await lotsForSale(params.accountId, params.securityId, holding);

  const disposal = relieveLotsFIFO({
    lots,
    sellQuantity1e8: params.quantity1e8,
    salePriceMinor: params.pricePerShare,
    ...(params.feesMinor === undefined ? {} : { feesMinor: params.feesMinor }),
  });

  const sharesLeft = holding.quantity1e8 - params.quantity1e8;
  const costLeft = minor(Math.max(0, holding.costBasis - disposal.totalCostBasisRelieved));
  const now = new Date().toISOString();

  const alongside: { sql: string; params: unknown[] }[] = [];

  // A parcel invented for a pre-existing holding has to be written down before
  // it can be depleted, or the update below would touch nothing.
  if (opening) {
    const statement = db
      .insert(taxLots)
      .values({
        id: opening.id,
        accountId: opening.accountId,
        securityId: opening.securityId,
        holdingId: opening.holdingId,
        acquiredDate: opening.acquiredDate,
        quantity1e8: opening.quantity1e8,
        remainingQuantity1e8: opening.quantity1e8,
        costBasisMinor: opening.costBasisMinor,
        isClosed: 0,
        createdAt: now,
      })
      .toSQL();
    alongside.push({ sql: statement.sql, params: statement.params });
  }

  for (const relief of disposal.relieved) {
    const updated = disposal.updatedLots.find((l) => l.id === relief.lotId)!;
    const statement = db
      .update(taxLots)
      .set({
        remainingQuantity1e8: updated.remainingQuantity1e8,
        isClosed: updated.isClosed ? 1 : 0,
      })
      .where(sql`${taxLots.id} = ${relief.lotId}`)
      .toSQL();
    alongside.push({ sql: statement.sql, params: statement.params });
  }

  // Selling out completely removes the holding; the parcels and the prices
  // stay, so the history of what was owned survives the position.
  const holdingStatement =
    sharesLeft > 0
      ? db
          .update(holdings)
          .set({ quantity1e8: sharesLeft, costBasis: costLeft, updatedAt: now })
          .where(sql`${holdings.id} = ${holding.id}`)
          .toSQL()
      : db.delete(holdings).where(sql`${holdings.id} = ${holding.id}`).toSQL();
  alongside.push({ sql: holdingStatement.sql, params: holdingStatement.params });

  const entry = investmentSell({
    id: toEntryId(newId('ent')),
    date,
    cashAccount: cash,
    brokerageAccount: brokerage,
    proceeds: disposal.totalProceeds,
    costBasisRelieved: disposal.totalCostBasisRelieved,
    realizedGain: disposal.realizedGain,
    ...(params.toEnvelopeId ? { toEnvelopeId: params.toEnvelopeId } : {}),
    system: SYSTEM_ACCOUNTS,
  });

  const tradeStatement = db
    .insert(investmentTrades)
    .values({
      id: newId('trade'),
      accountId: params.accountId,
      securityId: params.securityId,
      tradeType: 'sell',
      date,
      quantity1e8: params.quantity1e8,
      priceMinor: params.pricePerShare,
      grossAmountMinor: minor(disposal.totalProceeds + disposal.feesMinor),
      feesMinor: disposal.feesMinor,
      realizedGainMinor: disposal.realizedGain,
      entryId: entry.id,
      createdAt: now,
    })
    .toSQL();
  alongside.push({ sql: tradeStatement.sql, params: tradeStatement.params });

  // A trade is a price observation. Recording it keeps the register's view of
  // what the rest of the position is worth honest, rather than leaving it at
  // whatever it was last marked at before the sale happened.
  const priceStatement = db
    .insert(securityPrices)
    .values({
      id: newId('px'),
      securityId: params.securityId,
      date,
      priceMinor: params.pricePerShare,
      source: 'manual',
      createdAt: now,
    })
    .toSQL();
  alongside.push({ sql: priceStatement.sql, params: priceStatement.params });

  // The sale takes the relieved cost off the account, so the register's last
  // agreed figure has to come down by the same amount — otherwise the next
  // reconciliation would read the drop as uninvested cash vanishing and
  // quietly absorb any that was genuinely there.
  const previousMark = await lastRegisterMark(params.accountId);
  if (previousMark !== null) {
    alongside.push(
      registerMarkStatement(
        params.accountId,
        date,
        minor(Math.max(0, previousMark - disposal.totalCostBasisRelieved)),
      ),
    );
  }

  await saveEntry(entry, alongside);
  await syncAccountValue(params.accountId, date);

  return {
    proceeds: disposal.totalProceeds,
    costBasisRelieved: disposal.totalCostBasisRelieved,
    realizedGain: disposal.realizedGain,
    sharesLeft,
  };
}

/* ===========================================================================
 * BEING PAID OUT
 * ======================================================================== */

export interface DividendParams {
  accountId: AccountId;
  securityId: string;
  cashAccountId: AccountId;
  grossAmount: Minor;
  taxWithheld?: Minor;
  isReinvested: boolean;
  /** How many shares the reinvested money bought. */
  quantityBought1e8?: number;
  date?: IsoDate;
}

/**
 * A dividend, whether it arrived as cash or bought more shares.
 *
 * Reinvested is the case people leave out, because nothing appeared in the
 * bank. It is still income and it was still taxable — so it is recorded either
 * way, and what changes is where the money went and whether the budget hears
 * about it.
 */
export async function recordDividend(params: DividendParams): Promise<void> {
  const date = params.date ?? today();
  const accounts = await listAccounts();
  const brokerage = accounts.find((a) => a.id === params.accountId);
  const cash = accounts.find((a) => a.id === params.cashAccountId);

  if (!brokerage || !cash) {
    throw new LedgerError('One of those accounts could not be found, so nothing was recorded.');
  }

  const net = minor(params.grossAmount - (params.taxWithheld ?? 0));
  const now = new Date().toISOString();
  const alongside: { sql: string; params: unknown[] }[] = [];

  const entry = investmentDividend({
    id: toEntryId(newId('ent')),
    date,
    grossAmount: params.grossAmount,
    ...(params.taxWithheld ? { taxWithheld: params.taxWithheld } : {}),
    cashAccount: cash,
    ...(params.isReinvested ? { brokerageAccount: brokerage, isReinvested: true } : {}),
    ...(await payerName(params.securityId)),
    system: SYSTEM_ACCOUNTS,
  });

  if (params.isReinvested && (params.quantityBought1e8 ?? 0) > 0) {
    const bought = params.quantityBought1e8!;
    const holdingsHere = await listPortfolio(params.accountId);
    const holding = holdingsHere.find((h) => h.security.id === params.securityId);

    if (!holding) {
      throw new LedgerError(
        'You do not hold that, so there is nothing for a dividend to be reinvested into.',
      );
    }

    // The reinvested shares are a parcel of their own, acquired today at what
    // the money bought. Folding them into an existing parcel would date them
    // wrongly and change what a later sale realises.
    const lotStatement = db
      .insert(taxLots)
      .values({
        id: newId('lot'),
        accountId: params.accountId,
        securityId: params.securityId,
        holdingId: holding.id,
        acquiredDate: date,
        quantity1e8: bought,
        remainingQuantity1e8: bought,
        costBasisMinor: net,
        isClosed: 0,
        createdAt: now,
      })
      .toSQL();
    alongside.push({ sql: lotStatement.sql, params: lotStatement.params });

    const holdingStatement = db
      .update(holdings)
      .set({
        quantity1e8: holding.quantity1e8 + bought,
        costBasis: minor(holding.costBasis + net),
        updatedAt: now,
      })
      .where(sql`${holdings.id} = ${holding.id}`)
      .toSQL();
    alongside.push({ sql: holdingStatement.sql, params: holdingStatement.params });

    // The account grew by the reinvested cash, so the last agreed register
    // figure grows with it — the extra shares are not a market movement.
    const previousMark = await lastRegisterMark(params.accountId);
    if (previousMark !== null) {
      alongside.push(registerMarkStatement(params.accountId, date, minor(previousMark + net)));
    }
  }

  const tradeStatement = db
    .insert(investmentTrades)
    .values({
      id: newId('trade'),
      accountId: params.accountId,
      securityId: params.securityId,
      tradeType: params.isReinvested ? 'dividend_reinvest' : 'dividend_cash',
      date,
      quantity1e8: params.quantityBought1e8 ?? 0,
      priceMinor: 0,
      grossAmountMinor: params.grossAmount,
      feesMinor: params.taxWithheld ?? 0,
      realizedGainMinor: null,
      entryId: entry.id,
      createdAt: now,
    })
    .toSQL();
  alongside.push({ sql: tradeStatement.sql, params: tradeStatement.params });

  await saveEntry(entry, alongside);
  if (params.isReinvested) await syncAccountValue(params.accountId, date);
}

async function payerName(securityId: string): Promise<{ payer?: string }> {
  const [row] = (await db.all(sql`
    SELECT symbol FROM securities WHERE id = ${securityId} LIMIT 1`)) as unknown as Record<
    number,
    unknown
  >[];
  return row?.[0] ? { payer: String(row[0]) } : {};
}

export interface TradeRow {
  id: string;
  tradeType: 'buy' | 'sell' | 'dividend_reinvest' | 'dividend_cash';
  date: string;
  quantity1e8: number;
  priceMinor: Minor;
  grossAmount: Minor;
  fees: Minor;
  realizedGain: Minor | null;
  symbol: string;
}

/** Everything traded in one account, newest first. */
export async function listTrades(accountId?: AccountId, limit = 40): Promise<TradeRow[]> {
  const rows = (await db.all(sql`
    SELECT t.id, t.trade_type, t.date, t.quantity_1e8, t.price_minor,
           t.gross_amount_minor, t.fees_minor, t.realized_gain_minor, s.symbol
      FROM investment_trades t
      JOIN securities s ON s.id = t.security_id
     ${accountId ? sql`WHERE t.account_id = ${accountId}` : sql``}
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ${limit}`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    id: String(row[0]),
    tradeType: String(row[1]) as TradeRow['tradeType'],
    date: String(row[2]),
    quantity1e8: Number(row[3]),
    priceMinor: minor(Number(row[4])),
    grossAmount: minor(Number(row[5])),
    fees: minor(Number(row[6])),
    realizedGain: row[7] === null || row[7] === undefined ? null : minor(Number(row[7])),
    symbol: String(row[8]),
  }));
}

/* ===========================================================================
 * WHAT THE PORTFOLIO IS MEANT TO LOOK LIKE
 * ======================================================================== */

/** The saved targets, or an empty list when none have been set. */
export async function listTargetAllocations(): Promise<TargetAllocation[]> {
  const rows = (await db.all(sql`
    SELECT asset_class, target_bp FROM target_allocations
     WHERE target_bp > 0 ORDER BY target_bp DESC`)) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    assetClass: String(row[0]) as AssetClass,
    targetBp: basisPoints(Number(row[1])),
  }));
}

/**
 * Replace the targets wholesale.
 *
 * All or nothing, and validated first: a half-saved target set would be used
 * to build a rebalancing plan on percentages that do not add up to a whole
 * portfolio.
 */
export async function saveTargetAllocations(
  allocations: readonly TargetAllocation[],
): Promise<void> {
  const kept = allocations.filter((a) => a.targetBp > 0);
  assertTargetsComplete(kept);

  const now = new Date().toISOString();
  const statements = [
    db.delete(targetAllocations).toSQL(),
    ...kept.map((allocation) =>
      db
        .insert(targetAllocations)
        .values({
          id: newId('target'),
          assetClass: allocation.assetClass,
          targetBp: allocation.targetBp,
          createdAt: now,
          updatedAt: now,
        })
        .toSQL(),
    ),
  ];

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
}

/**
 * How the portfolio compares with the targets, and what to do about it.
 *
 * Returns null rather than throwing when no targets have been set — not having
 * decided what you want yet is an ordinary state, not an error.
 */
export async function getRebalancePlan(depositCash?: Minor): Promise<RebalancePlan | null> {
  const targets = await listTargetAllocations();
  if (targets.length === 0) return null;

  const allocation = allocationOf(await listPortfolio());
  const currentValues = new Map<AssetClass, Minor>(
    allocation.slices.map((slice) => [slice.assetClass, slice.value]),
  );

  return planRebalance({
    currentValues,
    targets,
    ...(depositCash === undefined ? {} : { depositCash }),
  });
}
