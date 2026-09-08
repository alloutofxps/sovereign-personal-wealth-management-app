import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

function definedTokens(prefix: string): Set<string> {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'));
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
    // bg-, text-, border-, from-, to- … followed by one of our token names.
    const pattern = /\b(?:bg|text|border|ring|fill|stroke|divide|decoration)-([a-z][a-z0-9-]*)/g;
    const offenders: string[] = [];

    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(pattern)) {
        const name = match[1]!.replace(/\/\d+$/, '');
        // Only judge names that look like ours: ink, liquid, caution, deficit…
        if (!/^(ink|liquid|caution|deficit|line|base|surface|raised|overlay|sunken)/.test(name)) {
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
    expect(radii.has('pill')).toBe(true);
    expect(radii.has('enormous')).toBe(false);
  });
});

/* ===========================================================================
 * THE LIGHT PALETTE GUARD
 * ---------------------------------------------------------------------------
 * A token that is defined for dark and forgotten for light does not fail
 * anywhere either. It simply keeps its dark value, and one element on an
 * otherwise white screen renders near-black text on near-black ground, or
 * emerald at a chroma that is unreadable off obsidian. It is invisible in
 * review because review happens in whichever theme the reviewer is in.
 *
 * The light palette is also written out twice — once for a light system, once
 * for an explicit choice — because CSS has no way to share one declaration
 * list between a media query and an attribute selector. Two copies of anything
 * drift, so this checks they have not.
 * ======================================================================== */

/** Everything that has to differ between the two palettes. */
const MUST_INVERT = [
  'hairline',
  'hairline-strong',
  'rim-top',
  'fill-subtle',
  'scrim',
  'shadow-card',
  'shadow-dock',
  'shadow-sheet',
  'theme-color',
];

function block(css: string, opener: string): Map<string, string> {
  const start = css.indexOf(opener);
  expect(start, `${opener} is missing from tokens.css`).toBeGreaterThan(-1);
  const from = start + opener.length;
  const end = css.indexOf('\n}', from);
  const body = css.slice(from, end);
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(match[1]!, match[2]!.trim());
  }
  return declarations;
}

describe('the light palette covers everything the dark one defines', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  // The first @theme block is the dark default. The P3 one that follows only
  // widens colours that are already there, so it is not a source of names.
  const dark = block(css, '@theme {');
  const bySystem = block(css, ":root:not([data-theme='dark']) {");
  const byChoice = block(css, ":root[data-theme='light'] {");

  it('reads all three blocks', () => {
    expect(dark.size).toBeGreaterThan(20);
    expect(bySystem.size).toBeGreaterThan(20);
    expect(byChoice.size).toBeGreaterThan(20);
  });

  it('leaves no colour on its dark value', () => {
    const missing = [...dark.keys()].filter(
      (name) => name.startsWith('--color-') && !bySystem.has(name),
    );
    expect(missing, 'These would render at their dark value on a white screen').toEqual([]);
  });

  it('inverts every overlay rather than reusing the dark one', () => {
    for (const name of MUST_INVERT) {
      const token = `--${name}`;
      expect(bySystem.has(token), `${token} is not redefined for light`).toBe(true);
      expect(bySystem.get(token), `${token} still holds its dark value`).not.toBe(dark.get(token));
    }
  });

  it('keeps the two light blocks in step', () => {
    expect([...byChoice.entries()].sort()).toEqual([...bySystem.entries()].sort());
  });

  it('gives each palette a plain-hex colour for the browser chrome', () => {
    // The meta tag takes a colour, not a colour function, so neither of these
    // may be answered with the P3 form.
    expect(dark.get('--theme-color')).toMatch(/^#[0-9a-f]{6}$/);
    expect(bySystem.get('--theme-color')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/* ===========================================================================
 * NO COMPONENT DECIDES WHAT COLOUR AN OVERLAY IS
 * ---------------------------------------------------------------------------
 * `white/8` is a hairline on a dark card and an invisible one on a white card.
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
 * started meaning "the bottom of a box that is 59px short", and the dock
 * floated 59px above the gap it was already meant to leave.
 *
 * It is invisible everywhere `dvh` happens to be right, which is every
 * browser anybody develops in. So it is guarded here rather than by looking.
 * ======================================================================== */

describe('the shell is pinned to the viewport by its edges', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');

  /** The declarations of one rule, found by its selector. */
  function rule(selector: string): string {
    const at = css.indexOf(selector);
    expect(at, `${selector} is missing from tokens.css`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open, css.indexOf('}', open));
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
    expect(shell, 'will-change is what makes this the containing block').toMatch(
      /will-change:\s*transform/,
    );
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
