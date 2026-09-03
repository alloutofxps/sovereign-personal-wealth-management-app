/* ===========================================================================
 * THE CHART OF ACCOUNTS, AS THE PERSON'S OWN
 * ---------------------------------------------------------------------------
 * A spending category here is two accounts, not one: the EXPENSE account in
 * the financial book that records what was bought, and the ENVELOPE in the
 * budget book that the money is taken from. They are created, renamed, moved
 * and retired together — a category whose two halves have drifted apart is a
 * category whose figures disagree with themselves, and nothing above this file
 * would notice.
 *
 * So every write here is one transaction over both books. That is the whole
 * reason this module exists rather than callers doing it themselves.
 * ======================================================================== */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AccountId } from '@/core/ledger';
import { db, runBatch } from '../client';
import { accounts } from '../schema/tables';

export interface CategoryNode {
  categoryId: AccountId;
  envelopeId: AccountId;
  name: string;
  groupId: AccountId | null;
  colorToken: string | null;
  icon: string | null;
  archivedAt: string | null;
  sortOrder: number;
}

export interface CategoryGroupNode {
  groupId: AccountId;
  envelopeGroupId: AccountId | null;
  name: string;
  sortOrder: number;
  categories: CategoryNode[];
}

export interface Taxonomy {
  groups: CategoryGroupNode[];
  /** Categories with no group yet, which the manager shows last. */
  ungrouped: CategoryNode[];
  /** Flat, for pickers that do not care about the tree. */
  all: CategoryNode[];
}

export const TAXONOMY_TABLES = ['accounts'] as const;

const now = () => new Date().toISOString();

/**
 * The envelope paired with a category.
 *
 * The seeded chart used a naming convention — `cat-groceries` next to
 * `pot-groceries` — and everything created since is explicit. Both are handled
 * by pairing on the shared suffix, so an old chart and a new one behave the
 * same.
 */
function envelopeIdFor(categoryId: string): string {
  return categoryId.startsWith('cat-')
    ? categoryId.replace(/^cat-/, 'pot-')
    : `pot-${categoryId}`;
}

/** The budget-book group node matching a financial-book group. */
function envelopeGroupOf(groupId: string): string {
  return groupId.startsWith('grp-') ? groupId.replace(/^grp-/, 'grp-pot-') : `grp-pot-${groupId}`;
}

/* --- reading -------------------------------------------------------------- */

/**
 * The whole tree: groups, and the categories beneath them.
 *
 * One query over `accounts`, assembled in memory. A personal chart of accounts
 * is tens of rows, not thousands, so a join per group would cost more than it
 * saved.
 */
export async function listTaxonomy(
  options: { includeArchived?: boolean } = {},
): Promise<Taxonomy> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.book, 'FINANCIAL'))
    .orderBy(accounts.sortOrder, accounts.name);

  const envelopes = await db
    .select()
    .from(accounts)
    .where(eq(accounts.book, 'BUDGET'));
  const envelopeById = new Map(envelopes.map((e) => [e.id, e]));

  const expense = rows.filter((r) => r.type === 'EXPENSE');

  /**
   * What makes an account a group.
   *
   * Inferring it from "something points at this" is wrong the moment a group
   * is created and nothing has been put in it yet — an empty group then reads
   * as an ordinary category and shows up in every picker. So the marker is the
   * mirrored envelope's role, which is written when the group is created and
   * does not depend on anything else existing.
   */
  const groupEnvelopes = new Set(
    envelopes.filter((e) => e.envelopeRole === 'group').map((e) => e.id),
  );
  const parentIds = new Set(expense.map((r) => r.parentId).filter(Boolean) as string[]);
  const isGroup = (id: string) => groupEnvelopes.has(envelopeGroupOf(id)) || parentIds.has(id);

  const visible = (row: { archivedAt: string | null }) =>
    options.includeArchived ? true : row.archivedAt === null;

  const toNode = (row: (typeof expense)[number]): CategoryNode => ({
    categoryId: row.id as AccountId,
    envelopeId: envelopeIdFor(row.id) as AccountId,
    name: row.name,
    groupId: (row.parentId as AccountId | null) ?? null,
    colorToken: row.colorToken ?? null,
    icon: row.icon ?? null,
    archivedAt: row.archivedAt ?? null,
    sortOrder: row.sortOrder,
  });

  const leaves = expense.filter((r) => !isGroup(r.id)).filter(visible);

  const groups: CategoryGroupNode[] = expense
    .filter((r) => isGroup(r.id))
    .filter(visible)
    .map((row) => {
      const envelopeGroup = envelopeById.get(envelopeGroupOf(row.id));
      return {
        groupId: row.id as AccountId,
        envelopeGroupId: (envelopeGroup?.id as AccountId | undefined) ?? null,
        name: row.name,
        sortOrder: row.sortOrder,
        categories: leaves.filter((leaf) => leaf.parentId === row.id).map(toNode),
      };
    });

  return {
    groups,
    ungrouped: leaves.filter((leaf) => !leaf.parentId).map(toNode),
    all: leaves.map(toNode),
  };
}

