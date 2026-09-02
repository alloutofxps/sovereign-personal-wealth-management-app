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
