/* ===========================================================================
 * WHAT-IFS, STORED
 * ---------------------------------------------------------------------------
 * The only module that reads or writes the two branch tables, and it never
 * touches `entries` or `postings`. That is not a convention — those tables do
 * not carry a branch column, so there is nothing here that could.
 *
 * Postings come back out of a JSON column, which means they arrive as
 * whatever was written rather than as something the database has checked.
 * Everything that leaves this file goes through `checkBranch` before it is
 * counted, and a row that will not parse is dropped rather than thrown: one
 * corrupt sketch should cost the sketch, not the screen.
 * ======================================================================== */

import { sql } from 'drizzle-orm';
import type { Branch, BranchEntry } from '@/core/ledger/branching';
import type { EntryKind, IsoDate, Posting } from '@/core/ledger';
import { db, runBatch } from '../client';

/** Changing either of these should re-run a query that reads what-ifs. */
export const BRANCH_TABLES = ['branches', 'branch_entries'] as const;

/* --- what-ifs -------------------------------------------------------------- */

export async function listBranches(): Promise<Branch[]> {
  const rows = (await db.all(
    sql`SELECT id, name, diverges_on, note, created_at
          FROM branches
         ORDER BY created_at DESC`,
  )) as unknown as Record<number, unknown>[];

  return rows.map((row) => ({
    id: String(row[0]),
    name: String(row[1]),
    divergesOn: String(row[2]) as IsoDate,
    note: row[3] === null || row[3] === undefined ? null : String(row[3]),
    createdAt: String(row[4]),
  }));
}

export async function createBranch(input: {
  name: string;
  divergesOn: IsoDate;
  note?: string | null;
}): Promise<string> {
  const name = input.name.trim();
  if (name === '') {
    throw new Error('A what-if needs a name — something you would recognise later.');
  }

  const id = `br-${crypto.randomUUID()}`;
  await runBatch([
    {
      sql: `INSERT INTO branches (id, name, diverges_on, note, created_at) VALUES (?, ?, ?, ?, ?)`,
      params: [id, name, input.divergesOn, input.note ?? null, new Date().toISOString()],
    },
  ]);
  return id;
}

/**
 * Delete a what-if and everything sketched in it.
 *
 * The foreign key cascades, so this is one statement. Nothing in the real
 * ledger is touched, because nothing in the real ledger points at this.
 */
export async function deleteBranch(id: string): Promise<void> {
  await runBatch([{ sql: `DELETE FROM branches WHERE id = ?`, params: [id] }]);
}

/* --- the sketches inside one ---------------------------------------------- */

export async function listBranchEntries(branchId: string): Promise<BranchEntry[]> {
  const rows = (await db.all(
    sql`SELECT id, branch_id, kind, date, description, postings
          FROM branch_entries
         WHERE branch_id = ${branchId}
         ORDER BY date`,
  )) as unknown as Record<number, unknown>[];

  const parsed: BranchEntry[] = [];
  for (const row of rows) {
    const postings = readPostings(row[5]);
    // A sketch whose lines will not parse is dropped, not thrown. One bad row
    // should cost that row, not the whole screen.
    if (postings === null) continue;

    parsed.push({
      id: String(row[0]),
      branchId: String(row[1]),
      kind: String(row[2]) as EntryKind,
      date: String(row[3]) as IsoDate,
      description: String(row[4]),
      postings,
    });
  }
  return parsed;
}

/**
 * Add one hypothetical event.
 *
 * The postings are built by the caller through the same builders a real entry
 * uses, so a sketch cannot post in a shape the ledger would refuse. This only
 * writes them down.
 */
export async function addBranchEntry(entry: Omit<BranchEntry, 'id'>): Promise<string> {
  const id = `be-${crypto.randomUUID()}`;
  await runBatch([
    {
      sql: `INSERT INTO branch_entries (id, branch_id, kind, date, description, postings, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        entry.branchId,
        entry.kind,
        entry.date,
        entry.description,
        JSON.stringify(entry.postings),
        new Date().toISOString(),
      ],
    },
  ]);
  return id;
}

export async function removeBranchEntry(id: string): Promise<void> {
  await runBatch([{ sql: `DELETE FROM branch_entries WHERE id = ?`, params: [id] }]);
}

/**
 * Postings out of the JSON column, or null if they are not postings.
 *
 * Deliberately suspicious. This is the one place in the application where
 * something shaped like ledger data arrives without the database having
 * checked it, so the shape is checked here rather than assumed.
 */
function readPostings(value: unknown): Posting[] | null {
  if (typeof value !== 'string') return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    for (const line of parsed) {
      if (typeof line !== 'object' || line === null) return null;
      const posting = line as Record<string, unknown>;
      if (typeof posting.amount !== 'number' || !Number.isFinite(posting.amount)) return null;
      if (typeof posting.baseAmount !== 'number' || !Number.isFinite(posting.baseAmount)) {
        return null;
      }
      if (typeof posting.accountId !== 'string' || typeof posting.book !== 'string') return null;
    }
    return parsed as Posting[];
  } catch {
    return null;
  }
}
