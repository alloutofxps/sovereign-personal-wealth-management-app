/* ===========================================================================
 * A RECOVERY PHRASE
 * ---------------------------------------------------------------------------
 * Sovereign keeps everything on one device and sends nothing anywhere. That is
 * the whole point of it, and it has one consequence nobody enjoys: when the
 * device goes, so does the ledger, and there is nobody to ask.
 *
 * An export is the answer, and an export of somebody's entire financial life
 * is not a file to leave lying in a downloads folder. So it can be encrypted —
 * and a key you cannot write down is a key you will lose exactly when you need
 * it. Twelve words on paper in a drawer is a better backup than a password
 * nobody can remember, and it survives the phone, the laptop and the house
 * move.
 *
 * ---------------------------------------------------------------------------
 * WHY BIP-39 RATHER THAN SOMETHING OF OUR OWN
 *
 * Not for wallet compatibility — nobody is restoring a Sovereign backup into
 * Ledger Live. For the properties, which are hard-won and easy to get wrong:
 *
 *   · a checksum, so a phrase typed back with one word wrong is *refused*
 *     rather than quietly deriving a different key and failing to decrypt with
 *     no explanation;
 *   · a list chosen so no two words share their first four letters, so a
 *     phrase can be written in a hurry and still be read back;
 *   · a key derivation with real work in it, so a stolen backup file cannot be
 *     brute-forced at the speed of a hash.
 *
 * The algorithm is implemented to the specification exactly, and the wordlist
 * beside it is verified by hash against the one published with it. That is
 * what lets this file say BIP-39 rather than "inspired by".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE WILL NOT DO
 *
 * It does not store a phrase, anywhere, ever. It does not put one in
 * `localStorage`, in the database, or in an export. A recovery phrase written
 * to the device it protects is not a recovery phrase, it is a spare key taped
 * to the door — and the whole reason this exists is that the device may not
 * survive.
 * ======================================================================== */

import { ENGLISH_INDEX, ENGLISH_WORDLIST } from './wordlist';

export class MnemonicError extends Error {
  override name = 'MnemonicError';
}

/**
 * How many words. Twelve is 128 bits of entropy and twenty-four is 256.
 *
 * Twelve is the default and is not a compromise: 128 bits is beyond brute
 * force by any margin that means anything, and a phrase somebody actually
 * writes down is worth more than four extra lines they do not.
 */
export type PhraseLength = 12 | 15 | 18 | 21 | 24;

/** Bits of entropy behind each phrase length. Words × 11 − checksum. */
const ENTROPY_BITS: Record<PhraseLength, number> = {
  12: 128,
  15: 160,
  18: 192,
  21: 224,
  24: 256,
};

/** BIP-39 fixes all three of these. They are not tuning knobs. */
const PBKDF2_ITERATIONS = 2048;
const SEED_BITS = 512;
const SALT_PREFIX = 'mnemonic';

/* ===========================================================================
 * MAKING ONE
 * ======================================================================== */

/**
 * A fresh phrase, from the platform's own randomness.
 *
 * `crypto.getRandomValues` and nothing else. A recovery phrase generated from
 * `Math.random` would look identical and be worth nothing, which is precisely
 * why it is worth saying out loud here.
 */
export async function generateMnemonic(length: PhraseLength = 12): Promise<string> {
  const bits = ENTROPY_BITS[length];
  if (bits === undefined) {
    throw new MnemonicError('A recovery phrase can be 12, 15, 18, 21 or 24 words.');
  }

  const entropy = new Uint8Array(bits / 8);
  crypto.getRandomValues(entropy);
  return entropyToMnemonic(entropy);
}

/**
 * Entropy to words.
 *
 * The entropy's own SHA-256 supplies the checksum: the first `bits / 32` of
 * its bits are appended, and the whole run is cut into groups of eleven, each
 * of which names one of two thousand and forty-eight words.
 */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  const bits = entropy.length * 8;
  if (bits < 128 || bits > 256 || bits % 32 !== 0) {
    throw new MnemonicError(
      'A recovery phrase needs between 16 and 32 bytes of randomness, in whole groups of four.',
    );
  }

  const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy as BufferSource));
  const checksumBits = bits / 32;

  let run = '';
  for (const byte of entropy) run += byte.toString(2).padStart(8, '0');
  for (const byte of checksum) run += byte.toString(2).padStart(8, '0');
  run = run.slice(0, bits + checksumBits);

  const words: string[] = [];
  for (let at = 0; at < run.length; at += 11) {
    const index = parseInt(run.slice(at, at + 11), 2);
    words.push(ENGLISH_WORDLIST[index]!);
  }
  return words.join(' ');
}

/* ===========================================================================
 * READING ONE BACK
 * ======================================================================== */

export interface PhraseProblem {
  /** What is wrong, as a complete sentence the person can act on. */
  message: string;
  /**
   * Which word, counting from one, when a single word is the problem.
   *
   * This is the difference between "that phrase is not right" and "the ninth
   * word is not one of the two thousand". The second can be fixed; the first
   * is somebody staring at twelve words wondering which.
   */
  wordNumber?: number;
}

/**
 * Check a phrase without throwing, and say precisely what is wrong.
 *
 * Returns null when it is good. Used while somebody is typing, so it has to be
 * cheap and it has to be specific.
 */
