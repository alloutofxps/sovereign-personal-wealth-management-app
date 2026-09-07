/* ===========================================================================
 * VERSION 19 — WHAT-IFS, KEPT WELL AWAY FROM THE LEDGER
 * ---------------------------------------------------------------------------
 * Two tables for hypothetical money, and the important thing about them is
 * where they are *not*.
 *
 * The obvious design is a `branch_id` column on `entries`, null for the real
 * ones. It is the wrong design, and dangerously so: every query in this
 * application would then need `WHERE branch_id IS NULL`, forever, including
 * every query written in future by somebody who has not read this comment. The
 * first one anybody forgets is money that never existed appearing in what
 * somebody is worth.
 *
 * So a branch entry is not in `entries`, and its postings are not in
 * `postings`. They live here, and the postings ride as a JSON payload rather
 * than as rows. That is a real cost — a branch cannot be read by the ordinary
 * entry queries, joined against accounts, or indexed by account — and it buys
 * the one guarantee worth having: there is no query over the real ledger that
 * *could* return a hypothetical posting, however carelessly it is written.
 *
 * A branch is a sketch. The ledger is the record. They do not share a table.
 *
 * ---------------------------------------------------------------------------
 * WHY `diverges_on` IS NOT NULLABLE
 *
 * A branch is an alternative future, never an alternative past. Letting one
 * start before today would rewrite months that have already been checked
 * against a bank statement and locked, and would answer a question nobody
 * asked. The column is required, and `checkBranch` refuses any entry dated
 * before it.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

export const BRANCHES_TABLE = `CREATE TABLE IF NOT EXISTS branches (
   id           TEXT PRIMARY KEY,
   name         TEXT NOT NULL,
   -- Nothing before this date differs from what actually happened.
   diverges_on  TEXT NOT NULL CHECK (diverges_on LIKE '____-__-__'),
   note         TEXT,
   created_at   TEXT NOT NULL
 );`;

/**
 * One hypothetical event.
 *
 * `postings` is JSON on purpose; see the note at the top. It is validated by
 * `checkBranch` on the way out, not by a constraint here — SQLite cannot check
 * that a set of amounts sums to nothing, and pretending otherwise with a
 * trigger would put half the rule in the database and half in the code.
 */
export const BRANCH_ENTRIES_TABLE = `CREATE TABLE IF NOT EXISTS branch_entries (
   id          TEXT PRIMARY KEY,
   branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
   kind        TEXT NOT NULL,
   date        TEXT NOT NULL CHECK (date LIKE '____-__-__'),
   description TEXT NOT NULL,
   postings    TEXT NOT NULL,
   created_at  TEXT NOT NULL
 );`;

export function v19Statements(): string[] {
  return [
    BRANCHES_TABLE,
    BRANCH_ENTRIES_TABLE,
    // Everything a branch view reads, in the order it reads it.
    `CREATE INDEX IF NOT EXISTS idx_branch_entries_branch
       ON branch_entries(branch_id, date);`,
  ];
}

export const V19: MigrationStep = {
  to: 19,
  reason: 'Somewhere to sketch a what-if, kept entirely out of the real ledger.',
  statements: v19Statements(),
};