/** Just the categories, flat, for anything that only needs to offer a choice. */
export async function listCategories(
  options: { includeArchived?: boolean } = {},
): Promise<CategoryNode[]> {
  return (await listTaxonomy(options)).all;
}

/** How many payments have ever been filed under this category. */
export async function countEntriesForCategory(categoryId: AccountId): Promise<number> {
  const [row] = await db.all<[number]>(
    sql`SELECT COUNT(DISTINCT entry_id) FROM postings WHERE account_id = ${categoryId}`,
  );
  return Number(row?.[0] ?? 0);
}

/* --- writing -------------------------------------------------------------- */

/** Turn a name into an id stem: "Books & Music" becomes "books-music". */
export function slugify(name: string): string {
  const stem = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  // A name of only punctuation would otherwise produce an empty id.
  return stem || 'category';
}

async function freeId(stem: string): Promise<string> {
  const taken = new Set((await db.select({ id: accounts.id }).from(accounts)).map((r) => r.id));
  if (!taken.has(`cat-${stem}`) && !taken.has(`pot-${stem}`)) return stem;
  for (let n = 2; n < 500; n++) {
    if (!taken.has(`cat-${stem}-${n}`) && !taken.has(`pot-${stem}-${n}`)) return `${stem}-${n}`;
  }
  return `${stem}-${crypto.randomUUID().slice(0, 8)}`;
}

export interface NewCategory {
  name: string;
  groupId?: AccountId | null;
  colorToken?: string;
  icon?: string;
}

/**
 * Create a category, which means creating both of its halves at once.
 *
 * Both inserts and the group links go in a single transaction. Half a category
 * — an expense account with no envelope — would accept spending and then have
 * nowhere to take the money from.
 */
export async function createCategory(input: NewCategory): Promise<CategoryNode> {
  const name = input.name.trim();
  if (!name) throw new Error('A category needs a name.');

  const stem = await freeId(slugify(name));
  const categoryId = `cat-${stem}`;
  const envelopeId = `pot-${stem}`;

  const [maxOrder] = await db.all<[number]>(
    sql`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM accounts WHERE type = 'EXPENSE'`,
  );
  const sortOrder = Number(maxOrder?.[0] ?? 100);

  const expense = db
    .insert(accounts)
    .values({
      id: categoryId,
      book: 'FINANCIAL',
      type: 'EXPENSE',
      name,
      normal: 'DEBIT',
      status: 'active',
      parentId: input.groupId ?? null,
      sortOrder,
      ...(input.colorToken ? { colorToken: input.colorToken } : {}),
      ...(input.icon ? { icon: input.icon } : {}),
    })
    .toSQL();

  const envelope = db
    .insert(accounts)
    .values({
      id: envelopeId,
      book: 'BUDGET',
      type: 'ENVELOPE',
      name,
      normal: 'CREDIT',
      status: 'active',
      envelopeRole: 'category',
      parentId: input.groupId ? envelopeGroupOf(input.groupId) : null,
      sortOrder,
    })
    .toSQL();

  await runBatch([expense, envelope].map((s) => ({ sql: s.sql, params: s.params })));

  return {
    categoryId: categoryId as AccountId,
    envelopeId: envelopeId as AccountId,
    name,
    groupId: input.groupId ?? null,
    colorToken: input.colorToken ?? null,
    icon: input.icon ?? null,
    archivedAt: null,
    sortOrder,
  };
}

