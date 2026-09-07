/* ===========================================================================
 * TAGS, STORED
 * ---------------------------------------------------------------------------
 * Reading and writing labels. Nothing here computes anything: a tag never
 * takes part in a total, so there is no arithmetic to get wrong — only joins.
 *
 * The one thing worth reading carefully is `ensureTag`. Typing a tag that
 * already exists has to add to it rather than fail, and the check for that has
 * to be the database's rather than a query followed by an insert: two taps in
 * quick succession would both read "not there" and the second insert would be
 * refused. `ON CONFLICT (slug) DO UPDATE` makes the whole thing one statement
 * that always ends with a row, whichever way it went.
 * ======================================================================== */

import { inArray, sql } from 'drizzle-orm';
import { assertUsableTagName, tagSlug } from '@/core/taxonomy/tags';
import type { EntryId } from '@/core/ledger';
import { db, runBatch } from '../client';
import { entryTags, tags } from '../schema/tables';

/** Changing any of these should re-run a query that reads tags. */
export const TAG_TABLES = ['tags', 'entry_tags'] as const;

export interface TagRecord {
  id: string;
  name: string;
  slug: string;
  /** How many payments carry it. Zero is normal for a tag just created. */
  usedOn: number;
}

/**
 * Every tag, with how many payments carry it.
 *
 * Ordered by use rather than alphabetically: the tag somebody is in the middle
 * of using is the one they want next, and an alphabetical list buries it under
 * whatever they named a holiday in 2023.
 */
export async function listTags(): Promise<TagRecord[]> {
  const rows = (await db.all(
    sql`SELECT t.id, t.name, t.slug, count(et.entry_id) AS used_on
          FROM tags t
          LEFT JOIN entry_tags et ON et.tag_id = t.id
         GROUP BY t.id, t.name, t.slug
         ORDER BY used_on DESC, t.name COLLATE NOCASE ASC`,
  )) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    id: String(row[0]),
    name: String(row[1]),
    slug: String(row[2]),
    usedOn: Number(row[3]),
  }));
}

/**
 * Find the tag with this name, or make it.
 *
 * Returns the id *and the stored name*, which are not always the name that was
 * typed. Somebody typing "italy 2026" into a tag they first created as
 * "Italy 2026" gets the existing one, and the confirmation afterwards has to
 * say "Italy 2026" — naming it back in the casing they happened to use this
 * time would quietly suggest a second tag had been made.
 */
export async function ensureTag(rawName: string): Promise<{ id: string; name: string }> {
  const name = assertUsableTagName(rawName);
  const slug = tagSlug(name);
  const id = `tag-${crypto.randomUUID()}`;

  await runBatch([
    {
      // The update does nothing to the stored name on purpose. Somebody typing
      // "italy 2026" into a tag they first created as "Italy 2026" means to
      // use the existing one, not to rename it — renaming is its own action,
      // done deliberately, from the tag list.
      sql: `INSERT INTO tags (id, name, slug, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET slug = excluded.slug`,
      params: [id, name, slug, new Date().toISOString()],
    },
  ]);

  const rows = (await db.all(
    sql`SELECT id, name FROM tags WHERE slug = ${slug}`,
  )) as unknown as Record<number, unknown>[];

  const found = rows[0];
  if (found === undefined || found[0] === undefined) {
    throw new Error(`${name} could not be saved just now, so nothing has been tagged.`);
  }
  return { id: String(found[0]), name: String(found[1]) };
}

/**
 * Put a tag on some payments.
 *
 * Returns how many were actually newly tagged, which is what the confirmation
 * counts out loud — "tagged 14" when three of the seventeen already had it
 * would be a lie somebody could not check.
 */
export async function tagEntries(entryIds: readonly EntryId[], tagId: string): Promise<number> {
  if (entryIds.length === 0) return 0;

  const before = await countTagged(entryIds, tagId);

  await runBatch(
    entryIds.map((entryId) => ({
      // OR IGNORE rather than a check: tagging something already tagged is a
      // no-op, not a failure, and the primary key is what makes it one.
      sql: `INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)`,
      params: [entryId, tagId],
    })),
  );

  return (await countTagged(entryIds, tagId)) - before;
}

/** Take a tag off some payments. Returns how many actually lost it. */
export async function untagEntries(entryIds: readonly EntryId[], tagId: string): Promise<number> {
  if (entryIds.length === 0) return 0;

  const before = await countTagged(entryIds, tagId);

  await runBatch(
    entryIds.map((entryId) => ({
      sql: `DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?`,
      params: [entryId, tagId],
    })),
  );

  return before - (await countTagged(entryIds, tagId));
}

async function countTagged(entryIds: readonly EntryId[], tagId: string): Promise<number> {
  const rows = await db
    .select({ entryId: entryTags.entryId })
    .from(entryTags)
    .where(sql`${entryTags.tagId} = ${tagId} AND ${inArray(entryTags.entryId, [...entryIds])}`);
  return rows.length;
}

/** Which tags are on each of these payments. */
export async function tagsForEntries(
  entryIds: readonly EntryId[],
): Promise<Map<EntryId, TagRecord[]>> {
  const result = new Map<EntryId, TagRecord[]>();
  if (entryIds.length === 0) return result;

  const rows = await db
    .select({
      entryId: entryTags.entryId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(entryTags)
    .innerJoin(tags, sql`${tags.id} = ${entryTags.tagId}`)
    .where(inArray(entryTags.entryId, [...entryIds]))
    .orderBy(tags.name);

  for (const row of rows) {
    const id = row.entryId as EntryId;
    const list = result.get(id) ?? [];
    // `usedOn` is not asked for here. This answers "what is on this payment?",
    // and counting every tag's whole use across the ledger to render a chip
    // would be a join nobody reads.
    list.push({ id: row.id, name: row.name, slug: row.slug, usedOn: 0 });
    result.set(id, list);
  }
  return result;
}

/**
 * Rename a tag.
 *
 * The slug moves with the name, so a tag renamed to match an existing one is
 * refused by the database rather than silently merged. Merging two tags is a
 * different act with a different confirmation, and doing it by accident while
 * fixing a typo would be a poor surprise.
 */
export async function renameTag(tagId: string, rawName: string): Promise<void> {
  const name = assertUsableTagName(rawName);
  const slug = tagSlug(name);

  const clash = (await db.all(
    sql`SELECT name FROM tags WHERE slug = ${slug} AND id <> ${tagId}`,
  )) as unknown as Record<number, unknown>[];

  const taken = clash[0]?.[0];
  if (taken !== undefined) {
    // Named as it is actually stored, not as it was just typed. Saying "there
    // is already a tag called italy 2026" to somebody who cannot find one
    // spelled that way sends them looking for a tag that does not exist.
    throw new Error(
      `There is already a tag called ${String(taken)}. Pick a different name, or take this ` +
        `one off the payments and use the other.`,
    );
  }

  await runBatch([
    { sql: `UPDATE tags SET name = ?, slug = ? WHERE id = ?`, params: [name, slug, tagId] },
  ]);
}

/**
 * Delete a tag.
 *
 * Its labels go with it — the foreign key cascades — and every payment stays
 * exactly as it was. Nothing that carries an amount is touched, because
 * nothing that carries an amount was ever joined to it.
 */
export async function deleteTag(tagId: string): Promise<void> {
  await runBatch([{ sql: `DELETE FROM tags WHERE id = ?`, params: [tagId] }]);
}
