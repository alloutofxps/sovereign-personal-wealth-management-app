/* ===========================================================================
 * VERSION 18 — LABELS THAT CUT ACROSS EVERYTHING
 * ---------------------------------------------------------------------------
 * Categories answer "what was this money for?", and a payment has exactly one
 * answer. Tags answer "what was this part of?", and a payment can be part of
 * several things at once: the Italy trip, the kitchen, the pile your sister
 * owes you half of.
 *
 * Two tables rather than a column on `entries`, because it is genuinely
 * many-to-many. A comma-separated column would work until the first time
 * somebody renamed a tag, at which point every row holding the old spelling
 * would have to be rewritten, and any row missed would become a second tag
 * that looks identical.
 *
 * ---------------------------------------------------------------------------
 * THE SLUG, AND WHY IT IS UNIQUE
 *
 * `slug` is the lower-cased, punctuation-stripped form of the name, and the
 * uniqueness lives there rather than on `name`. Without it, "Italy 2026" and
 * "italy 2026" are two tags, and somebody who capitalises differently on a
 * Tuesday quietly splits a year of holiday spending in half. The database
 * refuses the second one, and the repository turns that refusal into finding
 * the first — so typing an existing tag adds to it instead of failing.
 *
 * `name` keeps whatever was typed. NYC is not Nyc.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TABLES MAY NEVER DO
 *
 * Nothing in this schema joins a tag to a posting, an amount or an envelope,
 * and nothing ever should. A tag that could hold money back would be a second
 * budgeting system running beside the first, and the two would disagree.
 * See the note at the top of core/taxonomy/tags.ts.
 *
 * ---------------------------------------------------------------------------
 * ON CASCADE
 *
 * Both foreign keys cascade, and `PRAGMA foreign_keys = ON` is in the
 * bootstrap, so this is real rather than decorative. Deleting a tag takes its
 * labels with it and leaves every payment exactly as it was. Nothing in this
 * app deletes an entry — corrections are reversals — but if that ever changes,
 * a label pointing at an entry that no longer exists would be a row nothing
 * could render.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

export const TAGS_TABLE = `CREATE TABLE IF NOT EXISTS tags (
   id         TEXT PRIMARY KEY,
   -- As typed. Case and spacing are the person's own.
   name       TEXT NOT NULL,
   -- What two spellings of the same tag agree on. See tagSlug().
   slug       TEXT NOT NULL UNIQUE,
   created_at TEXT NOT NULL
 );`;

export const ENTRY_TAGS_TABLE = `CREATE TABLE IF NOT EXISTS entry_tags (
   entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
   tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
   -- One label per payment per tag. Tagging something twice is not an error,
   -- it is a no-op, and the primary key is what makes it one.
   PRIMARY KEY (entry_id, tag_id)
 );`;

export function v18Statements(): string[] {
  return [
    TAGS_TABLE,
    ENTRY_TAGS_TABLE,
    // The primary key already covers (entry_id, tag_id), which answers "what
    // is on this payment?". This one answers the other direction — "what is
    // tagged Italy?" — which is the query the filter actually runs.
    `CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id, entry_id);`,
  ];
}

export const V18: MigrationStep = {
  to: 18,
  reason: 'Labels you can put across payments that have nothing else in common.',
  statements: v18Statements(),
};
