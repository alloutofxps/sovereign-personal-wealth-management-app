import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizePayee, payeeKey, toDisplayCase, wasCleaned } from './payeeNormalizer';

describe('the descriptors banks actually send', () => {
  const cases: [string, string][] = [
    ['SumUp *KOFFIE 0031204 Amsterdam', 'Koffie'],
    ['iDEAL* 1234567890 ALBERT HEIJN 1234 AMSTERDAM', 'Albert Heijn'],
    ['PAYPAL *SPOTIFY 35314369001 IE', 'Spotify'],
    ['SQ *THE CORNER SHOP', 'The Corner Shop'],
    ['TST* PIZZA EXPRESS 04-09', 'Pizza Express'],
    ['Zettle_*BAKERY', 'Bakery'],
    ['POS JUMBO SUPERMARKTEN 5512 UTRECHT', 'Jumbo Supermarkten'],
    ['BEA   NS GROEP 12:04', 'NS Groep'],
    ['CARD PURCHASE ETOS 8891 ROTTERDAM', 'Etos'],
    ['STRIPE*NOTION LABS 8005551234', 'Notion Labs'],
  ];

  for (const [raw, expected] of cases) {
    it(`reads ${raw.slice(0, 34)} as ${expected}`, () => {
      expect(normalizePayee(raw)).toBe(expected);
    });
  }
});

describe('what it leaves alone', () => {
  it('keeps a name that is already clean', () => {
    expect(normalizePayee('Albert Heijn')).toBe('Albert Heijn');
    expect(wasCleaned('Albert Heijn')).toBe(false);
  });

  it('does not eat a shop whose name starts like a prefix', () => {
    // "Square One" is a shop. "SQ *" is an acquirer. Only the second is cut.
    expect(normalizePayee('Square One Cafe')).toBe('Square One Cafe');
    expect(normalizePayee('Post Office')).toBe('Post Office');
  });

  it('strips only one prefix, so a wallet paying a terminal keeps the shop', () => {
    // PayPal is the wallet; SQ is how that merchant takes cards. Cutting both
    // would be right for the first and wrong for the second.
    expect(normalizePayee('PAYPAL *SQ FLOWERS')).toBe('SQ Flowers');
  });

  it('gives the original back rather than nothing', () => {
    // Stripping everything would leave an unnameable row in the queue.
    expect(normalizePayee('SumUp *0031204')).toBe('SumUp *0031204');
    expect(normalizePayee('12345678')).toBe('12345678');
  });

  it('leaves a genuinely empty string empty', () => {
    expect(normalizePayee('')).toBe('');
    expect(normalizePayee('   ')).toBe('');
  });

  it('keeps a transfer description intact rather than guessing at a name', () => {
    // Turning this into "Vries" would be worse than leaving it ugly: a wrong
    // name is harder to notice than an untidy one.
    const raw = 'SEPA OVERBOEKING J DE VRIES';
    expect(normalizePayee(raw)).toBe('J De Vries');
  });
});

describe('case', () => {
  it('calms a shouted name down', () => {
    expect(toDisplayCase('ALBERT HEIJN')).toBe('Albert Heijn');
  });

  it('leaves short initialisms shouting', () => {
    expect(toDisplayCase('NS GROEP')).toBe('NS Groep');
    expect(toDisplayCase('KLM')).toBe('KLM');
  });

  it('does not touch something already mixed', () => {
    expect(toDisplayCase('eBay')).toBe('eBay');
    expect(toDisplayCase('McDonalds')).toBe('McDonalds');
  });
});

describe('recognising the same shop twice', () => {
  it('gives one key for the many ways a bank writes it', () => {
    const first = payeeKey('SumUp *KOFFIE 0031204 Amsterdam');
    const second = payeeKey('SumUp *KOFFIE 0099871 Amsterdam');
    const third = payeeKey('  koffie  ');

    // The reference number differs on every visit. That is the whole problem
    // this solves: without it, a rule matches once and never again.
    expect(first).toBe(second);
    expect(first).toBe(third);
  });

  it('keeps different shops apart', () => {
    expect(payeeKey('SQ *THE CORNER SHOP')).not.toBe(payeeKey('SQ *THE OTHER SHOP'));
  });
});

describe('properties', () => {
  it('never returns an empty name for a non-empty descriptor', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), (raw) => {
        const cleaned = normalizePayee(raw);
        if (raw.trim() === '') {
          expect(cleaned).toBe('');
        } else {
          expect(cleaned.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is stable: cleaning a cleaned name changes nothing further', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), (raw) => {
        const once = normalizePayee(raw);
        expect(normalizePayee(once)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });

  it('never invents characters that were not in the descriptor', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z ]{1,40}$/),
        (raw) => {
          const cleaned = normalizePayee(raw).toLowerCase().replace(/\s/g, '');
          const source = raw.toLowerCase().replace(/\s/g, '');
          for (const char of cleaned) expect(source).toContain(char);
        },
      ),
      { numRuns: 200 },
    );
  });
});
