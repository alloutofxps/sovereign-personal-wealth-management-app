/* ===========================================================================
 * SCHEMA CREATION
 * ---------------------------------------------------------------------------
 * Hand-written DDL rather than drizzle-kit output, because the constraints
 * matter as much as the columns and this is where they live.
 *
 * The database enforces what it can: a posting for nothing at all is rejected
 * outright, and every enumerated column is constrained. Whole-entry balance
 * (I1) cannot be a row-level CHECK — it is a property of a set of rows — so it
 * is enforced twice above this layer instead: once when an entry is built, and
 * again inside the transaction that writes it.
 * ======================================================================== */

import { LATEST_VERSION } from './migrations';

export const SCHEMA_VERSION = LATEST_VERSION;

/**
 * Run before anything else, including before migrations.
 *
 * Migrations need somewhere to read and write the version number, and the
 * rest of the DDL cannot run until an older database has been brought up to
 * date — a new index over a column a migration is about to add would fail.
 */
export const BOOTSTRAP_DDL: readonly string[] = [
  `PRAGMA foreign_keys = ON;`,
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];

export const DDL: readonly string[] = [
  ...BOOTSTRAP_DDL,

  `CREATE TABLE IF NOT EXISTS accounts (
     id                  TEXT PRIMARY KEY,
     book                TEXT NOT NULL CHECK (book IN ('FINANCIAL','BUDGET')),
     type                TEXT NOT NULL CHECK (type IN (
                           'ASSET','LIABILITY','EQUITY','INCOME','EXPENSE',
                           'BUDGETABLE_CASH','ENVELOPE','READY_TO_ASSIGN')),
     name                TEXT NOT NULL,
     normal              TEXT NOT NULL CHECK (normal IN ('DEBIT','CREDIT')),
     parent_id           TEXT REFERENCES accounts(id),
     status              TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','archived','closed')),
     on_budget           INTEGER NOT NULL DEFAULT 0 CHECK (on_budget IN (0,1)),
     liquid              INTEGER NOT NULL DEFAULT 0 CHECK (liquid IN (0,1)),
     payment_envelope_id TEXT REFERENCES accounts(id),
     envelope_role       TEXT,
     sort_order          INTEGER NOT NULL DEFAULT 0,
     -- Pots that are saving up for something carry their own target.
     target_amount       INTEGER,
     target_date         TEXT,
     target_recurring    INTEGER NOT NULL DEFAULT 0,
     -- Borrowing terms, so what you owe can be planned rather than guessed.
     apr_bp              INTEGER,
     min_payment         INTEGER,
     credit_limit        INTEGER,
     due_day             INTEGER CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 28)),
     -- Archived rather than deleted: past months have to keep adding up, and
     -- a deleted account would orphan every posting that ever pointed at it.
     archived_at         TEXT,
     color_token         TEXT,
     icon                TEXT,
     -- v10. What kind of thing this is, as a person would name it. Null on the
     -- three accounts that predate the idea; see migrations/v10.ts.
     class               TEXT,
     institution         TEXT,
     -- v14. Null means the household's base currency.
     currency            TEXT,
     -- v15. What a loan payment has to be split by. apr_bp above holds the rate.
     original_principal  INTEGER,
     term_months         INTEGER,
     start_date          TEXT,
     monthly_payment     INTEGER,
     escrow_monthly      INTEGER NOT NULL DEFAULT 0,
     interest_type       TEXT NOT NULL DEFAULT 'fixed',
     -- How a car or a laptop loses value on its own, with no transaction.
     depreciation_model  TEXT,
     depreciation_rate_bp INTEGER,
     salvage_value       INTEGER
   );`,

  `CREATE TABLE IF NOT EXISTS entries (
     id                    TEXT PRIMARY KEY,
     kind                  TEXT NOT NULL,
     date                  TEXT NOT NULL CHECK (date LIKE '____-__-__'),
     description           TEXT NOT NULL,
     source_transaction_id TEXT,
     reverses_entry_id     TEXT REFERENCES entries(id),
     sealed                INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0,1)),
     created_at            TEXT NOT NULL,
     -- Set on the two entries that open and settle money you fronted.
     claim_id              TEXT,
     -- v14. Which rate a cross-currency entry was struck at, in words.
     fx_note               TEXT
   );`,

  `CREATE TABLE IF NOT EXISTS postings (
     id         TEXT PRIMARY KEY,
     entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
     book       TEXT NOT NULL CHECK (book IN ('FINANCIAL','BUDGET')),
     account_id TEXT NOT NULL REFERENCES accounts(id),
     -- A line for nothing at all is meaningless, and is invariant I2.
     amount     INTEGER NOT NULL CHECK (amount <> 0),
     clearance  TEXT NOT NULL CHECK (clearance IN ('pending','cleared')),
     memo       TEXT,
     sequence   INTEGER NOT NULL,
     -- v16. When you checked this line against a bank statement, or null if
     -- you never have. This is what "locked" means; there is no third
     -- clearance value, because that would be the same fact stored twice.
     reconciled_at  TEXT,
     -- v14. What the line is worth in the currency you report in, and the rate
     -- it was struck at. Equal to amount, and exactly 1.000000, for anything
     -- already in the base currency, which is most of it.
     base_amount    INTEGER NOT NULL DEFAULT 0,
     fx_rate_scaled INTEGER NOT NULL DEFAULT 1000000
   );`,

  // Patterns that file a statement row without being asked twice.
  `CREATE TABLE IF NOT EXISTS rules (
     id              TEXT PRIMARY KEY,
     pattern         TEXT NOT NULL,
     is_regex        INTEGER NOT NULL DEFAULT 0 CHECK (is_regex IN (0,1)),
     match_field     TEXT NOT NULL DEFAULT 'description'
                       CHECK (match_field IN ('description','raw_descriptor')),
     category_id     TEXT NOT NULL REFERENCES accounts(id),
     envelope_id     TEXT NOT NULL REFERENCES accounts(id),
     priority        INTEGER NOT NULL DEFAULT 0,
     active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
     match_count     INTEGER NOT NULL DEFAULT 0,
     last_matched_at TEXT,
     created_at      TEXT NOT NULL
   );`,

  // Regular payments in and out. These are what make "safe to spend" mean
  // anything: money already promised to a bill is not money you can spend.
  `CREATE TABLE IF NOT EXISTS scheduled_items (
     id                         TEXT PRIMARY KEY,
     kind                       TEXT NOT NULL CHECK (kind IN ('bill','income')),
     name                       TEXT NOT NULL,
     amount                     INTEGER NOT NULL CHECK (amount > 0),
     next_due                   TEXT NOT NULL CHECK (next_due LIKE '____-__-__'),
     cadence                    TEXT NOT NULL CHECK (cadence IN
                                  ('daily','weekly','biweekly','semimonthly',
                                   'monthly','quarterly','annual')),
     account_id                 TEXT REFERENCES accounts(id),
     category_id                TEXT REFERENCES accounts(id),
     active                     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
     -- What this is supposed to cost, so a charge above it can be noticed.
     expected_amount            INTEGER NOT NULL DEFAULT 0,
     last_amount                INTEGER,
     last_billed_date           TEXT,
     dormant_alert_dismissed_at TEXT
   );`,

  // Money you paid out that somebody else owes you back.
  `CREATE TABLE IF NOT EXISTS claims (
     id           TEXT PRIMARY KEY,
     counterparty TEXT NOT NULL,
     kind         TEXT NOT NULL CHECK (kind IN
                    ('work_expense','shared_with_friends','insurance','other')),
     expected     INTEGER NOT NULL CHECK (expected > 0),
     settled      INTEGER NOT NULL DEFAULT 0,
     status       TEXT NOT NULL CHECK (status IN
                    ('open','partly_settled','settled','written_off')),
     opened_on    TEXT NOT NULL CHECK (opened_on LIKE '____-__-__'),
     note         TEXT
   );`,

  // Statement rows waiting for a quick look. Ephemeral by design: once a row
  // is confirmed it becomes a journal entry, and the queue empties.
  `CREATE TABLE IF NOT EXISTS staged_transactions (
     id          TEXT PRIMARY KEY,
     account_id  TEXT NOT NULL REFERENCES accounts(id),
     date        TEXT NOT NULL CHECK (date LIKE '____-__-__'),
     amount      INTEGER NOT NULL CHECK (amount <> 0),
     description TEXT NOT NULL,
     raw         TEXT NOT NULL,
     dedupe_key  TEXT NOT NULL UNIQUE,
     status      TEXT NOT NULL CHECK (status IN ('unreviewed','reviewed','ignored')),
     entry_id    TEXT REFERENCES entries(id),
     imported_at TEXT NOT NULL,
     batch_id    TEXT NOT NULL
   );`,

  // v10. What an illiquid thing is reckoned to be worth, and when somebody
  // last looked. The journal holds the arithmetic; this holds the story.
  `CREATE TABLE IF NOT EXISTS valuations (
     id         TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id),
     date       TEXT NOT NULL CHECK (date LIKE '____-__-__'),
     value      INTEGER NOT NULL,
     cost_basis INTEGER,
     notes      TEXT,
     entry_id   TEXT REFERENCES entries(id),
     created_at TEXT NOT NULL
   );`,

  // v11. What is actually held in an investment account: the securities, the
  // share counts, what they cost, and what they are worth on a given day.
  `CREATE TABLE IF NOT EXISTS securities (
     id               TEXT PRIMARY KEY,
     symbol           TEXT NOT NULL,
     name             TEXT NOT NULL,
     isin             TEXT,
     asset_class      TEXT NOT NULL,
     currency         TEXT NOT NULL DEFAULT 'EUR',
     expense_ratio_bp INTEGER NOT NULL DEFAULT 0,
     created_at       TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS holdings (
     id           TEXT PRIMARY KEY,
     account_id   TEXT NOT NULL REFERENCES accounts(id),
     security_id  TEXT NOT NULL REFERENCES securities(id),
     quantity_1e8 INTEGER NOT NULL,
     cost_basis   INTEGER NOT NULL,
     created_at   TEXT NOT NULL,
     updated_at   TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS security_prices (
     id          TEXT PRIMARY KEY,
     security_id TEXT NOT NULL REFERENCES securities(id),
     date        TEXT NOT NULL,
     price_minor INTEGER NOT NULL,
     source      TEXT NOT NULL DEFAULT 'manual',
     created_at  TEXT NOT NULL
   );`,

  // v12. Share parcels, what was traded, and what the portfolio is meant to
  // look like.
  // v15. What each loan payment came to, and what you were worth over time.
  `CREATE TABLE IF NOT EXISTS loan_payments (
     id                TEXT PRIMARY KEY,
     account_id        TEXT NOT NULL REFERENCES accounts(id),
     entry_id          TEXT NOT NULL REFERENCES entries(id),
     payment_number    INTEGER NOT NULL,
     date              TEXT NOT NULL,
     total_payment     INTEGER NOT NULL,
     principal_amount  INTEGER NOT NULL,
     interest_amount   INTEGER NOT NULL,
     escrow_amount     INTEGER NOT NULL DEFAULT 0,
     extra_principal   INTEGER NOT NULL DEFAULT 0,
     remaining_balance INTEGER NOT NULL,
     created_at        TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS net_worth_snapshots (
     id                TEXT PRIMARY KEY,
     date              TEXT NOT NULL UNIQUE,
     total_assets      INTEGER NOT NULL,
     total_liabilities INTEGER NOT NULL,
     net_worth         INTEGER NOT NULL,
     created_at        TEXT NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS idx_loan_payments_account ON loan_payments(account_id, payment_number ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_loan_payments_entry ON loan_payments(entry_id);`,
  `CREATE INDEX IF NOT EXISTS idx_nw_snapshots_date ON net_worth_snapshots(date ASC);`,

  // v14. Historical exchange rates, quote-per-base.
  `CREATE TABLE IF NOT EXISTS fx_rates (
     id             TEXT PRIMARY KEY,
     base_currency  TEXT NOT NULL,
     quote_currency TEXT NOT NULL,
     rate_scaled    INTEGER NOT NULL,
     date           TEXT NOT NULL,
     source         TEXT NOT NULL DEFAULT 'manual',
     created_at     TEXT NOT NULL
   );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_rates_pair_date ON fx_rates(base_currency, quote_currency, date);`,
  `CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup ON fx_rates(quote_currency, date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_postings_base_book ON postings(book, base_amount);`,

  // v16. Checking an account against its statement.
  `CREATE TABLE IF NOT EXISTS reconciliations (
     id                TEXT PRIMARY KEY,
     account_id        TEXT NOT NULL REFERENCES accounts(id),
     statement_date    TEXT NOT NULL CHECK (statement_date LIKE '____-__-__'),
     statement_balance INTEGER NOT NULL,
     cleared_balance   INTEGER NOT NULL,
     discrepancy       INTEGER NOT NULL DEFAULT 0,
     status            TEXT NOT NULL DEFAULT 'completed'
                         CHECK (status IN ('completed','reconciled_with_adjustment')),
     created_at        TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliations_account_date
     ON reconciliations(account_id, statement_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_postings_clearance
     ON postings(account_id, clearance, reconciled_at);`,

  `CREATE TABLE IF NOT EXISTS tax_lots (
     id                     TEXT PRIMARY KEY,
     account_id             TEXT NOT NULL REFERENCES accounts(id),
     security_id            TEXT NOT NULL REFERENCES securities(id),
     holding_id             TEXT NOT NULL REFERENCES holdings(id),
     acquired_date          TEXT NOT NULL,
     quantity_1e8           INTEGER NOT NULL,
     remaining_quantity_1e8 INTEGER NOT NULL,
     cost_basis_minor       INTEGER NOT NULL,
     is_closed              INTEGER NOT NULL DEFAULT 0,
     created_at             TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS investment_trades (
     id                  TEXT PRIMARY KEY,
     account_id          TEXT NOT NULL REFERENCES accounts(id),
     security_id         TEXT NOT NULL REFERENCES securities(id),
     trade_type          TEXT NOT NULL,
     date                TEXT NOT NULL,
     quantity_1e8        INTEGER NOT NULL DEFAULT 0,
     price_minor         INTEGER NOT NULL DEFAULT 0,
     gross_amount_minor  INTEGER NOT NULL,
     fees_minor          INTEGER NOT NULL DEFAULT 0,
     realized_gain_minor INTEGER,
     entry_id            TEXT REFERENCES entries(id),
     created_at          TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS target_allocations (
     id          TEXT PRIMARY KEY,
     asset_class TEXT NOT NULL UNIQUE,
     target_bp   INTEGER NOT NULL,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS idx_tax_lots_lookup ON tax_lots(account_id, security_id, is_closed, acquired_date ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_tax_lots_holding ON tax_lots(holding_id);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_account_date ON investment_trades(account_id, date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_trades_security ON investment_trades(security_id, date DESC);`,

  `CREATE UNIQUE INDEX IF NOT EXISTS uq_securities_symbol ON securities(symbol);`,
  `CREATE INDEX IF NOT EXISTS idx_securities_class ON securities(asset_class);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_holdings_account_security ON holdings(account_id, security_id);`,
  `CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);`,
  `CREATE INDEX IF NOT EXISTS idx_security_prices_lookup ON security_prices(security_id, date DESC);`,

  `CREATE INDEX IF NOT EXISTS idx_valuations_account_date ON valuations(account_id, date DESC);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_valuations_account_day ON valuations(account_id, date);`,

  `CREATE INDEX IF NOT EXISTS staged_status_idx ON staged_transactions(status);`,
  `CREATE INDEX IF NOT EXISTS idx_rules_active_priority ON rules(active, priority ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_book_type ON accounts(book, type, archived_at);`,
  `CREATE INDEX IF NOT EXISTS scheduled_due_idx ON scheduled_items(next_due);`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_active_due ON scheduled_items(active, next_due ASC);`,
  `CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status);`,
  `CREATE INDEX IF NOT EXISTS entries_claim_idx ON entries(claim_id);`,
  `CREATE INDEX IF NOT EXISTS entries_date_idx ON entries(date);`,
  `CREATE INDEX IF NOT EXISTS postings_account_idx ON postings(account_id);`,
  `CREATE INDEX IF NOT EXISTS postings_entry_idx ON postings(entry_id);`,

  `INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
];
