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
      for (const match of readFileSync(file, 'utf8').matchAll(/(?:white|black)\/\d+/g)) {
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
