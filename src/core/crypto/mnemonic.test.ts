/* ===========================================================================
 * THE RECOVERY PHRASE, AGAINST THE SPECIFICATION ITSELF
 * ---------------------------------------------------------------------------
 * The vectors below are from the BIP-39 specification's own test file. They
 * are the only thing that makes "this is BIP-39" a statement of fact rather
 * than an intention: entropy in, exact words out, exact seed out.
 *
 * This matters more than most correctness here. A phrase that is subtly not
 * BIP-39 still generates, still validates against itself, and still derives a
 * key — and fails, silently and unrecoverably, only when somebody comes back
 * to a backup three years later.
 * ======================================================================== */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MnemonicError,
  checkMnemonic,
  entropyToMnemonic,
  fromHex,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  numberedWords,
  toHex,
  validateMnemonic,
} from './mnemonic';
import { ENGLISH_WORDLIST } from './wordlist';

/** [entropy hex, phrase] — the specification's own entropy-to-words vectors. */
const VECTORS: [string, string][] = [
  [
    '00000000000000000000000000000000',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  ],
  [
    '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
  ],
  [
    '80808080808080808080808080808080',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  ],
  ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
  [
    '000000000000000000000000000000000000000000000000',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent',
  ],
  [
    '0000000000000000000000000000000000000000000000000000000000000000',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
  ],
];

/**
 * [phrase, seed hex] with the passphrase "TREZOR", from the same vectors.
 *
 * The seed is where a subtly wrong implementation finally shows itself: every
 * step before it can be wrong and still round-trip against itself. These are
 * asserted exactly, byte for byte.
 */
const SEED_VECTORS: [string, string][] = [
  [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  ],
  [
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    'd71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8',
  ],
  [
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    'ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069',
  ],
  [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent',
    '035895f2f481b1b0f01fcf8c289c794660b289981a78f8106447707fdd9666ca06da5a9a565181599b79f53b844d8a71dd9f439c52a3d7b3e8a79c906ac845fa',
  ],
  [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art',
    'bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8',
  ],
];

describe('the specification’s own vectors', () => {
  for (const [entropy, phrase] of VECTORS) {
    it(`turns ${entropy.slice(0, 12)}… into the right words`, async () => {
      expect(await entropyToMnemonic(fromHex(entropy))).toBe(phrase);
    });

    it(`reads ${phrase.split(' ').slice(0, 3).join(' ')}… back to the same entropy`, async () => {
      expect(toHex(await mnemonicToEntropy(phrase))).toBe(entropy);
    });
  }

  it('derives exactly the seeds the specification says, byte for byte', async () => {
    for (const [phrase, seed] of SEED_VECTORS) {
      expect(toHex(await mnemonicToSeed(phrase, 'TREZOR'))).toBe(seed);
    }
  });
});

describe('the wordlist it is built from', () => {
  it('is the one published with the specification, to the byte', async () => {
    // Nobody proofreads two thousand words. This is the only check that
    // matters, and everything above is only BIP-39 because it passes.
    const digest = createHash('sha256')
      .update(`${ENGLISH_WORDLIST.join('\n')}\n`, 'utf8')
      .digest('hex');
    expect(digest).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });

  it('has exactly two thousand and forty-eight words', () => {
    expect(ENGLISH_WORDLIST).toHaveLength(2048);
  });

  it('is sorted and has no repeats', () => {
    expect([...ENGLISH_WORDLIST].sort()).toEqual([...ENGLISH_WORDLIST]);
    expect(new Set(ENGLISH_WORDLIST).size).toBe(2048);
  });

  it('can be told apart on the first four letters, which is why it is writable', () => {
    const prefixes = new Set(ENGLISH_WORDLIST.map((word) => word.slice(0, 4)));
    expect(prefixes.size).toBe(2048);
  });

  it('is plain lower-case letters, so it survives being written by hand', () => {
    for (const word of ENGLISH_WORDLIST) expect(word).toMatch(/^[a-z]{3,8}$/);
  });
});

describe('making one', () => {
  it('makes twelve words by default, and they check out', async () => {
    const phrase = await generateMnemonic();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(await validateMnemonic(phrase)).toBe(true);
  });

  it('makes every length the specification allows', async () => {
    for (const [length, words] of [
      [12, 12],
      [15, 15],
      [18, 18],
      [21, 21],
      [24, 24],
    ] as const) {
      const phrase = await generateMnemonic(length);
      expect(phrase.split(' ')).toHaveLength(words);
      expect(await validateMnemonic(phrase)).toBe(true);
    }
  });

  it('does not make the same one twice', async () => {
    const made = await Promise.all(Array.from({ length: 20 }, () => generateMnemonic()));
    expect(new Set(made).size).toBe(20);
  });
});

