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

import { sql } from 'drizzle-orm';
import { basisPoints, minor, type BasisPoints, type Minor } from '@/core/money';
import {
  LedgerError,
  entryId as toEntryId,
  isoDate,
  valuation,
  type AccountId,
  type IsoDate,
  type LedgerAccount,
} from '@/core/ledger';
import {
  reconcileTarget,
  totalsOf,
  type AssetClass,
  type Holding,
  type Security,
} from '@/core/investments';
import { SYSTEM_ACCOUNTS } from '@/data/seed';
import { db, runBatch } from '../client';
import { holdings, securities, securityPrices, valuations } from '../schema/tables';
import { currentValue } from './accountsRepo';
import { listAccounts, saveEntry } from './ledgerRepo';

export const INVESTMENT_TABLES = [
  'securities',
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
             ORDER BY p.date DESC, p.created_at DESC LIMIT 1)
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
): Promise<{ changed: boolean; delta: Minor; uninvestedCash: Minor }> {
  const account = (await listAccounts()).find((a) => a.id === accountId);
  if (!account) {
    throw new LedgerError('That account could not be found, so nothing has been recorded.');
  }

  const registerValue = totalsOf(await listPortfolio(accountId)).marketValue;
  const ledgerValue = await currentValue(accountId);

  // The rule itself lives in `@/core/investments`, where it can be reasoned
  // about and tested without a database standing by.
  const lastMark = await lastRegisterMark(accountId);
  const { target, delta, uninvestedCash } = reconcileTarget({
    registerValue,
    ledgerValue,
    lastRegisterValue: lastMark,
  });

  if (delta === 0) {
    // Still record where the register stands, so the next sync measures from
    // here rather than from whenever it last happened to move the balance.
    if (lastMark !== registerValue) await writeRegisterMark(accountId, asOf, registerValue);
    return { changed: false, delta, uninvestedCash };
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

  return { changed: true, delta, uninvestedCash };
}

/** What the register was worth when the two records were last reconciled. */
async function lastRegisterMark(accountId: AccountId): Promise<Minor | null> {
  const [row] = (await db.all(sql`
    SELECT value FROM valuations
     WHERE account_id = ${accountId}
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
      notes: 'What the holdings in this account added up to.',
      entryId: null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [valuations.accountId, valuations.date],
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
  /** Minor units for one whole share, today. */
  priceMinor: Minor;
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

  const statements = [
    existing[0]
      ? db
          .update(securities)
          .set({
            name,
            assetClass: input.assetClass,
            expenseRatioBp: input.expenseRatioBp,
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
            currency: 'EUR',
            expenseRatioBp: input.expenseRatioBp,
            createdAt: now,
          })
          .toSQL(),

    db
      .insert(holdings)
      .values({
        id: newId('hold'),
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