export interface NewCategoryGroup {
  name: string;
  sortOrder?: number;
}

/** Create a group, as a parent node in both books. */
export async function createCategoryGroup(
  input: NewCategoryGroup,
): Promise<{ groupId: AccountId; envelopeGroupId: AccountId }> {
  const name = input.name.trim();
  if (!name) throw new Error('A group needs a name.');

  const stem = await freeId(slugify(name));
  const groupId = `grp-${stem}`;
  const envelopeGroupId = `grp-pot-${stem}`;
  const sortOrder = input.sortOrder ?? 100;

  const statements = [
    db
      .insert(accounts)
      .values({
        id: groupId,
        book: 'FINANCIAL',
        type: 'EXPENSE',
        name,
        normal: 'DEBIT',
        status: 'active',
        sortOrder,
      })
      .toSQL(),
    db
      .insert(accounts)
      .values({
        id: envelopeGroupId,
        book: 'BUDGET',
        type: 'ENVELOPE',
        name,
        normal: 'CREDIT',
        status: 'active',
        envelopeRole: 'group',
        sortOrder,
      })
      .toSQL(),
  ];

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
  return { groupId: groupId as AccountId, envelopeGroupId: envelopeGroupId as AccountId };
}

export interface CategoryEdit {
  name?: string;
  groupId?: AccountId | null;
  colorToken?: string | null;
  icon?: string | null;
}

/** Rename or move a category. Both halves move together. */
export async function updateCategory(
  categoryId: AccountId,
  edit: CategoryEdit,
): Promise<void> {
  const envelopeId = envelopeIdFor(categoryId);

  const financial: Record<string, unknown> = {};
  const budget: Record<string, unknown> = {};

  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (!name) throw new Error('A category needs a name.');
    financial.name = name;
    budget.name = name;
  }
  if (edit.groupId !== undefined) {
    financial.parentId = edit.groupId;
    budget.parentId = edit.groupId ? envelopeGroupOf(edit.groupId) : null;
  }
  if (edit.colorToken !== undefined) financial.colorToken = edit.colorToken;
  if (edit.icon !== undefined) financial.icon = edit.icon;

  const statements = [];
  if (Object.keys(financial).length > 0) {
    statements.push(db.update(accounts).set(financial).where(eq(accounts.id, categoryId)).toSQL());
  }
  if (Object.keys(budget).length > 0) {
    statements.push(db.update(accounts).set(budget).where(eq(accounts.id, envelopeId)).toSQL());
  }
  if (statements.length === 0) return;

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
}

/**
 * Retire a category without deleting it.
 *
 * Deleting would orphan every posting that ever pointed at it and change what
 * past months add up to. Archiving keeps the history exactly as it was and
 * only stops the category being offered for what comes next.
 *
 * `archived_at` and `status` are written together here, in the one place that
 * retires anything, so the timestamp and the enum cannot disagree.
 */
export async function archiveCategory(categoryId: AccountId): Promise<void> {
  const stamp = now();
  const envelopeId = envelopeIdFor(categoryId);

  const statements = [categoryId, envelopeId].map((id) =>
    db
      .update(accounts)
      .set({ archivedAt: stamp, status: 'archived' })
      .where(eq(accounts.id, id))
      .toSQL(),
  );

  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
}

/** Put a retired category back into use. */
export async function restoreCategory(categoryId: AccountId): Promise<void> {
  const envelopeId = envelopeIdFor(categoryId);
  const statements = [categoryId, envelopeId].map((id) =>
    db
      .update(accounts)
      .set({ archivedAt: null, status: 'active' })
      .where(eq(accounts.id, id))
      .toSQL(),
  );
  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
}

/** Archive a group, and everything filed under it. */
export async function archiveGroup(groupId: AccountId): Promise<void> {
  const children = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.parentId, groupId), isNull(accounts.archivedAt)));

  for (const child of children) await archiveCategory(child.id as AccountId);

  const stamp = now();
  const statements = [groupId, envelopeGroupOf(groupId)].map((id) =>
    db
      .update(accounts)
      .set({ archivedAt: stamp, status: 'archived' })
      .where(eq(accounts.id, id))
      .toSQL(),
  );
  await runBatch(statements.map((s) => ({ sql: s.sql, params: s.params })));
}
