/* ===========================================================================
 * RULES THAT FILE THINGS FOR YOU
 * ---------------------------------------------------------------------------
 * "Anything from Tesco is food shopping." Said once, applied forever. This is
 * what turns a 200-row statement import from 200 decisions into about fifteen.
 *
 * Deterministic on purpose. Rules are sorted by priority and the first match
 * wins, so the same statement always files the same way and a person can look
 * at the list and predict what will happen. Nothing here scores, weighs or
 * learns — that is merchantMemory's job, and keeping the two apart means a
 * surprising suggestion can always be traced to one or the other.
 *
 * On regular expressions: a pattern is written by the person whose device it
 * runs on, so this is not a hostile-input problem in the usual sense. It is
 * still a foot-gun — a mistyped `(a+)+b` will hang their own tab — so patterns
 * are length-capped, compiled once, checked for the nested-quantifier shape
 * that causes catastrophic backtracking, and wrapped so a bad one is skipped
 * rather than taking the import down with it.
 * ======================================================================== */

export type MatchField = 'description' | 'raw_descriptor';

export interface Rule {
  id: string;
  pattern: string;
  isRegex: boolean;
  matchField: MatchField;
  categoryId: string;
  envelopeId: string;
  /** Lower runs first. */
  priority: number;
  active: boolean;
  /** Breaks ties between equal priorities, so the order never wobbles. */
  createdAt: string;
}

export interface RuleMatch {
  matched: true;
  ruleId: string;
  categoryId: string;
  envelopeId: string;
  /** What the rule was, for the badge on the row. */
  pattern: string;
}

export interface MatchInput {
  description: string;
  rawDescriptor?: string;
}

/** Longer than this is a mistake, not a pattern. */
export const MAX_PATTERN_LENGTH = 200;

/**
 * The shapes that make a regular expression take exponential time: a quantifier
 * applied to a group that already contains one. `(a+)+`, `(a*)*`, `(a|a)+`.
 *
 * This is a heuristic and it is honest about being one — it refuses the common
 * accidents rather than proving anything about the language.
 */
const CATASTROPHIC = /\((?=[^)]*[+*])[^)]*\)\s*[+*]|\((?=[^)]*\{\d)[^)]*\)\s*\{\d/;

export function isUnsafePattern(pattern: string): boolean {
  return pattern.length > MAX_PATTERN_LENGTH || CATASTROPHIC.test(pattern);
}

/** A rule with its regex already built, or marked unusable. */
export interface CompiledRule extends Rule {
  regex: RegExp | null;
  /** Set when the pattern could not be used, in words for the rules screen. */
  problem: string | null;
}

/**
 * Sort by priority and build every regex once.
 *
 * Compiling inside the match loop would rebuild the same expression for every
 * row of a statement; for a 400-row import that is 400 times the work for an
 * identical result.
 */
export function compileRules(rules: readonly Rule[]): CompiledRule[] {
  return rules
    .filter((rule) => rule.active)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((rule) => {
      if (!rule.isRegex) return { ...rule, regex: null, problem: null };

      if (isUnsafePattern(rule.pattern)) {
        return {
          ...rule,
          regex: null,
          problem:
            'This pattern could take a very long time to run, so it is being skipped. ' +
            'Simplifying it, or using a plain text match instead, will fix it.',
        };
      }

      try {
        return { ...rule, regex: new RegExp(rule.pattern, 'i'), problem: null };
      } catch {
        return {
          ...rule,
          regex: null,
          problem: 'Sovereign could not understand this pattern, so it is being skipped.',
        };
      }
    });
}

function fieldValue(input: MatchInput, field: MatchField): string {
  return field === 'raw_descriptor' ? (input.rawDescriptor ?? input.description) : input.description;
}

/**
 * The first rule that matches, or null.
 *
 * Plain patterns are a case-insensitive substring test, which is what somebody
 * means by "anything with Tesco in it". Regular expressions are for the people
 * who want them and are skipped when they cannot be trusted to finish.
 */
export function matchRule(
  compiled: readonly CompiledRule[],
  input: MatchInput,
): RuleMatch | null {
  for (const rule of compiled) {
    const value = fieldValue(input, rule.matchField);
    if (!value) continue;

    let hit = false;
    if (rule.regex) {
      try {
        hit = rule.regex.test(value);
      } catch {
        // A regex that throws mid-run takes itself out, not the import.
        hit = false;
      }
    } else if (rule.problem === null) {
      hit = value.toLowerCase().includes(rule.pattern.toLowerCase());
    }

    if (hit) {
      return {
        matched: true,
        ruleId: rule.id,
        categoryId: rule.categoryId,
        envelopeId: rule.envelopeId,
        pattern: rule.pattern,
      };
    }
  }

  return null;
}

/** The badge on a row the rules have already filed. */
export function describeMatch(match: RuleMatch, categoryName: string): string {
  return `Filed by your rule "${match.pattern}" as ${categoryName.toLowerCase()}`;
}