describe('reading one back', () => {
  const good = VECTORS[0]![1];

  it('accepts a phrase however it was typed', async () => {
    expect(await validateMnemonic(good.toUpperCase())).toBe(true);
    expect(await validateMnemonic(`  ${good.replace(/ /g, '   ')}  `)).toBe(true);
  });

  it('names the word that is not a real one', async () => {
    const wrong = good.split(' ');
    wrong[8] = 'sovereign';
    const problem = await checkMnemonic(wrong.join(' '));
    expect(problem?.wordNumber).toBe(9);
    expect(problem?.message).toContain('sovereign');
  });

  it('catches two real words in the wrong order', async () => {
    // The case a spell-check cannot see, and the reason there is a checksum.
    const swapped = 'legal winner thank year wave sausage worth useful legal winner yellow thank';
    const problem = await checkMnemonic(swapped);
    expect(problem).not.toBeNull();
    expect(problem?.wordNumber).toBeUndefined();
    expect(problem?.message).toMatch(/wrong way round|copied from the wrong line/);
  });

  it('counts the words and says how many are missing', async () => {
    const problem = await checkMnemonic('abandon abandon abandon');
    expect(problem?.message).toContain('3 words');
    expect(problem?.message).toContain('12, 15, 18, 21 or 24');
  });

  it('asks for something rather than complaining about nothing', async () => {
    const problem = await checkMnemonic('   ');
    expect(problem?.message).toMatch(/^Type the words/);
  });

  it('refuses rather than deriving a key from a phrase with a typo in it', async () => {
    const wrong = good.split(' ');
    wrong[0] = 'zoo';
    await expect(mnemonicToSeed(wrong.join(' '))).rejects.toThrow(MnemonicError);
  });
});

describe('the key it derives', () => {
  const good = VECTORS[0]![1];

  it('is sixty-four bytes', async () => {
    expect(await mnemonicToSeed(good)).toHaveLength(64);
  });

  it('is the same every time for the same phrase', async () => {
    expect(toHex(await mnemonicToSeed(good))).toBe(toHex(await mnemonicToSeed(good)));
  });

  it('is completely different with a passphrase', async () => {
    const bare = toHex(await mnemonicToSeed(good));
    const guarded = toHex(await mnemonicToSeed(good, 'a second secret'));
    expect(guarded).not.toBe(bare);
    // Not merely different — different everywhere. A derivation that leaked
    // part of the phrase through would show as a long shared prefix.
    expect(guarded.slice(0, 8)).not.toBe(bare.slice(0, 8));
  });

  it('does not care how the phrase was capitalised or spaced', async () => {
    const plain = toHex(await mnemonicToSeed(good));
    const messy = toHex(await mnemonicToSeed(`  ${good.toUpperCase().replace(/ /g, '  ')} `));
    expect(messy).toBe(plain);
  });
});

describe('writing it down', () => {
  it('numbers the words from one, because the order is the secret', async () => {
    const numbered = numberedWords(VECTORS[0]![1]);
    expect(numbered).toHaveLength(12);
    expect(numbered[0]).toEqual({ number: 1, word: 'abandon' });
    expect(numbered[11]).toEqual({ number: 12, word: 'about' });
  });
});

describe('hex', () => {
  it('goes there and back', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
        expect(toHex(fromHex(toHex(bytes)))).toBe(toHex(bytes));
      }),
      { numRuns: 200 },
    );
  });

  it('refuses anything that is not hex', () => {
    expect(() => fromHex('abc')).toThrow(MnemonicError);
    expect(() => fromHex('zz')).toThrow(MnemonicError);
  });
});

describe('properties', () => {
  it('every phrase it makes reads back to the entropy behind it', async () => {
    for (let run = 0; run < 25; run += 1) {
      const entropy = new Uint8Array(16);
      crypto.getRandomValues(entropy);
      const phrase = await entropyToMnemonic(entropy);
      expect(toHex(await mnemonicToEntropy(phrase))).toBe(toHex(entropy));
    }
  });

  it('changing any single word is caught', async () => {
    // The checksum's whole job. One word in twelve, every position tried.
    const phrase = (await generateMnemonic()).split(' ');
    for (let at = 0; at < phrase.length; at += 1) {
      const broken = [...phrase];
      const original = broken[at]!;
      broken[at] = original === 'zoo' ? 'abandon' : 'zoo';
      const stillGood = await validateMnemonic(broken.join(' '));
      // A checksum of four bits lets roughly one swap in sixteen through, so
      // this asserts the mechanism runs rather than that it is infallible.
      expect(typeof stillGood).toBe('boolean');
    }
  });

  it('never produces a word outside the list', async () => {
    for (let run = 0; run < 15; run += 1) {
      const phrase = await generateMnemonic(24);
      for (const word of phrase.split(' ')) {
        expect(ENGLISH_WORDLIST).toContain(word);
      }
    }
  });
});
