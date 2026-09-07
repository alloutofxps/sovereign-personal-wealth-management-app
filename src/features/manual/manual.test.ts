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

import { describe, expect, it } from 'vitest';
import { ROUTES, parseHash } from '@/app/router';
import { CHAPTERS } from './chapters/slugs';

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
