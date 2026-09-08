import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AA_LARGE, AA_TEXT, contrast } from './contrast';

/* ===========================================================================
 * THE TOKEN GUARD
 * ---------------------------------------------------------------------------
 * Tailwind drops a utility class it does not recognise, without a word. So
 * `bg-ink-4` against a token that has been removed is not an error anywhere —
 * it simply renders nothing, and the only way to find out is to look at the
 * screen. That is exactly how a "Month gone" progress bar shipped invisible.
 *
 * This walks the components, collects every colour and radius utility that
 * looks like one of ours, and fails if the token behind it is not defined.
 * ======================================================================== */

const SRC = fileURLToPath(new URL('../', import.meta.url));
const TOKENS_CSS = join(SRC, 'design', 'tokens.css');
const CSS = readFileSync(TOKENS_CSS, 'utf8');

function definedTokens(prefix: string): Set<string> {
  const theme = CSS.slice(CSS.indexOf('@theme'), CSS.indexOf('@layer base'));
  return new Set(
    [...theme.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):`, 'g'))].map((m) => m[1]!),
  );
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

/** Tailwind ships these itself; they are not ours to define. */
const BUILT_IN_COLOURS = new Set([
  'transparent', 'current', 'inherit', 'black', 'white',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'slate', 'gray', 'grey', 'zinc', 'neutral', 'stone',
]);

const BUILT_IN_RADII = new Set(['none', 'full', 'xl', '2xl', '3xl', '4xl']);

describe('every design token a component asks for actually exists', () => {
  const files = sourceFiles(SRC);
  const colours = definedTokens('color');
  const radii = definedTokens('radius');

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('has no colour utility pointing at a token that was removed', () => {
    const pattern = /\b(?:bg|text|border|ring|fill|stroke|divide|decoration)-([a-z][a-z0-9-]*)/g;
    const offenders: string[] = [];

    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(pattern)) {
        const name = match[1]!.replace(/\/\d+$/, '');
        // Only judge names that look like ours.
        if (
          !/^(ink|liquid|caution|deficit|line|base|surface|raised|overlay|sunken|hot|housing|food|transport|obligation|leisure|health|vault)/.test(
            name,
          )
        ) {
          continue;
        }
        if (BUILT_IN_COLOURS.has(name)) continue;
        if (!colours.has(name)) {
          offenders.push(`${file.slice(SRC.length)}: ${match[0]}`);
        }
      }
    }

    expect(offenders, 'These classes render nothing at all — Tailwind drops them silently')
      .toEqual([]);
  });

  it('has no radius utility pointing at a token that was removed', () => {
    const pattern = /\brounded(?:-[trbl]{1,2})?-([a-z][a-z0-9]*)\b/g;
    const offenders: string[] = [];

    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(pattern)) {
        const name = match[1]!;
        if (BUILT_IN_RADII.has(name)) continue;
        if (!radii.has(name)) offenders.push(`${file.slice(SRC.length)}: ${match[0]}`);
      }
    }

    expect(offenders, 'These classes render nothing at all').toEqual([]);
  });

  it('actually catches a token that is not defined', () => {
    // The guard has to be seen failing, or it is not worth having.
    expect(colours.has('ink-4')).toBe(true);
    expect(colours.has('ink-9')).toBe(false);
    expect(radii.has('hero')).toBe(true);
    expect(radii.has('enormous')).toBe(false);
  });
});

/* ===========================================================================
 * THE TWO PALETTES
 * ---------------------------------------------------------------------------
 * A token defined for Daylight and forgotten for Midnight fails nowhere. It
 * simply keeps its Daylight value, and one element on an otherwise indigo
 * screen renders near-black type on near-black ground. It is invisible in
 * review because review happens in whichever theme the reviewer is in.
 *
 * Midnight is also written out twice — once for a dark system, once for an
 * explicit choice — because CSS has no way to share one declaration list
 * between a media query and an attribute selector. Two copies of anything
 * drift, so this checks they have not.
 * ======================================================================== */

/** Everything that has to differ between the two palettes. */
const MUST_INVERT = [
  'hairline',
  'hairline-strong',
  'fill-subtle',
  'scrim',
  'shadow-card',
  'shadow-dock',
  'shadow-sheet',
  'theme-color',
];

function block(opener: string): Map<string, string> {
  const start = CSS.indexOf(opener);
  expect(start, `${opener} is missing from tokens.css`).toBeGreaterThan(-1);
  const from = start + opener.length;
  const end = CSS.indexOf('\n}', from);
  const declarations = new Map<string, string>();
  for (const match of CSS.slice(from, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(match[1]!, match[2]!.trim());
  }
  return declarations;
}

const daylight = block('@theme {');
const bySystem = block(":root:not([data-theme='daylight']) {");
const byChoice = block(":root[data-theme='midnight'] {");

describe('Midnight covers everything Daylight defines', () => {
  it('reads all three blocks', () => {
    expect(daylight.size).toBeGreaterThan(30);
    expect(bySystem.size).toBeGreaterThan(30);
    expect(byChoice.size).toBeGreaterThan(30);
  });

  it('leaves no colour on its Daylight value', () => {
    const missing = [...daylight.keys()].filter(
      (name) => name.startsWith('--color-') && !bySystem.has(name),
    );
    expect(missing, 'These would render at their Daylight value on an indigo screen').toEqual([]);
  });

  it('inverts every overlay rather than reusing the Daylight one', () => {
    for (const name of MUST_INVERT) {
      const token = `--${name}`;
      expect(bySystem.has(token), `${token} is not redefined for Midnight`).toBe(true);
      expect(bySystem.get(token), `${token} still holds its Daylight value`).not.toBe(
        daylight.get(token),
      );
    }
  });

  it('keeps the two Midnight blocks in step', () => {
    expect([...byChoice.entries()].sort()).toEqual([...bySystem.entries()].sort());
  });

  it('gives each palette a plain-hex colour for the browser chrome', () => {
    // The meta tag takes a colour, not a colour function, so neither of these
    // may be answered with the P3 form.
    expect(daylight.get('--theme-color')).toMatch(/^#[0-9a-f]{6}$/);
    expect(bySystem.get('--theme-color')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/* ===========================================================================
 * CONTRAST, COMPUTED
 * ---------------------------------------------------------------------------
 * The brief requires every category pair to clear AA at 14px for its ink on
 * its own wash and on the ground, and says to compute it rather than eyeball
 * it. This is that computation, run against the token file itself rather than
 * against a copy of the values, so it cannot drift out of step with what ships.
 *
 * It has already earned its place. As first written the palette had
 * `--color-ink-3` at 2.82:1 on base — carrying every row subtitle, chart axis
 * and caption in the app — under a comment claiming it was AA at 12px and up.
 * The food and obligation inks were 4.44:1 and 4.13:1 on their own washes.
 * ======================================================================== */

const FAMILIES = ['housing', 'food', 'transport', 'obligation', 'leisure', 'health'] as const;

function hex(theme: Map<string, string>, token: string): string {
  const raw = theme.get(token);
  expect(raw, `${token} is not defined`).toBeDefined();
  return raw!;
}

for (const [name, theme] of [
  ['Daylight', daylight],
  ['Midnight', bySystem],
] as const) {
  describe(`${name} clears WCAG AA at 14px`, () => {
    const base = hex(theme, '--color-base');
    const surface = hex(theme, '--color-surface');
    const sunken = hex(theme, '--color-sunken');

    for (const family of FAMILIES) {
      it(`${family} ink reads on its own wash, on base and on surface`, () => {
        const ink = hex(theme, `--color-${family}`);
        const wash = hex(theme, `--color-${family}-wash`);
        expect(contrast(ink, wash), `${family} ink on its wash`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(ink, base), `${family} ink on base`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(ink, surface), `${family} ink on surface`).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }

    it('every ink level that carries type reads on every ground', () => {
      for (const token of ['--color-ink', '--color-ink-2', '--color-ink-3']) {
        const ink = hex(theme, token);
        for (const [groundName, ground] of [
          ['base', base],
          ['surface', surface],
          ['sunken', sunken],
        ] as const) {
          expect(contrast(ink, ground), `${token} on ${groundName}`).toBeGreaterThanOrEqual(
            AA_TEXT,
          );
        }
      }
    });

    /*
     * `ink-4` is the odd one out and stays that way on purpose. It is the
     * muted half of a paired bar and the fill of a dim track — never type. So
     * it is held to the non-text threshold, and this says which rule it is
     * being judged by rather than quietly exempting it from the other one.
     */
    it('holds ink-4 to the non-text rule, because it never carries type', () => {
      const ink4 = hex(theme, '--color-ink-4');
      expect(contrast(ink4, base), 'ink-4 is a fill, not a text colour').toBeLessThan(AA_TEXT);
    });

    /*
     * The hot accent is a fill and a marker: the record button, and the single
     * dot marking the one thing needing a decision. WCAG asks 3:1 of a
     * non-text mark that carries meaning and it clears that. It does not clear
     * 4.5:1 as type on either ground, which is why nothing sets small text in
     * it — an inline link takes ink or the screen's category ink instead.
     */
    it('keeps the hot accent legible as a mark, and admits it is not a text colour', () => {
      const hot = hex(theme, '--color-hot');
      expect(contrast(hot, base), 'hot as a mark on base').toBeGreaterThanOrEqual(AA_LARGE);
      expect(contrast('#ffffff', hot), 'white glyph on hot').toBeGreaterThanOrEqual(AA_LARGE);
    });
  });
}

/* ===========================================================================
 * NO COMPONENT DECIDES WHAT COLOUR AN OVERLAY IS
 * ---------------------------------------------------------------------------
 * `white/8` is a hairline on a dark card and an invisible one on a light card.
 * `[color-scheme:dark]` on a date input forces the native picker dark on a
 * light screen. Both are how a theme leaks: each is locally reasonable and
 * only wrong once the ground underneath it can change.
 * ======================================================================== */

describe('no component hard-codes a theme', () => {
  const files = sourceFiles(SRC);

  it('uses the named overlay tokens rather than white/N or black/N', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/(?<![\w-])(?:white|black)\/\d+/g)) {
        offenders.push(`${file.slice(SRC.length)}: ${match[0]}`);
      }
    }
    expect(
      offenders,
      'Use var(--hairline), var(--rim-top), var(--fill-subtle) or var(--scrim)',
    ).toEqual([]);
  });

  it('lets native controls follow the document colour scheme', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (/\[color-scheme:\s*dark\]/.test(readFileSync(file, 'utf8'))) {
        offenders.push(file.slice(SRC.length));
      }
    }
    expect(offenders, 'These force a dark date picker onto a light screen').toEqual([]);
  });
});

/* ===========================================================================
 * THE VIEWPORT LOCK
 * ---------------------------------------------------------------------------
 * `100dvh` is not the height of the screen on the platform this app is mostly
 * used on. In an iOS home-screen app with a translucent status bar it comes
 * back one status-bar inset short — 793px on a screen that is 852px tall.
 *
 * That alone would be survivable. What made it a defect is that `#app-shell`
 * carries `will-change: transform` for the sheet-recede effect, and that makes
 * it the containing block for every `position: fixed` descendant. So the
 * floating dock's `bottom: 0` stopped meaning "the bottom of the screen" and
 * started meaning "the bottom of a box that is 59px short".
 *
 * It is invisible everywhere `dvh` happens to be right, which is every browser
 * anybody develops in. So it is guarded here rather than by looking.
 * ======================================================================== */

describe('the shell is pinned to the viewport by its edges', () => {
  function rule(selector: string): string {
    const at = CSS.indexOf(selector);
    expect(at, `${selector} is missing from tokens.css`).toBeGreaterThan(-1);
    const open = CSS.indexOf('{', at);
    return CSS.slice(open, CSS.indexOf('}', open));
  }

  it('sizes html and body by inset, never in viewport units', () => {
    const lock = rule('html,\n  body {');
    expect(lock).toMatch(/position:\s*fixed/);
    expect(lock).toMatch(/inset:\s*0/);
    expect(lock, '100dvh is a status bar short in an iOS home-screen app').not.toMatch(/dvh|vh|vw/);
  });

  it('pins #app-shell itself, because it is the dock’s containing block', () => {
    const shell = rule('#app-shell {');
    expect(shell).toMatch(/position:\s*fixed/);
    expect(shell).toMatch(/inset:\s*0/);
  });

  it('leaves no viewport-unit height on the shell element in the markup', () => {
    const shell = readFileSync(join(SRC, 'features', 'shell', 'AppShell.tsx'), 'utf8');
    const tag = shell.slice(shell.indexOf('id="app-shell"'));
    const classes = tag.slice(0, tag.indexOf('>'));
    expect(classes, 'the shell takes its box from tokens.css, not from a class').not.toMatch(
      /h-dvh|min-h-dvh|h-screen/,
    );
  });
});
