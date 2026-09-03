/* ===========================================================================
 * VERSION 8 — THE TAXONOMY BECOMES THE USER'S
 * ---------------------------------------------------------------------------
 * Until now the eight spending categories were a TypeScript literal. No two
 * households share a chart of accounts, so "no way to add Childcare" is not a
 * missing feature so much as a disqualification. This migration makes the
 * chart data rather than code, and gives it a shape: groups above categories,
 * mirrored across both books so a budget can roll up by group.
 *
 * Two departures from the brief, both deliberate:
 *
 *   · `createCategory` was specified as taking `colorToken` and `icon`, but no
 *     columns were listed to put them in. They are added here, because a
 *     signature that accepts something it cannot store is worse than either
 *     having the columns or not offering the arguments.
 *
 *   · `archived_at` overlaps with the `status` column that has existed since
 *     v1. Rather than introduce a second source of truth, both are written
 *     together in one place (`archiveCategory`), and everything that filters
 *     reads `archived_at IS NULL`. The timestamp answers "when", which the
 *     enum never could.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/* --- the groups this upgrade creates -------------------------------------- */

export interface GroupSeed {
  categoryId: string;
  envelopeId: string;
  name: string;
  /** The seeded categories that move underneath it. */
  children: string[];
  sortOrder: number;
}

/**
 * Somewhere sensible to put the eight categories that already exist.
 *
 * These are a starting point, not a fixed structure — every one of them can be
 * renamed, added to or archived once the manager screen exists.
 */
export const DEFAULT_GROUPS: GroupSeed[] = [
  {
    categoryId: 'grp-essential',
    envelopeId: 'grp-pot-essential',
    name: 'Essential living',
    children: ['cat-groceries', 'cat-home', 'cat-bills'],
    sortOrder: 10,
  },
  {
    categoryId: 'grp-lifestyle',
    envelopeId: 'grp-pot-lifestyle',
    name: 'Lifestyle and personal',
    children: ['cat-eating-out', 'cat-shopping', 'cat-fun'],
    sortOrder: 20,
  },
  {
    categoryId: 'grp-transit',
    envelopeId: 'grp-pot-transit',
    name: 'Getting around and health',
    children: ['cat-transport', 'cat-health'],
    sortOrder: 30,
  },
];

const RULES_TABLE = `CREATE TABLE IF NOT EXISTS rules (
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
 );`;

/**
 * Everything v8 adds, as statements safe to run twice.
 *
 * The group rows use INSERT OR IGNORE and the parent links are only written
 * where none is set, so an interrupted upgrade followed by a retry cannot
 * duplicate a group or overwrite a structure the person has since changed.
 */
export function taxonomyStatements(): string[] {
  const groups: string[] = [];

  for (const group of DEFAULT_GROUPS) {
    // The FINANCIAL side: a parent expense account nothing posts to.
    groups.push(
      `INSERT OR IGNORE INTO accounts
         (id, book, type, name, normal, status, on_budget, liquid, sort_order)
       VALUES ('${group.categoryId}', 'FINANCIAL', 'EXPENSE', '${group.name}',
               'DEBIT', 'active', 0, 0, ${group.sortOrder});`,
    );
    // The BUDGET side, so a rollup by group is one query rather than a join
    // through the other book.
    groups.push(
      `INSERT OR IGNORE INTO accounts
         (id, book, type, name, normal, status, on_budget, liquid, sort_order, envelope_role)
       VALUES ('${group.envelopeId}', 'BUDGET', 'ENVELOPE', '${group.name}',
               'CREDIT', 'active', 0, 0, ${group.sortOrder}, 'group');`,
    );

    for (const child of group.children) {
      groups.push(
        `UPDATE accounts SET parent_id = '${group.categoryId}'
          WHERE id = '${child}' AND parent_id IS NULL;`,
      );
      // The paired envelope for 'cat-x' is 'pot-x' in the seeded chart.
      groups.push(
        `UPDATE accounts SET parent_id = '${group.envelopeId}'
          WHERE id = '${child.replace(/^cat-/, 'pot-')}' AND parent_id IS NULL;`,
      );
    }
  }

  return [
    RULES_TABLE,
    `CREATE INDEX IF NOT EXISTS idx_rules_active_priority ON rules(active, priority ASC);`,
    `CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_id);`,
    `CREATE INDEX IF NOT EXISTS idx_accounts_book_type ON accounts(book, type, archived_at);`,
    ...groups,
  ];
}

export const V8: MigrationStep = {
  to: 8,
  reason: 'Categories you own: groups, custom categories, and rules that file for you.',
  addColumns: [
    { table: 'accounts', column: 'archived_at', declaration: 'TEXT' },
    { table: 'accounts', column: 'color_token', declaration: 'TEXT' },
    { table: 'accounts', column: 'icon', declaration: 'TEXT' },
  ],
  statements: taxonomyStatements(),
};
