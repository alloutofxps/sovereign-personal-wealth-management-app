/* ===========================================================================
 * A SUM OVER CREDIT-NORMAL POSTINGS HAS TO BE NEGATED
 * ---------------------------------------------------------------------------
 * `credit()` in the ledger stores its amount negated — "a reduction of an
 * asset, or an increase in a liability, income or envelope balance" — so the
 * sign of a posting depends on which side of the account it lands on, and a
 * query that sums postings has to know which kind of account it is reading.
 *
 * Get it wrong and nothing fails. The query returns rows, the numbers are
 * integers, the types are right, every test stays green, and the figure on
 * screen is zero. That is what happened: the analytics selector summed
 * BUDGET/ENVELOPE postings without negating, so `saved` was structurally
 * **always zero**, and the analytics field told people money they had
 * earmarked had no job yet. Four sums in that one file, three of them right.
 *
 * The evidence that it was a slip rather than a convention is in the repo:
 * `budgetRepo` sums the same ENVELOPE accounts in the same book and negates.
 * Two queries over one account type disagreed, and nothing compared them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * A source scan, which is the same instrument the design-system guards use
 * and carries the same limit: it sees that the negation is written, not that
 * the query ran or that its result was right. It cannot replace an execution
 * test — and there is no execution test for any selector in `src/app`, which
 * is recorded in AUDIT.md as the gap this defect came through.
 *
 * What it does buy is the one thing that would have caught this: a rule about
 * *which* sums must be negated, applied to every one of them at once, rather
 * than four queries each locally plausible.
 *
 * VERIFIED by breaking it three ways: reverting both sums in the analytics
 * savings query, reverting only the SELECT, and reverting only the HAVING.
 * All three fail `every sum over a credit-normal account is negated`, and the
 * message names the file and how many of its sums were negated.
 *
 * The half-edit cases matter more than the full one. The first version of this
 * guard asked only whether `-SUM` appeared anywhere in the block, and a
 * revert of the SELECT alone passed it — the guard was the defect, caught only
 * because the break was run rather than assumed. M2, at the third time of
 * asking.
 * ======================================================================== */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Every `.ts` under a directory, tests excluded. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * The account kinds whose postings are stored negated.
 *
 * INCOME, LIABILITY and EQUITY are credit-normal by accounting convention.
 * ENVELOPE is credit-normal in this ledger because an envelope's balance goes
 * *up* when money is assigned to it, which `assign` does with a credit.
 */
const CREDIT_NORMAL = ['INCOME', 'LIABILITY', 'EQUITY', 'ENVELOPE'];

interface Block {
  file: string;
  sql: string;
  /** Every `SUM(p.amount)` in the block is negated, not merely one of them. */
  negated: boolean;
  sums: number;
  negatedSums: number;
  kinds: string[];
}

/** Every `sql` template that sums posting amounts, with the account kinds it filters on. */
function summingBlocks(): Block[] {
  const out: Block[] = [];
  for (const file of [...sources(join(SRC, 'app')), ...sources(join(SRC, 'data'))]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/sql`([\s\S]*?)`/g)) {
      const block = match[1]!;
      if (!/SUM\(\s*p\.amount\s*\)/.test(block)) continue;

      const kinds = new Set<string>();
      for (const m of block.matchAll(/a\.type\s*=\s*'(\w+)'/g)) kinds.add(m[1]!);
      for (const m of block.matchAll(/a\.type\s+IN\s*\(([^)]*)\)/g)) {
        for (const k of m[1]!.matchAll(/'(\w+)'/g)) kinds.add(k[1]!);
      }

      /*
       * Counted rather than tested for presence.
       *
       * A query states the sum twice — once in the SELECT and once in the
       * HAVING — and negating one but not the other is the likeliest way to
       * half-fix this. An earlier version of this guard asked only whether
       * `-SUM` appeared *somewhere* in the block, and a deliberate revert of
       * the SELECT alone sailed through it. The guard was the defect.
       */
      const sums = [...block.matchAll(/(-?)\s*SUM\(\s*p\.amount\s*\)/g)];
      const negatedSums = sums.filter((m) => m[1] === '-').length;

      out.push({
        file: file.slice(SRC.length).replace(/\\/g, '/'),
        sql: block,
        negated: sums.length > 0 && negatedSums === sums.length,
        sums: sums.length,
        negatedSums,
        kinds: [...kinds],
      });
    }
  }
  return out;
}

describe('posting sums know which way their account runs', () => {
  const blocks = summingBlocks();

  it('finds the queries at all', () => {
    // If this drops to zero the guard below passes vacuously, which is the
    // failure mode of every source scan.
    expect(blocks.length, 'no summing queries found — has the SQL moved?').toBeGreaterThanOrEqual(6);
  });

  it('every sum over a credit-normal account is negated', () => {
    const offenders = blocks
      .filter((b) => b.kinds.some((k) => CREDIT_NORMAL.includes(k)) && !b.negated)
      .map(
        (b) =>
          `${b.file}: sums ${b.kinds.join('/')} with ${b.negatedSums} of ${b.sums} sums negated`,
      );

    expect(
      offenders,
      'credit() stores its amount negated, so a credit-normal account sums to a negative ' +
        'number. Summing it unnegated returns zero rows and shows the person a zero.',
    ).toEqual([]);
  });

  it('never negates a sum over a debit-normal account', () => {
    // The mirror error, which would print spending as a negative.
    const offenders = blocks
      .filter((b) => b.kinds.length > 0 && b.kinds.every((k) => k === 'EXPENSE' || k === 'ASSET'))
      .filter((b) => b.negated)
      .map((b) => `${b.file}: negates a sum over ${b.kinds.join('/')}`);

    expect(offenders).toEqual([]);
  });

  it('the analytics savings query is the one this was written for', () => {
    // Named explicitly rather than left to the sweep, because it is the query
    // that was wrong and the one most likely to be rewritten by hand.
    const savings = blocks.find(
      (b) => /envelope_role\s+IN/.test(b.sql) && /goal/.test(b.sql) && /sinking_fund/.test(b.sql),
    );

    expect(savings, 'the pot-funding query has moved or changed shape').toBeDefined();
    expect(
      savings!.negated,
      'a funded pot sums negative; without the negation `saved` is always zero',
    ).toBe(true);
  });
});
