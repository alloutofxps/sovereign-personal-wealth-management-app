import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ===========================================================================
 * NO PROSE IN COMPONENTS
 * ---------------------------------------------------------------------------
 * There were about 175 explanatory paragraphs sitting inline in the feature
 * components. Cards explained themselves in prose instead of showing
 * themselves, which is the single loudest thing separating this app from one
 * somebody would pay for.
 *
 * They are all in `src/content/explain` now, behind an information button.
 * This is the guard that stops them creeping back, because they will: the next
 * person to add a card will want to add a sentence under it, and the sentence
 * will be reasonable, and six months later there are 175 again.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS EXEMPT, AND WHY
 *
 * THE FIELD MANUAL. Section 6 of the brief keeps it, deliberately, as
 * long-form reference prose — that is the entire point of it, and it holds 64
 * strings over this threshold on purpose. A guard that failed the manual would
 * be a guard that misunderstood what it was guarding.
 *
 * Onboarding is NOT exempt. Its explanatory asides moved into the registry
 * like every other screen's; only the step copy stays, and step copy is a
 * question and a hint rather than an explanation of an engine.
 *
 * Nor is anything else. A toast, an error message, an aria-label and an import
 * path are allowed to be long because none of them is a paragraph somebody
 * reads under a figure — those are matched by shape below rather than by being
 * listed file by file.
 * ======================================================================== */

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Long enough that it is a sentence rather than a label. */
const LONG = 90;

/* ---------------------------------------------------------------------------
 * THREE CATEGORY EXEMPTIONS
 * ---------------------------------------------------------------------------
 * Each of these is exempt because of what the copy IS, not because getting to
 * it was inconvenient. Anything that does not fall into one of them and is
 * still inline is on the debt list below, which shrinks.
 * ------------------------------------------------------------------------ */

/**
 * 1. THE FIELD MANUAL.
 *
 * Section 6 keeps it as long-form reference prose on purpose — that is the
 * entire point of it, and it holds 64 strings over this threshold by design.
 * A guard that failed the manual would have misunderstood what it guards.
 */
const MANUAL_CHAPTERS = join('features', 'manual', 'chapters') + sep;

/**
 * 2. THE DESIGN-SYSTEM GALLERY.
 *
 * Documentation of the primitives, for whoever is working on them. Phase 6
 * puts it behind a dev-only flag, so it is not a user-facing destination and
 * its descriptive copy is not something a person reads under a figure.
 */
const GALLERY = join('features', 'gallery') + sep;

/**
 * 3. EMPTY STATES.
 *
 * An empty state is the screen's only content. Moving it behind an
 * information button leaves a blank screen with an "i" on it, which is worse
 * than the paragraph — there would be nothing left to press the button beside.
 *
 * Recognised by how they are actually written here: they open by saying that
 * there is nothing yet. The cap matters as much as the opening, because an
 * empty state is a sentence explaining what to do next, and one that runs past
 * two lines has stopped being that and become an essay with nowhere to go.
 */
const EMPTY_STATE_OPENINGS =
  /^(nothing|no one|no |none |once you|once there|add (a|an|your)|your accounts are|there is nothing|there are no)/i;
const EMPTY_STATE_CAP = 170;

function isEmptyState(text: string): boolean {
  return EMPTY_STATE_OPENINGS.test(text.trim()) && text.trim().length <= EMPTY_STATE_CAP;
}

/* ===========================================================================
 * THE DEBT LIST
 * ---------------------------------------------------------------------------
 * The nineteen explanations that describe how an engine works are in the
 * registry, and every one of them is behind a button on the screen it belongs
 * to. Empty states and the gallery are exempt by category above, because of
 * what that copy is rather than because it was inconvenient to move.
 *
 * What is left here is the genuine remainder: notices saying what a form is
 * about to do, the onboarding narrative, and screen intros.
 *
 * They are not left because they are fine. They are left because phase 4
 * rebuilds every one of these screens against the reference, and a paragraph
 * is far easier to judge in a finished screen than in a diff — the same reason
 * the label review was deferred to phase 4. Deciding now would mean deciding
 * twice.
 *
 * This list may only ever shrink. A file that has been cleaned has to come off
 * it, and the second test below fails until it does, so the list cannot
 * quietly become a place to put things.
 * ======================================================================== */

const STILL_INLINE: readonly string[] = [

];

/** Windows separators, normalised, so the list above matches on any machine. */
function relative(file: string): string {
  return file.slice(SRC.length).split(sep).join('/');
}

function featureFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) featureFiles(full, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Strings that are long for a reason other than being prose.
 *
 * A toast is a sentence somebody reads once and dismisses; an error explains a
 * failure at the moment it happens; an aria-label has to be a full phrase to
 * be worth anything. None of them is a paragraph under a figure.
 */
/**
 * Blank the inside of every `clsx(…)`, `cn(…)` and `className={…}`.
 *
 * A class list is not prose, and the cheap test for one -- does the string's
 * own line mention `className` -- fails on the shape this codebase actually
 * writes, where the opener sits a line above its arguments:
 *
 *     className={clsx(
 *       'flex items-center justify-between rounded-md border px-3.5 py-3 ...',
 *
 * Five class lists were being counted as paragraphs on the debt list because of
 * it. Matching the delimiters is exact where looking at one line is not.
 *
 * Newlines and the delimiters themselves are kept so line numbers still point
 * at the right place and the JSX scan that follows sees the same structure.
 */
function blankClassExpressions(source: string): string {
  const out = source.split('');
  const openers = [...source.matchAll(/\b(?:clsx|cn)\s*\(|className\s*=\s*\{/g)];

  for (const opener of openers) {
    const start = opener.index!;
    const openChar = source[start + opener[0].length - 1]!;
    const closeChar = openChar === '(' ? ')' : '}';
    let depth = 1;
    let quote: string | null = null;

    for (let i = start + opener[0].length; i < source.length && depth > 0; i++) {
      const ch = source[i]!;
      if (quote) {
        if (ch === quote && source[i - 1] !== '\\') quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === openChar) {
        depth += 1;
      } else if (ch === closeChar) {
        depth -= 1;
      }
      if (depth > 0 && out[i] !== '\n') out[i] = ' ';
    }
  }

  return out.join('');
}

function isAllowed(line: string, value: string): boolean {
  if (/\baria-label\s*=|\baria-description|\balt\s*=/.test(line)) return true;
  if (/\btoast\s*\(|\bthrow new|Error\(|\bmessage:/.test(line)) return true;
  if (/\bplaceholder\s*=|\bhint\s*=|\bexplains:/.test(line)) return true;
  if (/^[@./]|^https?:/.test(value)) return true;
  // A className is long because it is a list of classes.
  if (/className|clsx\(/.test(line)) return true;
  return false;
}

/**
 * Whether a JSX text node is a sentence or a stretch of source.
 *
 * TypeScript's generic parameters — `useState<Foo>(…)` — put a `>` and a `<`
 * around arbitrary code, so a naive text-node match reads whole function
 * bodies as copy. Real prose has no semicolons, no arrows and no `const`, and
 * that is enough to tell them apart without trying to parse anything.
 */
function looksLikeProse(text: string): boolean {
  if (/[;{}]|=>|\bconst\b|\blet\b|\breturn\b|\)\s*\(|==|&&|\|\|/.test(text)) return false;
  // A sentence is mostly letters and spaces.
  const wordish = (text.match(/[a-zA-Z ]/g) ?? []).length / text.length;
  return wordish > 0.85;
}

/* ===========================================================================
 * ONE JUDGEMENT, TWO EXTRACTORS
 * ---------------------------------------------------------------------------
 * Three separate bugs in this guard have had the same shape: a check that
 * lived on one arm and not the other.
 *
 *   - `looksLikeProse` guarded JSX text and not string literals, so the dock's
 *     sun icon -- 103 characters of SVG path -- counted as a paragraph.
 *   - Length was measured on raw inner text for JSX and on the string itself
 *     for literals, so the same sentence counted or did not depending on how
 *     deeply its element was nested.
 *   - The `className` exemption tested the line a string sat on, which a
 *     multi-line `clsx(` call puts out of reach.
 *
 * Each fix was correct. None addressed the cause: the arms were two copies of
 * one judgement rather than two callers of it. So the judgement is now one
 * function, and an arm is responsible only for finding candidate text -- the
 * single thing the two genuinely do differently.
 *
 * `sameVerdict` below asserts they cannot drift again.
 * ======================================================================== */

/**
 * Is this string a paragraph somebody would read under a figure?
 *
 * The only place that question is answered. Whitespace is collapsed first, so
 * a sentence is judged as the reader sees it rather than as the source happens
 * to have wrapped it.
 */
function isProseParagraph(text: string): boolean {
  const sentence = text.replace(/\s+/g, ' ').trim();
  if (sentence.length < LONG) return false;
  if ((sentence.match(/ /g) ?? []).length < 8) return false;
  if (!looksLikeProse(sentence)) return false;
  if (isEmptyState(sentence)) return false;
  return true;
}

/** Every quoted string in the source that reads as a paragraph. */
function paragraphsInStrings(source: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];

  blankClassExpressions(source)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(/(['"])((?:(?!\1)[^\\])*)\1/g)) {
        const value = match[2] ?? '';
        if (!isProseParagraph(value)) continue;
        /*
         * The one thing only this arm can ask.
         *
         * A toast, an aria-label, a hint and an error are all sentences by any
         * reading, and all of them are fine where they are. What tells them
         * apart from copy is the attribute or call they sit in, which is
         * context a JSX text node simply does not have -- so this is the one
         * check that cannot move into the shared predicate.
         */
        if (isAllowed(line, value)) continue;
        found.push({ line: index + 1, text: value });
      }
    });

  return found;
}

/** Every JSX text node in the source that reads as a paragraph. */
function paragraphsInJsx(source: string): string[] {
  // Comments first, so a block explaining why something works is not copy.
  const jsx = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const found: string[] = [];

  /*
   * The `{90,}` here counts RAW inner text -- newlines and indentation
   * included -- and is only a cheap floor to keep the scan fast. It is NOT the
   * length test. `isProseParagraph` measures the collapsed sentence, which is
   * what a reader sees; leaving the decision to this pattern is what once made
   * the gate satisfiable by reflowing JSX.
   */
  for (const match of jsx.matchAll(/>\s*([^<>{}]{90,}?)\s*</g)) {
    const text = match[1]!.replace(/\s+/g, ' ').trim();
    if (!isProseParagraph(text)) continue;
    found.push(text);
  }

  return found;
}

/* ===========================================================================
 * THE ARMS AGREE
 * ---------------------------------------------------------------------------
 * The same text, written as a string literal and as a JSX text node, has to be
 * judged the same way. That is the property all three past bugs broke, and the
 * shared predicate does not guarantee it on its own: an extractor can still
 * lose or mangle text before the predicate ever sees it.
 *
 * So this builds both shapes from one corpus and compares. The JSX form is
 * indented four levels deliberately, because indentation is what the
 * raw-length bug fed on.
 * ======================================================================== */

interface Sample {
  text: string;
  /** What both arms must say about it. */
  caught: boolean;
  why: string;
}

const CORPUS: Sample[] = [
  {
    text: 'Comparing this against your bank statement is the only way to know the figures here are right.',
    caught: true,
    why: 'a paragraph by any reading',
  },
  {
    text: 'Your data stays on this device. No servers, no accounts, no tracking, and nothing is ever sent.',
    caught: true,
    why: 'a paragraph by any reading',
  },
  {
    text: 'A tag is a label you put across payments that otherwise have nothing at all in common with each other.',
    caught: true,
    why: 'a paragraph by any reading',
  },
  {
    text: 'M12 3.5v2m0 13v2M20.5 12h-2m-13 0h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4',
    caught: false,
    why: 'an SVG path: long, spaced, and not one word in it',
  },
  {
    text: 'Short enough to be a caption, not a paragraph.',
    caught: false,
    why: 'under the length floor',
  },
  {
    text: 'Nothing set up yet. Car insurance, a holiday, Christmas are the ones that catch people out.',
    caught: false,
    why: 'an empty state, which is the screen\'s only content',
  },
  {
    /*
     * A Tailwind class list, which reads as prose at 0.857 against a 0.85
     * threshold -- it is almost all letters and spaces, and hyphens are the
     * only thing holding the ratio down.
     *
     * It is marked `caught` because that is what the predicate honestly says
     * about it, and pretending otherwise would make this test a wish rather
     * than a description. It does not matter in practice: a class list is
     * always inside `className` or `clsx(`, which `blankClassExpressions`
     * erases before the string arm runs, and it is never a JSX text node. The
     * case below proves the part that does matter.
     */
    text: 'flex items-center justify-between rounded-md border px-3.5 py-3 text-body transition-colors',
    caught: true,
    why: 'the prose heuristic cannot tell it apart; the class-expression blanking is what does',
  },
];

const asString = (text: string) => `const copy = [\n  '${text.replace(/'/g, "\\'")}',\n];\n`;
const asJsx = (text: string) => `<p>\n        ${text}\n      </p>\n`;

describe('both arms judge the same text the same way', () => {
  it('agrees on every sample', () => {
    const disagreed: string[] = [];

    for (const sample of CORPUS) {
      const fromStrings = paragraphsInStrings(asString(sample.text)).length > 0;
      const fromJsx = paragraphsInJsx(asJsx(sample.text)).length > 0;

      if (fromStrings !== fromJsx) {
        disagreed.push(
          `"${sample.text.slice(0, 45)}…" — strings ${fromStrings ? 'caught' : 'passed'}, ` +
            `JSX ${fromJsx ? 'caught' : 'passed'}`,
        );
      }
    }

    expect(
      disagreed,
      'The two arms have drifted again. Whatever check one has, the other needs',
    ).toEqual([]);
  });

  /*
   * Agreement is worthless if both arms agree on nothing, so the verdicts are
   * pinned one by one. A change that makes the guard stop catching sentences
   * fails here rather than quietly passing the parity check above.
   */
  it('reaches the verdict each sample was chosen for', () => {
    for (const sample of CORPUS) {
      const verdict = paragraphsInJsx(asJsx(sample.text)).length > 0;
      expect(verdict, `${sample.why}: "${sample.text.slice(0, 45)}…"`).toBe(sample.caught);
    }
  });

  /*
   * The class list, in the shape it actually occurs in.
   *
   * The predicate cannot tell it from a sentence and does not have to: on the
   * arm where a class list is real, the expression it lives in is blanked
   * before the scan reaches it.
   */
  it('never counts a class list that sits where class lists sit', () => {
    const source = [
      'const cls = clsx(',
      "  'flex items-center justify-between rounded-md border px-3.5 py-3 text-body transition-colors',",
      ');',
      '',
    ].join('\n');

    expect(paragraphsInStrings(source)).toEqual([]);
  });
});

describe('no explanatory prose lives in a component', () => {
  const files = featureFiles(join(SRC, 'features')).filter(
    (file) => !file.includes(MANUAL_CHAPTERS) && !file.includes(GALLERY),
  );

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no paragraph a person would read under a figure', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');

      for (const hit of paragraphsInStrings(source)) {
        offenders.push(`${relative(file)}:${hit.line}  ${hit.text.slice(0, 60)}…`);
      }
      for (const text of paragraphsInJsx(source)) {
        offenders.push(`${relative(file)}  ${text.slice(0, 60)}…`);
      }
    }

    const unexpected = offenders.filter(
      (line) => !STILL_INLINE.some((file) => line.startsWith(file)),
    );

    expect(
      unexpected,
      'Move these into src/content/explain and put an <Explain> beside the label',
    ).toEqual([]);
  });

  /*
   * The debt list may only ever shrink.
   *
   * Without this the list becomes a place to put things, which is the opposite
   * of what it is for. A file that has been cleaned has to leave it, and the
   * test fails until it does.
   */
  it('lists no file that is already clean', () => {
    const stillDirty = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const jsx = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      const long =
        [...jsx.matchAll(/>\s*([^<>{}]{90,}?)\s*</g)].some((m) => {
          const t = m[1]!.replace(/\s+/g, ' ').trim();
          return looksLikeProse(t) && !isEmptyState(t);
        }) ||
        source.split('\n').some((line) =>
          [...line.matchAll(/(['"])((?:(?!\1)[^\\])*)\1/g)].some(
            (m) =>
              (m[2] ?? '').length >= LONG &&
              ((m[2] ?? '').match(/ /g) ?? []).length >= 8 &&
              !isAllowed(line, m[2] ?? '') &&
              !isEmptyState(m[2] ?? ''),
          ),
        );
      if (long) stillDirty.add(relative(file));
    }

    const cleaned = STILL_INLINE.filter(
      (file) => ![...stillDirty].some((dirty) => dirty.startsWith(file)),
    );
    expect(cleaned, 'These are clean now — take them off STILL_INLINE').toEqual([]);
  });
});

describe('the field manual keeps its prose', () => {
  it('is exempt, and still has prose worth exempting', () => {
    const chapters = featureFiles(join(SRC, 'features', 'manual', 'chapters'));
    const long = chapters.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/>\s*([^<>{}]{90,}?)\s*</g)].map((m) => m[1]),
    );
    // If this ever reaches zero, the manual has been emptied and the
    // exemption above is protecting nothing.
    expect(long.length, 'the manual should be long-form prose').toBeGreaterThan(20);
  });
});
