import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ===========================================================================
 * THE PRIMITIVES
 * ---------------------------------------------------------------------------
 * Static guards, in the same spirit as tokens.test.ts, because this project
 * runs its tests under node with no DOM. What can be checked without one is
 * whether the source still says what it is supposed to say — which for these
 * three rules is enough, since each of them is a rule about what may appear in
 * the source at all.
 * ======================================================================== */

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const TOKENS = readFileSync(join(SRC, 'design', 'tokens.css'), 'utf8');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

const FILES = sourceFiles(SRC);

/* ---------------------------------------------------------------------------
 * THE RETIRED CLASSES
 * ---------------------------------------------------------------------------
 * `.rim` painted every container in the app with one radius, one hairline and
 * one shadow whatever it held, which is what made a screen read as a kit of
 * identical boxes rather than as a hierarchy. `.eyebrow` was the tracked-out
 * uppercase label that sat above almost every one of them. Both are gone, and
 * a guard is cheaper than remembering.
 * ------------------------------------------------------------------------ */

describe('the retired classes stay retired', () => {
  const RETIRED = ['rim', 'rim-flat', 'eyebrow', 'display'];

  it('defines none of them in tokens.css', () => {
    for (const name of RETIRED) {
      // A class definition, not a mention in prose or a property like
      // `font-display` or `display: flex`.
      expect(TOKENS, `.${name} is defined again`).not.toMatch(
        new RegExp('^\\s*\\.' + name + '\\s*\\{', 'm'),
      );
    }
  });

  /*
   * Only class *usages* count, never the word.
   *
   * Several files carry a comment explaining what the retired treatment was
   * and why it went, and those comments are worth more than the code above
   * them. So this strips comments first, then looks only inside the quoted
   * strings that a className is built from.
   */
  it('uses none of them in a component', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');

      for (const match of code.matchAll(
        /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{clsx\(([\s\S]*?)\)\})/g,
      )) {
        const region = match[1] ?? match[2] ?? match[3] ?? '';
        // Inside a clsx() call the classes live in quoted fragments; take
        // those rather than the whole argument list, which also holds
        // conditions and identifiers.
        const fragments =
          match[3] === undefined ? [region] : [...region.matchAll(/'([^']*)'|"([^"]*)"/g)].map(
            (f) => f[1] ?? f[2] ?? '',
          );

        for (const fragment of fragments) {
          for (const name of RETIRED) {
            if (new RegExp('(^|\\s)' + name + '($|\\s)').test(fragment)) {
              offenders.push(`${file.slice(SRC.length)}: ${name}`);
            }
          }
        }
      }
    }
    expect(offenders, 'These classes no longer exist — see Field, Card and Tile').toEqual([]);
  });
});

/* ---------------------------------------------------------------------------
 * NO TRACKED-OUT UPPERCASE LABELS
 * ---------------------------------------------------------------------------
 * An ALL-CAPS label above every heading is the loudest generated-design tell
 * there is, and there were 68 of them. The one that survives is the calendar's
 * weekday initials, where `uppercase` normalises locale-supplied content
 * ("mo", "di") rather than styling a label — so the guard is on the
 * *combination* of uppercase and letter-spacing, which is what made the
 * treatment an eyebrow.
 * ------------------------------------------------------------------------ */

describe('no component reintroduces the eyebrow treatment', () => {
  it('never pairs uppercase with tracking', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/"[^"]*"|'[^']*'/g)) {
        const value = match[0];
        if (/\buppercase\b/.test(value) && /\btracking-\[/.test(value)) {
          offenders.push(`${file.slice(SRC.length)}: ${value.slice(0, 70)}`);
        }
      }
    }
    expect(
      offenders,
      'Section headings are sentence-case .section-title now',
    ).toEqual([]);
  });

  it('defines the replacement it points people at', () => {
    expect(TOKENS).toMatch(/^\s*\.section-title\s*\{/m);
  });
});

/* ---------------------------------------------------------------------------
 * A CARD WITH NO LABEL HAS NO HEADER
 * ---------------------------------------------------------------------------
 * Roughly half the cards in the app never had a label. A header slot that
 * rendered whether or not it held anything would have left a gap at the top of
 * every one of them, so the header is guarded on there being something to put
 * in it — and an empty string counts as nothing, because that is what a caller
 * means when the heading has moved into the content.
 * ------------------------------------------------------------------------ */

describe('Card renders no header when there is no heading', () => {
  const CARD = readFileSync(join(SRC, 'design', 'ui', 'Card.tsx'), 'utf8');

  it('treats an absent and an empty label the same', () => {
    expect(CARD).toMatch(/label !== undefined && label !== ''/);
  });

  it('guards the whole header element, not just the heading inside it', () => {
    expect(CARD).toMatch(/const hasHeader =/);
    expect(CARD).toMatch(/\{hasHeader && \(\s*<header/);
  });

  it('emits the section title rather than the retired eyebrow', () => {
    expect(CARD).toMatch(/className="section-title/);
    // The word survives in the comment recording why the eyebrow went, which
    // is worth keeping. What must not survive is the class.
    expect(CARD).not.toMatch(/className="[^"]*eyebrow/);
  });
});

/* ---------------------------------------------------------------------------
 * THE THREE SURFACES EXIST AND ARE DIFFERENT
 * ------------------------------------------------------------------------ */

describe('the surface hierarchy is three distinct things', () => {
  it('defines field, card and tile', () => {
    for (const name of ['field', 'card', 'tile']) {
      expect(TOKENS, `.${name} is missing`).toMatch(new RegExp('^\\s*\\.' + name + '\\s*\\{', 'm'));
    }
  });

  it('gives them different radii, because size and roundness have to agree', () => {
    const rule = (name: string) => {
      const at = TOKENS.search(new RegExp('^\\s*\\.' + name + '\\s*\\{', 'm'));
      return TOKENS.slice(at, TOKENS.indexOf('}', at));
    };
    expect(rule('field')).toMatch(/--radius-hero/);
    expect(rule('card')).toMatch(/--radius-card/);
    // The field is a field of colour, not an object sitting on one.
    expect(rule('field')).not.toMatch(/box-shadow|border:/);
    expect(rule('tile')).not.toMatch(/box-shadow/);
  });

  it('binds all six families', () => {
    for (const family of ['housing', 'food', 'transport', 'obligation', 'leisure', 'health']) {
      expect(TOKENS, `.cat-${family} is missing`).toMatch(
        new RegExp('^\\s*\\.cat-' + family + '\\s*\\{', 'm'),
      );
    }
  });
});
