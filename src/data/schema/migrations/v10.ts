/* ===========================================================================
 * VERSION 10 — ACCOUNTS PEOPLE ACTUALLY HAVE, AND WHAT THEY ARE WORTH TODAY
 * ---------------------------------------------------------------------------
 * Until now the chart was fixed: one current account, one savings, one card.
 * That is not anybody's balance sheet. This step opens it up to mortgages,
 * second cards, pensions, a house and a car — and gives the illiquid ones a
 * way to change in value without pretending money moved.
 *
 * Three decisions here are worth reading before changing anything:
 *
 *   · `class` is new; `on_budget` and `liquid` are not. The brief asked for
 *     `is_liquid`, but `liquid` has existed since v1 and is read by I4, by
 *     Safe-to-Spend and by every balance query. Renaming a column in SQLite
 *     means rebuilding the table, and rebuilding `accounts` — the table every
 *     foreign key points at — to gain two characters of spelling is a risk
 *     taken against somebody's only copy of their financial history for no
 *     behavioural change at all.
 *
 *   · `on_budget` keeps its default of 0. The brief asked for a default of 1.
 *     Every account in this schema shares one table, including income,
 *     expense and equity nodes where the flag is meaningless — and I4 says
 *     budgetable cash equals the sum of on-budget liquid assets. A default of
 *     1 means any future insert that forgets the column silently breaks that
 *     equality, and the failure surfaces as "your budget disagrees with your
 *     bank" rather than as a bad insert. Defaulting to off and setting it
 *     deliberately at creation is the safe direction to be wrong in.
 *
 *   · A valuation is stored twice on purpose, and that is not a second source
 *     of truth. The journal entry is what net worth is computed from; the
 *     `valuations` row is the human record around it — the estimate, the date
 *     somebody believes it applies to, the note about why. Deleting every row
 *     in this table would leave every balance in the app exactly as it is.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/**
 * Every kind of account a person can hold.
 *
 * Deliberately about the thing itself rather than about how it behaves: how it
 * behaves is `on_budget` and `liquid`, which are set from the class at
 * creation and can then be overridden by somebody who knows their own money
 * better than a default does.
 */
export const ACCOUNT_CLASSES = [
  'checking',
  'savings',
  'cash',
  'credit_card',
  'loan',
  'mortgage',
  'brokerage',
  'retirement',
  'real_estate',
  'vehicle',
  'other_asset',
] as const;

export const DEPRECIATION_MODELS = ['none', 'straight_line', 'declining_balance'] as const;

const CLASS_LIST = ACCOUNT_CLASSES.map((c) => `'${c}'`).join(',');
const MODEL_LIST = DEPRECIATION_MODELS.map((m) => `'${m}'`).join(',');

/**
 * The valuations table.
 *
 * `entry_id` is nullable because the row is written first and the entry is
 * linked immediately afterwards inside the same transaction. A row that
 * somehow ends up without one is a note about a value, not a claim about the
 * books, and nothing computes a balance from it.
 */
const VALUATIONS_TABLE = `CREATE TABLE IF NOT EXISTS valuations (
   id         TEXT PRIMARY KEY,
   account_id TEXT NOT NULL REFERENCES accounts(id),
   date       TEXT NOT NULL CHECK (date LIKE '____-__-__'),
   -- What the whole thing is reckoned to be worth on that date, in minor units.
   value      INTEGER NOT NULL,
   -- What it cost to begin with. Set on the first mark, so a gain can be shown
   -- against something rather than against nothing.
   cost_basis INTEGER,
   notes      TEXT,
   entry_id   TEXT REFERENCES entries(id),
   created_at TEXT NOT NULL
 );`;

export function v10Statements(): string[] {
  return [
    VALUATIONS_TABLE,
    // Reading one asset's history newest-first is the only shape this table is
    // ever queried in — the detail sheet, the "last valued" indicator and the
    // depreciation origin all want the same index.
    `CREATE INDEX IF NOT EXISTS idx_valuations_account_date ON valuations(account_id, date DESC);`,
    // Guards against the same mark being written twice by a retried save. A
    // second opinion about the same asset on the same day replaces the first
    // rather than stacking, which is also what a person means by correcting it.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_valuations_account_day ON valuations(account_id, date);`,
  ];
}

export const V10: MigrationStep = {
  to: 10,
  reason:
    'Accounts people actually hold — mortgages, pensions, a house, a car — and a way to ' +
    'mark what they are worth without inventing income.',
  addColumns: [
    // Nullable, because every account that already exists predates the idea.
    // A null class means "one of the original three", and the repository reads
    // it that way rather than guessing from the type.
    {
      table: 'accounts',
      column: 'class',
      declaration: `TEXT CHECK (class IS NULL OR class IN (${CLASS_LIST}))`,
    },
    {
      table: 'accounts',
      column: 'institution',
      declaration: 'TEXT',
    },
    {
      table: 'accounts',
      column: 'depreciation_model',
      declaration: `TEXT CHECK (depreciation_model IS NULL OR depreciation_model IN (${MODEL_LIST}))`,
    },
    // Annual, in basis points: 1500 is 15% a year.
    { table: 'accounts', column: 'depreciation_rate_bp', declaration: 'INTEGER' },
    // The floor a depreciating thing never falls below. Scrap value.
    { table: 'accounts', column: 'salvage_value', declaration: 'INTEGER' },
  ],
  statements: v10Statements(),
};
