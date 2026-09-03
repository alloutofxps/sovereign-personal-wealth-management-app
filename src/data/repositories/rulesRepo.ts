/* ===========================================================================
 * STORED RULES, AND WHAT A MERCHANT IS USUALLY FILED AS
 * ---------------------------------------------------------------------------
 * Two ways of not asking the same question twice. Rules are explicit — the
 * person wrote them and can read them back. Merchant memory is implicit and
 * only ever suggests. Both live here because both are queries over the same
 * journal, but they are kept apart everywhere above this file so a surprising
 * suggestion can always be traced to one or the other.
 * ======================================================================== */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { AccountId } from '@/core/ledger';
import {
  isSameMerchant,
  normaliseMerchant,
  predictFromHistory,
  type MerchantHistoryRow,
  type PredictionResult,
} from '@/core/taxonomy/merchantMemory';
import type { MatchField, Rule } from '@/core/rules/matcher';
import { db, runBatch } from '../client';
import { rules } from '../schema/tables';

export const RULES_TABLES = ['rules'] as const;
export const MERCHANT_TABLES = ['entries', 'postings', 'accounts'] as const;

/* --- rules ---------------------------------------------------------------- */

export async function listRules(): Promise<Rule[]> {
  const rows = await db.select().from(rules).orderBy(rules.priority, rules.createdAt);
  return rows.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    isRegex: row.isRegex === 1,
    matchField: row.matchField as MatchField,
    categoryId: row.categoryId,
    envelopeId: row.envelopeId,
    priority: row.priority,
    active: row.active === 1,
    createdAt: row.createdAt,
  }));
}

/** Rules with the counters the manager screen shows alongside them. */
export interface RuleWithStats extends Rule {
  matchCount: number;
  lastMatchedAt: string | null;
}

export async function listRulesWithStats(): Promise<RuleWithStats[]> {
  const rows = await db.select().from(rules).orderBy(rules.priority, rules.createdAt);
  return rows.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    isRegex: row.isRegex === 1,
    matchField: row.matchField as MatchField,
    categoryId: row.categoryId,
    envelopeId: row.envelopeId,
    priority: row.priority,
    active: row.active === 1,
    createdAt: row.createdAt,
    matchCount: row.matchCount,
    lastMatchedAt: row.lastMatchedAt,
  }));
}

export interface NewRule {
  pattern: string;
  categoryId: AccountId;
  envelopeId: AccountId;
  isRegex?: boolean;
  matchField?: MatchField;
  priority?: number;
}

/**
 * Remember a rule.
 *
 * Saying "always file Waterstones as Books" twice should not leave two rules
 * behind, so an identical pattern for the same field is updated rather than
 * added again.
 */
export async function saveRule(input: NewRule): Promise<string> {
  const pattern = input.pattern.trim();
  if (!pattern) throw new Error('A rule needs something to match on.');

  const field = input.matchField ?? 'description';
  const [existing] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.pattern, pattern), eq(rules.matchField, field)))
    .limit(1);

  if (existing) {
    const update = db
      .update(rules)
      .set({
        categoryId: input.categoryId,
        envelopeId: input.envelopeId,
        isRegex: input.isRegex ? 1 : 0,
        active: 1,
      })
      .where(eq(rules.id, existing.id))
      .toSQL();
    await runBatch([{ sql: update.sql, params: update.params }]);
    return existing.id;
  }

  const id = crypto.randomUUID();
  const insert = db
    .insert(rules)
    .values({
      id,
      pattern,
      isRegex: input.isRegex ? 1 : 0,
      matchField: field,
      categoryId: input.categoryId,
      envelopeId: input.envelopeId,
      priority: input.priority ?? 100,
      active: 1,
      matchCount: 0,
      createdAt: new Date().toISOString(),
    })
    .toSQL();

  await runBatch([{ sql: insert.sql, params: insert.params }]);
  return id;
}

export async function setRuleActive(id: string, active: boolean): Promise<void> {
  const statement = db
    .update(rules)
    .set({ active: active ? 1 : 0 })
    .where(eq(rules.id, id))
    .toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

export async function deleteRule(id: string): Promise<void> {
  const statement = db.delete(rules).where(eq(rules.id, id)).toSQL();
  await runBatch([{ sql: statement.sql, params: statement.params }]);
}

/** Record that rules did some work, for the counters on the manager screen. */
export async function recordRuleMatches(ruleIds: readonly string[]): Promise<void> {
  if (ruleIds.length === 0) return;
  const stamp = new Date().toISOString();
  const counts = new Map<string, number>();
  for (const id of ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const statements = [...counts].map(([id, n]) => {
    const statement = db
      .update(rules)
      .set({ matchCount: sql`${rules.matchCount} + ${n}`, lastMatchedAt: stamp })
      .where(eq(rules.id, id))
      .toSQL();
    return { sql: statement.sql, params: statement.params };
  });

  await runBatch(statements);
}

/* --- merchant memory ------------------------------------------------------ */

const HISTORY_LIMIT = 25;

/**
 * What this merchant has been filed as before.
 *
 * Matching is done on the normalised name in JavaScript rather than in SQL,
 * because the normalisation strips reference numbers and bank filler and that
 * is not something a LIKE can express. The candidate set is bounded by
 * `HISTORY_LIMIT` after ordering by date, so this stays a small read however
 * long the journal grows.
 */
export async function predictCategoryForMerchant(
  merchantName: string,
): Promise<PredictionResult | null> {
  const target = normaliseMerchant(merchantName);
  if (!target) return null;

  // Every past spend line, newest first, with the category it was filed under.
  const rows = await db.all<[string, string, string, string]>(
    sql`SELECT e.description, e.date, p.account_id, a.name
          FROM entries e
          JOIN postings p ON p.entry_id = e.id
          JOIN accounts a ON a.id = p.account_id
         WHERE p.book = 'FINANCIAL' AND p.amount > 0 AND a.type = 'EXPENSE'
           AND e.kind IN ('SPEND', 'SPEND_SPLIT')
           -- Never suggest a category that has been retired: the picker will
           -- not offer it, so the hint would point at something unselectable.
           AND a.archived_at IS NULL
         ORDER BY e.date DESC
         LIMIT 400`,
  );

  const history: MerchantHistoryRow[] = [];
  for (const row of rows) {
    const [description, date, accountId, name] = row;
    if (!isSameMerchant(String(description ?? ''), merchantName)) continue;
    history.push({
      categoryId: String(accountId),
      envelopeId: String(accountId).replace(/^cat-/, 'pot-'),
      categoryName: String(name),
      date: String(date),
    });
    if (history.length >= HISTORY_LIMIT) break;
  }

  return predictFromHistory(history);
}

/** The merchants seen most often, for the rules screen's suggestions. */
export async function frequentMerchants(limit = 10): Promise<{ name: string; count: number }[]> {
  const rows = await db
    .select({ description: sql<string>`description`, n: sql<number>`count(*)` })
    .from(sql`entries`)
    .where(sql`kind IN ('SPEND', 'SPEND_SPLIT')`)
    .groupBy(sql`description`)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((r) => ({ name: String(r.description), count: Number(r.n) }));
}
