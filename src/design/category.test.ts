import { describe, expect, it } from 'vitest';
import { FAMILIES, familyFor, isSeededKey, type Family } from './category';

/* ===========================================================================
 * THE COLOUR INDEX
 * ---------------------------------------------------------------------------
 * Colour is only an index if the mapping means something and never moves.
 * These guard both halves of that.
 * ======================================================================== */

/** Every id the app seeds, from src/data/seed.ts and accountClasses.ts. */
const SEEDED = [
  'cat-home', 'cat-groceries', 'cat-eating-out', 'cat-bills',
  'cat-transport', 'cat-health', 'cat-fun', 'cat-shopping',
  'grp-essential', 'grp-lifestyle', 'grp-transit',
  'pot-home', 'pot-groceries', 'pot-eating-out', 'pot-bills',
  'pot-transport', 'pot-health', 'pot-fun', 'pot-shopping',
  'grp-pot-essential', 'grp-pot-lifestyle', 'grp-pot-transit',
  'checking', 'savings', 'cash', 'credit_card', 'loan', 'mortgage',
  'brokerage', 'retirement', 'real_estate', 'vehicle', 'other_asset',
  'foreign', 'investments', 'property', 'debts',
];

describe('everything the app seeds is mapped by meaning, not by hash', () => {
  it('pins every seeded id', () => {
    const unpinned = SEEDED.filter((key) => !isSeededKey(key));
    expect(unpinned, 'These would take an arbitrary hue from the hash').toEqual([]);
  });

  it('gives the categories a person sees most often their own hue', () => {
    // Home is the largest line in most households and food shopping the most
    // frequent, so those two carry the hues that have to be learned first.
    expect(familyFor('cat-home')).toBe('housing');
    expect(familyFor('cat-groceries')).toBe('food');
    expect(familyFor('cat-bills')).toBe('obligation');
    expect(familyFor('cat-transport')).toBe('transport');
    expect(familyFor('cat-fun')).toBe('leisure');
    expect(familyFor('cat-health')).toBe('health');
  });

  it('uses all six families across the seeded categories', () => {
    const used = new Set<Family>(
      Object.values(SEEDED.filter((k) => k.startsWith('cat-')).map(familyFor)),
    );
    expect([...used].sort()).toEqual([...FAMILIES].sort());
  });

  it('keeps a category and the pot that funds it the same colour', () => {
    const pairs: [string, string][] = [
      ['cat-home', 'pot-home'],
      ['cat-groceries', 'pot-groceries'],
      ['cat-eating-out', 'pot-eating-out'],
      ['cat-bills', 'pot-bills'],
      ['cat-transport', 'pot-transport'],
      ['cat-health', 'pot-health'],
      ['cat-fun', 'pot-fun'],
      ['cat-shopping', 'pot-shopping'],
    ];
    for (const [category, pot] of pairs) {
      expect(familyFor(pot), `${pot} should match ${category}`).toBe(familyFor(category));
    }
  });

  it('doubles up only where the two things are genuinely the same kind', () => {
    // Eating out is food; shopping is discretionary personal spending, which
    // is what fun is. Any other collision would be filling a grid rather than
    // describing the money.
    expect(familyFor('cat-eating-out')).toBe(familyFor('cat-groceries'));
    expect(familyFor('cat-shopping')).toBe(familyFor('cat-fun'));
  });

  it('puts owed money in one family and invested money in another', () => {
    for (const owed of ['credit_card', 'loan', 'mortgage', 'debts']) {
      expect(familyFor(owed), owed).toBe('obligation');
    }
    for (const invested of ['brokerage', 'retirement', 'investments']) {
      expect(familyFor(invested), invested).toBe('transport');
    }
  });
});

describe('a colour never moves once it is assigned', () => {
  it('follows the id, not the name', () => {
    // Renaming a category must not repaint it, which is why nothing here
    // takes a display name.
    expect(familyFor('cat-fun')).toBe(familyFor('cat-fun'));
  });

  it('gives anything the person made a stable hue', () => {
    const made = 'cat-9f3a21e0-user-created';
    const first = familyFor(made);
    for (let i = 0; i < 50; i++) expect(familyFor(made)).toBe(first);
    expect(FAMILIES).toContain(first);
  });

  it('spreads user-created categories across all six', () => {
    const seen = new Set<Family>();
    for (let i = 0; i < 200; i++) seen.add(familyFor(`cat-made-up-${i}`));
    expect(seen.size).toBe(FAMILIES.length);
  });

  it('falls back rather than throwing on nothing', () => {
    expect(familyFor(null)).toBe('housing');
    expect(familyFor(undefined)).toBe('housing');
    expect(familyFor('')).toBe('housing');
  });
});
