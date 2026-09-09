/* ===========================================================================
 * THE CHAPTER ADDRESSES
 * ---------------------------------------------------------------------------
 * A slug is not an internal identifier. It is the second half of a hash that
 * somebody can bookmark, send to someone, or come back to in a year, and the
 * screens that link into the manual are compiled against this list.
 *
 * These tests live here rather than beside the router because the router may
 * not know about features — dependencies run one way — and because what is
 * being checked is a promise the manual makes, not something routing does.
 * ======================================================================== */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTES, parseHash } from '@/app/router';
import { EXPLANATIONS } from '@/content/explain/registry';
import { CHAPTERS } from './chapters/slugs';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('every chapter slug', () => {
  it('resolves to the manual, carrying the chapter with it', () => {
    for (const slug of CHAPTERS) {
      expect(parseHash(`#/manual/${slug}`)).toEqual({ route: 'manual', detail: slug });
    }
  });

  it('appears once, so a link cannot mean two chapters', () => {
    expect(new Set(CHAPTERS).size).toBe(CHAPTERS.length);
  });

  it('uses only characters that survive being put in a URL', () => {
    for (const slug of CHAPTERS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  it('stays a chapter even when it is spelled like a screen', () => {
    // 'pots' is both. That is fine: a detail only means anything inside the
    // route it follows, so #/manual/pots is the chapter and #/pots is the
    // screen, and neither can be read as the other.
    expect(CHAPTERS as readonly string[]).toContain('pots');
    expect(ROUTES as readonly string[]).toContain('pots');
    expect(parseHash('#/manual/pots').route).toBe('manual');
    expect(parseHash('#/pots')).toEqual({ route: 'pots', detail: null });
  });
});

/* ===========================================================================
 * THE SHORT ANSWER AND THE LONG ONE OPEN THE SAME WAY
 * ---------------------------------------------------------------------------
 * The brief asks that a chapter open with the same line as its `Explain`
 * entry, so the two never drift.
 *
 * `Standfirst` renders `EXPLANATIONS[slug].short` rather than a copy of it, so
 * they cannot drift even in principle — there is one string. What can still go
 * wrong is somebody writing a chapter and forgetting the component, or a slug
 * and a topic id parting company so the lookup silently resolves to the wrong
 * explanation. That is what these check.
 * ======================================================================== */

describe('a chapter opens with its own explanation', () => {
  it('has an explanation under every chapter slug', () => {
    for (const slug of CHAPTERS) {
      expect(EXPLANATIONS[slug], `no explanation for the ${slug} chapter`).toBeDefined();
      expect(EXPLANATIONS[slug].short.length).toBeGreaterThan(20);
    }
  });

  it('points that explanation back at the chapter it opens', () => {
    // Both directions. Forwards is the sheet's "read the whole story" link;
    // backwards is the standfirst. A topic whose `manual` names a different
    // chapter would give a sheet that links somewhere other than the chapter
    // quoting it.
    for (const slug of CHAPTERS) {
      expect(EXPLANATIONS[slug].manual, `${slug} does not link back to itself`).toBe(slug);
    }
  });

  it('renders the standfirst in every chapter body', () => {
    const dir = join(HERE, 'chapters');
    const bodies = readdirSync(dir).filter((f) => /\.tsx$/.test(f));

    // Six chapters, six files. A seventh file here without a standfirst is the
    // case this exists to catch.
    expect(bodies).toHaveLength(CHAPTERS.length);

    const missing = bodies.filter(
      (file) => !readFileSync(join(dir, file), 'utf8').includes('<Standfirst slug='),
    );
    expect(
      missing,
      'A chapter that writes its own opening line is a chapter that can drift from the ' +
        'Explain sheet quoting it. Use <Standfirst slug="…" />',
    ).toEqual([]);
  });

  it('gives each chapter the standfirst for its own slug, not another', () => {
    const dir = join(HERE, 'chapters');
    const index = readFileSync(join(dir, 'index.ts'), 'utf8');

    for (const slug of CHAPTERS) {
      // The component named against this slug in the reading order.
      const block = index.slice(index.indexOf(`slug: '${slug}'`));
      const body = block.match(/Body: (\w+)/)?.[1];
      expect(body, `no Body for ${slug}`).toBeDefined();

      const file = readdirSync(dir).find((f) =>
        readFileSync(join(dir, f), 'utf8').includes(`export function ${body}(`),
      );
      expect(file, `no file exports ${body}`).toBeDefined();

      const source = readFileSync(join(dir, file!), 'utf8');
      expect(source, `${body} opens with another chapter's line`).toContain(
        `<Standfirst slug="${slug}" />`,
      );
    }
  });
});
