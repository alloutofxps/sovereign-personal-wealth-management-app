import { describe, expect, it } from 'vitest';
import {
  compileRules,
  describeMatch,
  isUnsafePattern,
  matchRule,
  type Rule,
} from './matcher';
import {
  describePrediction,
  isSameMerchant,
  normaliseMerchant,
  predictFromHistory,
  type MerchantHistoryRow,
} from '@/core/taxonomy/merchantMemory';

/* ===========================================================================
 * THE RULES ENGINE
 * ======================================================================== */

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  pattern: 'tesco',
  isRegex: false,
  matchField: 'description',
  categoryId: 'cat-groceries',
  envelopeId: 'pot-groceries',
  priority: 0,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('matching a statement row against rules', () => {
  it('matches a plain pattern anywhere in the text, whatever the case', () => {
    const compiled = compileRules([rule()]);
    expect(matchRule(compiled, { description: 'TESCO STORES 3428' })?.categoryId).toBe(
      'cat-groceries',
    );
    expect(matchRule(compiled, { description: 'a trip to Tesco' })?.categoryId).toBe(
      'cat-groceries',
    );
    expect(matchRule(compiled, { description: 'SAINSBURYS' })).toBeNull();
  });

  it('runs the lowest priority number first', () => {
    const compiled = compileRules([
      rule({ id: 'general', pattern: 'shop', priority: 10, categoryId: 'cat-shopping' }),
      rule({ id: 'specific', pattern: 'coffee shop', priority: 1, categoryId: 'cat-eating-out' }),
    ]);
    // Both patterns match; the more specific one was given the lower number.
    expect(matchRule(compiled, { description: 'THE COFFEE SHOP' })?.ruleId).toBe('specific');
  });

  it('breaks a tie the same way every time', () => {
    const older = rule({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z', categoryId: 'cat-a' });
    const newer = rule({ id: 'a', createdAt: '2026-06-01T00:00:00.000Z', categoryId: 'cat-b' });
    // Same priority, given in both orders: the older rule wins either way.
    expect(matchRule(compileRules([older, newer]), { description: 'tesco' })?.categoryId).toBe(
      'cat-a',
    );
    expect(matchRule(compileRules([newer, older]), { description: 'tesco' })?.categoryId).toBe(
      'cat-a',
    );
  });

  it('ignores rules that have been switched off', () => {
    const compiled = compileRules([rule({ active: false })]);
    expect(matchRule(compiled, { description: 'TESCO' })).toBeNull();
  });

  it('can match the bank descriptor rather than the tidied description', () => {
    const compiled = compileRules([rule({ pattern: 'POS DEBIT', matchField: 'raw_descriptor' })]);
    expect(
      matchRule(compiled, { description: 'Tesco', rawDescriptor: 'POS DEBIT 4412 TESCO' }),
    ).not.toBeNull();
    // With no raw descriptor it falls back rather than silently never matching.
    expect(matchRule(compiled, { description: 'POS DEBIT 4412' })).not.toBeNull();
  });

  it('handles a real regular expression', () => {
    const compiled = compileRules([rule({ pattern: '^(tesco|sainsburys)\\b', isRegex: true })]);
    expect(matchRule(compiled, { description: 'Tesco Metro' })).not.toBeNull();
    expect(matchRule(compiled, { description: 'not tesco' })).toBeNull();
  });

  it('skips a malformed pattern instead of throwing', () => {
    const compiled = compileRules([rule({ pattern: '([unclosed', isRegex: true })]);
    expect(compiled[0]?.problem).toMatch(/could not understand/i);
    expect(() => matchRule(compiled, { description: 'anything' })).not.toThrow();
    expect(matchRule(compiled, { description: 'anything' })).toBeNull();
  });

  it('refuses a pattern that could hang the tab', () => {
    // Nested quantifiers: the classic catastrophic-backtracking shape.
    expect(isUnsafePattern('(a+)+b')).toBe(true);
    expect(isUnsafePattern('(x*)*')).toBe(true);
    expect(isUnsafePattern('a'.repeat(300))).toBe(true);
    // ...without refusing the ordinary ones.
    expect(isUnsafePattern('^tesco')).toBe(false);
    expect(isUnsafePattern('(tesco|asda)')).toBe(false);

    const compiled = compileRules([rule({ pattern: '(a+)+b', isRegex: true })]);
    expect(compiled[0]?.regex).toBeNull();
    expect(compiled[0]?.problem).toMatch(/very long time/i);
    expect(matchRule(compiled, { description: 'aaaaaaaaaaaaaaaaaaaaaaaaaaa!' })).toBeNull();
  });

  it('never matches on an empty description', () => {
    expect(matchRule(compileRules([rule()]), { description: '' })).toBeNull();
  });

  it('says what it did in words', () => {
    const match = matchRule(compileRules([rule()]), { description: 'TESCO' })!;
    expect(describeMatch(match, 'Food shopping')).toBe(
      'Filed by your rule "tesco" as food shopping',
    );
  });
});

/* ===========================================================================
 * MERCHANT MEMORY
 * ======================================================================== */

const past = (categoryId: string, date = '2026-09-01'): MerchantHistoryRow => ({
  categoryId,
  envelopeId: categoryId.replace('cat-', 'pot-'),
  categoryName: categoryId === 'cat-groceries' ? 'Food shopping' : 'Eating out',
  date,
});

describe('remembering where a merchant is usually filed', () => {
  it('reduces a bank descriptor to the shop behind it', () => {
    expect(normaliseMerchant('TESCO STORES 3428 REF 998877665544')).toBe('TESCO STORES');
    expect(normaliseMerchant('Tesco  Stores   3428')).toBe('TESCO STORES');
  });

  it('lands on the same key however the bank dressed the line up', () => {
    // The property that actually matters: one shop, one key. Reference
    // numbers, terminal ids and the bank's own filler all vary line to line,
    // and any of them leaking through means the memory never builds up.
    const forms = [
      'TESCO STORES 3428 REF 998877665544',
      'Tesco  Stores 9999',
      'POS DEBIT TESCO STORES 1122',
      'tesco stores, card 4412',
    ].map(normaliseMerchant);
    expect(new Set(forms).size).toBe(1);
    expect(forms[0]).toBe('TESCO STORES');
  });

  it('says nothing at all when there is only one past payment', () => {
    expect(predictFromHistory([past('cat-groceries')])).toBeNull();
  });

  it('predicts a merchant filed the same way every time', () => {
    const prediction = predictFromHistory([
      past('cat-groceries'),
      past('cat-groceries'),
      past('cat-groceries'),
    ]);
    expect(prediction?.categoryId).toBe('cat-groceries');
    expect(prediction?.envelopeId).toBe('pot-groceries');
    expect(prediction?.confidence).toBe(1);
    expect(prediction?.sampleSize).toBe(3);
  });

  it('still predicts when the history is mostly consistent', () => {
    // Three of four is 75%, exactly the threshold.
    const prediction = predictFromHistory([
      past('cat-groceries'),
      past('cat-groceries'),
      past('cat-groceries'),
      past('cat-eating-out'),
    ]);
    expect(prediction?.categoryId).toBe('cat-groceries');
    expect(prediction?.confidence).toBe(0.75);
  });

  it('says nothing when the history is genuinely mixed', () => {
    // A wrong guess confirmed by reflex is worse than no guess at all.
    expect(
      predictFromHistory([past('cat-groceries'), past('cat-eating-out')]),
    ).toBeNull();
    expect(
      predictFromHistory([
        past('cat-groceries'),
        past('cat-groceries'),
        past('cat-eating-out'),
        past('cat-eating-out'),
      ]),
    ).toBeNull();
  });

  it('prefers the most recent spelling of a renamed category', () => {
    const prediction = predictFromHistory([
      { ...past('cat-groceries', '2026-01-01'), categoryName: 'Groceries' },
      { ...past('cat-groceries', '2026-09-01'), categoryName: 'Food shopping' },
    ]);
    expect(prediction?.categoryName).toBe('Food shopping');
  });

  it('explains itself in a sentence rather than a percentage', () => {
    const always = predictFromHistory([past('cat-groceries'), past('cat-groceries')])!;
    expect(describePrediction(always)).toBe(
      'You always file this as food shopping, going by your last 2 payments.',
    );

    const usually = predictFromHistory([
      past('cat-groceries'),
      past('cat-groceries'),
      past('cat-groceries'),
      past('cat-eating-out'),
    ])!;
    expect(describePrediction(usually)).toMatch(/^Usually food shopping, going by your last 4/);
  });
});

describe('deciding whether two descriptors are the same shop', () => {
  it('sees through the wording Sovereign adds to its own descriptions', () => {
    // An entry's description is a sentence. The merchant has to survive it,
    // or nothing typed into a payee box ever matches recorded history.
    expect(isSameMerchant('Paid Waterstones.', 'Waterstones')).toBe(true);
  });

  it('accepts the extra words a bank puts on the end', () => {
    expect(isSameMerchant('WATERSTONES BOOKSELLERS 771', 'Waterstones')).toBe(true);
    expect(isSameMerchant('Paid Waterstones.', 'WATERSTONES BOOKSELLERS 771')).toBe(true);
  });

  it('refuses the coincidences a plain substring test would allow', () => {
    // The trap: "BP" is inside "BPOST", and they are not the same company.
    expect(isSameMerchant('BP', 'BPOST')).toBe(false);
    expect(isSameMerchant('Tesco', 'Tesco Bank')).toBe(true);
    expect(isSameMerchant('Sainsburys', 'Waterstones')).toBe(false);
  });

  it('says no rather than guessing on nothing', () => {
    expect(isSameMerchant('', 'Waterstones')).toBe(false);
    expect(isSameMerchant('   ', '  ')).toBe(false);
  });
});