export async function checkMnemonic(phrase: string): Promise<PhraseProblem | null> {
  const words = normalise(phrase).split(' ').filter(Boolean);

  if (words.length === 0) {
    return { message: 'Type the words of your recovery phrase, separated by spaces.' };
  }

  const expected = Object.values(ENTROPY_BITS).map((bits) => (bits + bits / 32) / 11);
  if (!expected.includes(words.length)) {
    return {
      message:
        `That is ${words.length} ${words.length === 1 ? 'word' : 'words'}. A recovery phrase ` +
        `is 12, 15, 18, 21 or 24.`,
    };
  }

  for (let at = 0; at < words.length; at += 1) {
    const word = words[at]!;
    if (!ENGLISH_INDEX.has(word)) {
      return {
        message: `“${word}” is not one of the words a recovery phrase is made from.`,
        wordNumber: at + 1,
      };
    }
  }

  // Every word is real and there are the right number of them, so what is left
  // is the checksum — which catches two correct words in the wrong order.
  try {
    await mnemonicToEntropy(phrase);
    return null;
  } catch {
    return {
      message:
        'Every word is a real one, but they do not check out together. Two of them are ' +
        'probably the wrong way round, or one has been copied from the wrong line.',
    };
  }
}

/** True when the phrase is entirely good. */
export async function validateMnemonic(phrase: string): Promise<boolean> {
  return (await checkMnemonic(phrase)) === null;
}

/**
 * Words back to the entropy behind them, refusing anything that does not check.
 *
 * The refusal is the point. Deriving a key from a phrase with a typo in it
 * would produce a perfectly good key that decrypts nothing, and the person
 * would have no way to tell that from a corrupted backup.
 */
export async function mnemonicToEntropy(phrase: string): Promise<Uint8Array> {
  const words = normalise(phrase).split(' ').filter(Boolean);

  let run = '';
  for (const word of words) {
    const index = ENGLISH_INDEX.get(word);
    if (index === undefined) {
      throw new MnemonicError(`“${word}” is not one of the words a recovery phrase is made from.`);
    }
    run += index.toString(2).padStart(11, '0');
  }

  const checksumBits = run.length / 33;
  const entropyBits = run.length - checksumBits;
  if (entropyBits % 8 !== 0 || entropyBits < 128 || entropyBits > 256) {
    throw new MnemonicError('A recovery phrase is 12, 15, 18, 21 or 24 words.');
  }

  const entropy = new Uint8Array(entropyBits / 8);
  for (let at = 0; at < entropy.length; at += 1) {
    entropy[at] = parseInt(run.slice(at * 8, at * 8 + 8), 2);
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy as BufferSource));
  let expected = '';
  for (const byte of digest) expected += byte.toString(2).padStart(8, '0');

  if (run.slice(entropyBits) !== expected.slice(0, checksumBits)) {
    throw new MnemonicError(
      'Those words do not check out together. One of them is wrong, or two are the wrong ' +
        'way round.',
    );
  }

  return entropy;
}

/* ===========================================================================
 * TURNING IT INTO A KEY
 * ======================================================================== */

/**
 * The 64-byte seed a phrase stands for.
 *
 * PBKDF2-HMAC-SHA512, 2048 rounds, salted with the word "mnemonic" and the
 * optional passphrase. All three are fixed by the specification.
 *
 * The passphrase is a second secret that is *not* written on the paper. With
 * one, a phrase found in a drawer is not enough to open the backup. Without
 * one, the phrase alone is. Both are reasonable and only the person can say
 * which — so this takes it and does not offer an opinion.
 *
 * Deriving from the words rather than from the entropy is deliberate and is
 * what the specification says: a phrase and its passphrase together are the
 * secret, and the entropy is only how the words were arrived at.
 */
export async function mnemonicToSeed(phrase: string, passphrase = ''): Promise<Uint8Array> {
  // Refuse first. A seed derived from a mistyped phrase is a valid seed for a
  // phrase nobody has, and every failure after this point would look like a
  // corrupted file.
  await mnemonicToEntropy(phrase);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(normalise(phrase)) as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT_PREFIX + passphrase.normalize('NFKD')) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-512',
    },
    key,
    SEED_BITS,
  );

  return new Uint8Array(bits);
}

/* ===========================================================================
 * SHARED BITS
 * ======================================================================== */

/**
 * The form of a phrase everything else works on.
 *
 * NFKD because the specification says so, lower case and single-spaced
 * because people type into a box with a capital at the front and a stray
 * double space in the middle, and none of that should change a key.
 */
function normalise(phrase: string): string {
  return phrase.normalize('NFKD').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Bytes as lower-case hex. For showing a seed, and for tests. */
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hex back to bytes. Refuses anything that is not an even run of hex digits. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new MnemonicError('That is not a run of hexadecimal digits.');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let at = 0; at < bytes.length; at += 1) {
    bytes[at] = parseInt(clean.slice(at * 2, at * 2 + 2), 16);
  }
  return bytes;
}

/**
 * The phrase, in groups, for writing down.
 *
 * Numbered because the order matters and a numbered list is how somebody
 * checks they have copied twelve things rather than eleven.
 */
export function numberedWords(phrase: string): { number: number; word: string }[] {
  return normalise(phrase)
    .split(' ')
    .filter(Boolean)
    .map((word, index) => ({ number: index + 1, word }));
}
