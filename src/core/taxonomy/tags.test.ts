import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_TAG_LENGTH,
  TagError,
  assertUsableTagName,
  describeSelection,
  describeTagRemoval,
  describeTagging,
  describeUntagging,
  normaliseTagName,
  sameTag,
  tagSlug,
} from './tags';

describe('tidying a name', () => {
  it('trims and collapses the spaces somebody typed', () => {
    expect(normaliseTagName('  Italy   2026 ')).toBe('Italy 2026');
  });

  it('leaves the case alone', () => {
    // Somebody who typed NYC meant NYC. The slug decides what matches.
    expect(normaliseTagName('NYC')).toBe('NYC');
    expect(normaliseTagName('kitchen')).toBe('kitchen');
  });
});

describe('recognising the same tag twice', () => {
  it('ignores case and spacing', () => {
    expect(sameTag('Italy 2026', '  italy   2026 ')).toBe(true);
    expect(tagSlug('Italy 2026')).toBe('italy-2026');
  });

  it('treats punctuation as a separator rather than as a character', () => {
    expect(tagSlug("Sam & Alex's wedding")).toBe('sam-alex-s-wedding');
    expect(sameTag('kitchen/bathroom', 'Kitchen Bathroom')).toBe(true);
  });

  it('does not leave a hyphen hanging off either end', () => {
    expect(tagSlug('  —holiday—  ')).toBe('holiday');
    expect(tagSlug('!!!')).toBe('');
  });

  it('keeps genuinely different tags apart', () => {
    expect(sameTag('Italy 2026', 'Italy 2027')).toBe(false);
    expect(sameTag('kitchen', 'kitchens')).toBe(false);
  });
});

describe('what it refuses', () => {
  it('refuses a name with nothing in it', () => {
    expect(() => assertUsableTagName('   ')).toThrow(TagError);
    expect(() => assertUsableTagName('')).toThrow(/needs a name/);
  });

  it('refuses a name with no letter or number to match on', () => {
    // "***" would slug to nothing, and two such tags would collide silently.
    expect(() => assertUsableTagName('***')).toThrow(/letter or number/);
  });

  it('refuses one too long to read on a phone', () => {
    expect(() => assertUsableTagName('x'.repeat(MAX_TAG_LENGTH + 1))).toThrow(/longer than/);
    expect(assertUsableTagName('x'.repeat(MAX_TAG_LENGTH))).toHaveLength(MAX_TAG_LENGTH);
  });

  it('gives back the tidied name when it is happy', () => {
    expect(assertUsableTagName('  Italy   2026 ')).toBe('Italy 2026');
  });

  it('says what to do rather than what went wrong', () => {
    for (const bad of ['', '   ', '***', 'x'.repeat(MAX_TAG_LENGTH + 5)]) {
      try {
        assertUsableTagName(bad);
        expect.unreachable('should have refused');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toMatch(/invalid|error|failed|null|undefined/i);
        expect(message.endsWith('.')).toBe(true);
      }
    }
  });
});

describe('what it says afterwards', () => {
  it('counts out loud, because a bulk change has no other evidence', () => {
    expect(describeTagging(14, 'Italy 2026')).toBe('Tagged 14 payments as Italy 2026.');
    expect(describeTagging(1, 'Kitchen')).toBe('Tagged 1 payment as Kitchen.');
    expect(describeUntagging(3, 'Kitchen')).toBe('Took Kitchen off 3 payments.');
  });

  it('says plainly when nothing actually changed', () => {
    expect(describeTagging(0, 'Kitchen')).toMatch(/already had Kitchen/);
    expect(describeUntagging(0, 'Kitchen')).toMatch(/None of them had Kitchen/);
  });

  it('gets the plural right on the selection bar', () => {
    expect(describeSelection(0)).toMatch(/Nothing chosen yet/);
    expect(describeSelection(1)).toBe('1 payment chosen');
    expect(describeSelection(9)).toBe('9 payments chosen');
    expect(describeSelection(2, 'row')).toBe('2 rows chosen');
  });

  it('promises the payments survive when a tag does not', () => {
    const said = describeTagRemoval('Italy 2026', 12);
    expect(said).toContain('12 payments');
    expect(said).toMatch(/payments themselves are not touched/);
    expect(describeTagRemoval('Italy 2026', 0)).toMatch(/not on anything/);
  });

  it('never threatens somebody with losing their records', () => {
    for (const said of [
      describeTagRemoval('Kitchen', 4),
      describeTagRemoval('Kitchen', 0),
      describeUntagging(4, 'Kitchen'),
    ]) {
      expect(said).not.toMatch(/delete|destroy|permanent|cannot be undone/i);
    }
  });
});

describe('properties', () => {
  it('a slug is always safe to put in a URL or an index', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), (raw) => {
        const slug = tagSlug(raw);
        expect(slug).toMatch(/^[a-z0-9-]*$/);
        expect(slug).not.toMatch(/^-|-$|--/);
      }),
      { numRuns: 400 },
    );
  });

  it('slugging a slug changes nothing further', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), (raw) => {
        const once = tagSlug(raw);
        expect(tagSlug(once)).toBe(once);
      }),
      { numRuns: 400 },
    );
  });

  it('anything it accepts has a slug to match on', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: MAX_TAG_LENGTH }), (raw) => {
        let name: string;
        try {
          name = assertUsableTagName(raw);
        } catch {
          return; // Refusing is a fine outcome; this is about what it accepts.
        }
        expect(tagSlug(name).length).toBeGreaterThan(0);
      }),
      { numRuns: 400 },
    );
  });

  it('two names agree as tags exactly when their slugs do', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (a, b) => {
          expect(sameTag(a, b)).toBe(tagSlug(a) === tagSlug(b));
        },
      ),
      { numRuns: 300 },
    );
  });
});
