/* ===========================================================================
 * FILING THE QUEUE BEFORE ANYBODY LOOKS AT IT
 * ---------------------------------------------------------------------------
 * A 200-row statement is 200 decisions, and that is why people stop using
 * budgeting apps. Most of those rows are the same dozen shops over and over.
 *
 * This runs the person's own rules across the rows on the way in, so the queue
 * they open is mostly already filed and what is left is the genuinely
 * unfamiliar. Nothing is committed here — a matched row still shows what it
 * matched and can still be changed. Automation that cannot be seen or undone
 * is not a time-saver, it is a source of quiet errors.
 *
 * Pure, and takes its rules as an argument rather than reading them, because
 * this layer never touches the database.
 * ======================================================================== */

import { compileRules, matchRule, type Rule, type RuleMatch } from '@/core/rules/matcher';

/** The least a row has to have for the rules to look at it. */
export interface RulableRow {
  description: string;
  /** The untouched bank descriptor, where it differs from the description. */
  raw?: string;
}

export interface RuledRow<T extends RulableRow> {
  row: T;
  /** The rule that claimed it, or null when nothing did. */
  match: RuleMatch | null;
}

export interface RuleApplication<T extends RulableRow> {
  rows: RuledRow<T>[];
  /** How many were filed without asking. */
  matchedCount: number;
  /** Rule ids that fired, once per row, for the match counters. */
  firedRuleIds: string[];
}

/**
 * Run the rules over a set of staged rows.
 *
 * Rules are compiled once for the whole batch rather than per row: a 400-row
 * import against a dozen regular expressions is otherwise 4,800 identical
 * compilations.
 */
export function applyRulesToStagedRows<T extends RulableRow>(
  rows: readonly T[],
  rules: readonly Rule[],
): RuleApplication<T> {
  const compiled = compileRules(rules);

  const out: RuledRow<T>[] = [];
  const fired: string[] = [];

  for (const row of rows) {
    const match = matchRule(compiled, {
      description: row.description,
      ...(row.raw ? { rawDescriptor: row.raw } : {}),
    });
    if (match) fired.push(match.ruleId);
    out.push({ row, match });
  }

  return { rows: out, matchedCount: fired.length, firedRuleIds: fired };
}

/** What to tell somebody after the rules have had a go at an import. */
export function describeRuleRun(matched: number, total: number): string {
  if (total === 0) return 'There was nothing new to look at.';
  if (matched === 0) {
    return `${total} ${total === 1 ? 'payment' : 'payments'} to look at. None of them matched ` +
      `a rule, so they are all waiting for you.`;
  }
  if (matched === total) {
    return `All ${total} matched your rules and are filed ready to confirm.`;
  }
  return `${matched} of ${total} matched your rules. The other ${total - matched} ` +
    `${total - matched === 1 ? 'is' : 'are'} waiting for you.`;
}
