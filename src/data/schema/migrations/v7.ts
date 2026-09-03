/* ===========================================================================
 * VERSION 7 — MAKING THE LEDGER SEARCHABLE
 * ---------------------------------------------------------------------------
 * Until now Sovereign could record a payment and never find it again. This is
 * the index behind "what did I spend at that restaurant in March".
 *
 * Two things in the brief could not be built as written, and both are worth
 * stating plainly rather than quietly working around:
 *
 *   · The proposed FTS table was `fts5(description, memo, content='entries')`.
 *     External-content FTS5 reads its columns straight out of the content
 *     table, and `entries` has no `memo` column — memos live on `postings`.
 *     Splitting makes that structural rather than incidental: one entry has
 *     one description and, after this slice, several line notes. So this is a
 *     standalone FTS5 table whose `memo` column is the entry's notes gathered
 *     together, kept in step by triggers on both tables.
 *
 *   · The proposed index `postings(category_id, entry_id)` cannot be created:
 *     `postings` has no `category_id`. A category *is* an account here — the
 *     EXPENSE one — so `(account_id, entry_id)` already is that index, and it
 *     is created once rather than twice under two names.
 *
 * FTS5 is compiled into the WASM binary we ship (ENABLE_FTS5 is present in
 * it), so the fallback below is defensive rather than expected. It exists
 * because a future binary swap should degrade to slower search rather than to
 * a database that will not open.
 * ======================================================================== */

import type { MigrationStep } from '../migrations';

/** What the engine underneath us can actually do. */
export interface SchemaCapabilities {
  fts5: boolean;
}

/** Ask SQLite what it was built with. */
export const COMPILE_OPTIONS_SQL = `PRAGMA compile_options`;

/** Read the pragma's rows and decide whether real full-text search is on offer. */
export function detectFts5(rows: readonly (readonly unknown[])[]): boolean {
  return rows.some((row) => String(row[0] ?? '').toUpperCase().includes('ENABLE_FTS5'));
}

/**
 * The whole search schema, as statements that are safe to run again.
 *
 * Idempotent on purpose: a fresh database gets these after its DDL, an
 * upgraded one gets them inside the migration, and running both is a no-op.
 */
export function searchSchemaStatements(caps: SchemaCapabilities): string[] {
  const indexes = [
    // Ordering and windowing the ledger by date is the single most common
    // query in the app after this slice.
    `CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date DESC, created_at DESC);`,
    // Covers "everything that touched this account", which is how both the
    // account filter and every balance aggregate reach the journal.
    `CREATE INDEX IF NOT EXISTS idx_postings_account_entry ON postings(account_id, entry_id);`,
    // The other direction: assembling one entry's lines for a detail view.
    `CREATE INDEX IF NOT EXISTS idx_postings_entry_book ON postings(entry_id, book);`,
  ];

  if (!caps.fts5) {
    return [
      ...indexes,
      // Without FTS5 the description search falls back to LIKE, which this
      // index can at least serve for prefix matches.
      `CREATE INDEX IF NOT EXISTS idx_entries_desc ON entries(description);`,
    ];
  }

  return [
    ...indexes,

    `CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
       entry_id UNINDEXED,
       description,
       memo,
       tokenize = 'unicode61 remove_diacritics 2'
     );`,

    /* --- entries keep their description in step --------------------------- */

    `CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
       INSERT INTO entries_fts(rowid, entry_id, description, memo)
       VALUES (NEW.rowid, NEW.id, NEW.description, '');
     END;`,

    `CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
       UPDATE entries_fts SET description = NEW.description, entry_id = NEW.id
        WHERE rowid = NEW.rowid;
     END;`,

    `CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
       DELETE FROM entries_fts WHERE rowid = OLD.rowid;
     END;`,

    /* --- postings carry the notes, so they keep the memo column in step ---- */

    `CREATE TRIGGER IF NOT EXISTS postings_fts_ai AFTER INSERT ON postings BEGIN
       UPDATE entries_fts
          SET memo = COALESCE(
                (SELECT group_concat(p.memo, ' ') FROM postings p
                  WHERE p.entry_id = NEW.entry_id AND p.memo IS NOT NULL), '')
        WHERE rowid = (SELECT e.rowid FROM entries e WHERE e.id = NEW.entry_id);
     END;`,

    `CREATE TRIGGER IF NOT EXISTS postings_fts_au AFTER UPDATE ON postings BEGIN
       UPDATE entries_fts
          SET memo = COALESCE(
                (SELECT group_concat(p.memo, ' ') FROM postings p
                  WHERE p.entry_id = NEW.entry_id AND p.memo IS NOT NULL), '')
        WHERE rowid = (SELECT e.rowid FROM entries e WHERE e.id = NEW.entry_id);
     END;`,

    `CREATE TRIGGER IF NOT EXISTS postings_fts_ad AFTER DELETE ON postings BEGIN
       UPDATE entries_fts
          SET memo = COALESCE(
                (SELECT group_concat(p.memo, ' ') FROM postings p
                  WHERE p.entry_id = OLD.entry_id AND p.memo IS NOT NULL), '')
        WHERE rowid = (SELECT e.rowid FROM entries e WHERE e.id = OLD.entry_id);
     END;`,

    /* --- everything recorded before today gets indexed once ---------------- */

    // Only when the index is empty and the journal is not, so re-running this
    // on an already-indexed database cannot double up.
    `INSERT INTO entries_fts(rowid, entry_id, description, memo)
       SELECT e.rowid, e.id, e.description,
              COALESCE((SELECT group_concat(p.memo, ' ') FROM postings p
                         WHERE p.entry_id = e.id AND p.memo IS NOT NULL), '')
         FROM entries e
        WHERE NOT EXISTS (SELECT 1 FROM entries_fts);`,
  ];
}

export const V7: MigrationStep = {
  to: 7,
  reason: 'Search across everything recorded, by merchant, note, amount or date.',
  plan: searchSchemaStatements,
};
