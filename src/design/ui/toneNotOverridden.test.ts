/* ===========================================================================
 * A TONE AND A COLOUR CLASS ON THE SAME ELEMENT
 * ---------------------------------------------------------------------------
 * `<Money tone="neutral" className="text-[var(--tile-ink)]" />` looks like an
 * override and is not one.
 *
 * `Money` resolves its tone to exactly one colour utility and appends the
 * caller's `className` after it in the same `clsx` call. Both end up on the
 * element with the same specificity, so which one wins is decided by the order
 * Tailwind emits them in its stylesheet — not by the order they appear in the
 * class attribute. Tailwind emits `text-ink` after `text-[var(--tile-ink)]`, so
 * the override loses.
 *
 * Nothing about that is visible. It type-checks, it lints, the class is right
 * there in the DOM, and the figure is simply the wrong colour. Every hero
 * figure on a field in this app rendered ink-black for a whole phase because of
 * it, and finding it took sampling `getComputedStyle().color` against the
 * `--tile-ink` the element had bound. A guard is cheaper than doing that again.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ACTUALLY CHECKS
 *
 * Any JSX element carrying both a `tone` prop and a colour utility in its
 * `className`. The fix is never to reorder anything — it is to add the tone the
 * caller wanted. `tone="inherit"` exists for exactly the case this was hiding:
 * a figure that should take the colour of the field it sits on.
 *
 * Utilities that set a colour are matched by prefix. `bg-` and `border-` are
 * deliberately absent: `Money` and its kin emit only a text colour, so a
 * background on the same element is a real, non-conflicting instruction.
 * ======================================================================== */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Text-colour utilities, as Tailwind writes them.
 *
 * `text-` also prefixes every size and alignment utility, so the pattern has to
 * be narrow enough to skip `text-lead`, `text-center` and `text-[10.5px]`
 * without skipping `text-ink-2` or `text-[var(--tile-ink)]`.
 */
const COLOUR_UTILITY =
  /\btext-(?:\[(?:color:|var\(|#|rgb|hsl)[^\]]*\]|current|inherit|white|black|ink(?:-\d)?|liquid(?:-\w+)?|deficit(?:-\w+)?|caution(?:-\w+)?|hot(?:-\w+)?|housing|food|transport|obligation|leisure|health)\b/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) found.push(full);
  }
  return found;
}

const relative = (file: string) => file.slice(SRC.length + 1).split(sep).join('/');

/**
 * Every JSX opening tag in a file, whole, including one level of nested braces.
 *
 * Props routinely carry expressions with their own `>` and `<` — `size={a > b}`,
 * `useState<Foo>` — so a naive scan to the first `>` cuts tags in half and
 * misses the `className` that follows. Counting braces and quotes is enough to
 * find the real end without parsing.
 */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  // Component tags only: an uppercase initial. A lowercase `<div>` has no tone.
  const starts = [...source.matchAll(/<[A-Z][A-Za-z0-9_.]*/g)];

  for (const start of starts) {
    let depth = 0;
    let quote: string | null = null;
    let index = start.index! + start[0].length;

    for (; index < source.length; index++) {
      const ch = source[index]!;
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
    }

    tags.push(source.slice(start.index!, index));
  }

  return tags;
}

describe('a tone is never overridden by a colour class', () => {
  const files = [
    ...sourceFiles(join(SRC, 'features')),
    ...sourceFiles(join(SRC, 'design')),
  ];

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no element carrying both a tone prop and a text colour', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Comments explaining this very trap would otherwise read as offenders.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

      for (const tag of openingTags(code)) {
        if (!/\btone\s*=/.test(tag)) continue;
        const className = tag.match(/\bclassName\s*=\s*(?:"([^"]*)"|\{([\s\S]*)\})/);
        if (!className) continue;
        const value = className[1] ?? className[2] ?? '';
        if (!COLOUR_UTILITY.test(value)) continue;

        const name = tag.match(/^<([A-Za-z0-9_.]*)/)?.[1] ?? 'an element';
        offenders.push(`${relative(file)}  <${name} tone=… className=… >`);
      }
    }

    expect(
      offenders,
      'A colour utility beside a tone loses to the tone in the emitted order. ' +
        'Add the tone you meant — tone="inherit" takes the colour of what it sits in',
    ).toEqual([]);
  });
});
