/* ===========================================================================
 * WHAT THE BANK CALLS IT, AND WHAT IT ACTUALLY WAS
 * ---------------------------------------------------------------------------
 * A bank statement does not say "Koffie". It says
 *
 *     SumUp *KOFFIE 0031204 Amsterdam NL
 *     iDEAL* 1234567890 ALBERT HEIJN 1234 AMSTERDAM
 *     PAYPAL *SPOTIFY 35314369001 IE
 *
 * — terminal identifiers, acquirer prefixes, city names, country codes, and a
 * reference number that is different every single time. That last part is what
 * makes this worth doing: a rule matching the raw string matches once and never
 * again, so every visit to the same shop arrives as a new unknown merchant.
 *
 * Two things are load-bearing here.
 *
 * The raw descriptor is never destroyed. It stays on the staged row, because it
 * is what the bank actually sent and the only thing that can be checked against
 * a statement when something looks wrong. This produces a second, friendlier
 * string alongside it.
 *
 * And it is conservative. When a descriptor does not match anything this
 * recognises, it comes back tidied but intact rather than aggressively cut
 * down. Turning "SEPA OVERBOEKING J DE VRIES" into "Vries" would be worse than
 * leaving it alone: a wrong name is harder to spot than an ugly one.
 * ======================================================================== */

/**
 * Acquirer and wallet prefixes, which carry no information about the merchant.
 *
 * Ordered longest-first so the more specific pattern wins. Each is anchored at
 * the start, because these only ever appear there — a shop genuinely called
 * "Square One" must survive.
 */
const PREFIXES: readonly RegExp[] = [
  /^sumup\s*\*+\s*/i,
  /^ideal\s*\*+\s*/i,
  /^paypal\s*\*+\s*/i,
  /^zettle\s*_?\*+\s*/i,
  /^stripe\s*\*+\s*/i,
  /^sq\s*\*+\s*/i,
  /^tst\s*\*+\s*/i,
  /^pos\s+/i,
  /^bea\s+/i,
  /^betaalautomaat\s+/i,
  /^sepa\s+(?:incasso|overboeking|直)?\s*/i,
  /^card\s+purchase\s+/i,
  /^contactless\s+/i,
];

/** Trailing noise: country codes, and the payment-network suffixes. */
const SUFFIXES: readonly RegExp[] = [
  /\s+(?:nl|be|de|fr|es|it|ie|gb|uk|us)$/i,
  /\s+(?:visa|mastercard|maestro|amex)$/i,
];

/**
 * Cities that turn up at the end of a card descriptor.
 *
 * Deliberately a short list of the obvious ones rather than a gazetteer. A
 * long list would eventually eat a shop named after a place, and "Amsterdam
 * Cheese Company" losing its first word is a worse outcome than "Koffie
 * Amsterdam" keeping its last.
 */
const TRAILING_CITIES = /\s+(amsterdam|rotterdam|den haag|utrecht|eindhoven|london|dublin|berlin|paris|madrid)$/i;

/** A run of five or more digits: a terminal id, a reference, a store number. */
const LONG_NUMBER = /\b\d{5,}\b/g;

/** Dates in the shapes statements use. */
const DATES = /\b\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\b/g;

/** Times, which some terminals append. */
const TIMES = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

/**
 * Turn a bank descriptor into something a person would recognise.
 *
 * Returns the tidied name. Never returns empty: if stripping would leave
 * nothing, the original is given back, because an unhelpful name beats none.
 */
export function normalizePayee(raw: string): string {
  const original = raw.trim();
  if (original === '') return '';

  let text = original;

  for (const prefix of PREFIXES) {
    const before = text;
    text = text.replace(prefix, '');
    // Only one prefix ever applies; stopping keeps "PAYPAL *SQ FLOWERS" from
    // losing both, which would be right for the first and wrong for the second.
    if (text !== before) break;
  }

  text = text.replace(DATES, ' ').replace(TIMES, ' ').replace(LONG_NUMBER, ' ');

  for (const suffix of SUFFIXES) text = text.replace(suffix, '');
  text = text.replace(TRAILING_CITIES, '');

  // Separators the terminal used as spacing, and any run of whitespace.
  text = text.replace(/[*_|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // A trailing store number of one to four digits, once everything else is
  // gone: "ALBERT HEIJN 1234" is a branch, and the branch is not the shop.
  text = text.replace(/\s+\d{1,4}$/, '').trim();

  if (text === '') return original;

  return toDisplayCase(text);
}

/**
 * Statement case to something readable.
 *
 * Bank descriptors are usually shouted. Title case reads better and is what
 * people type themselves, but words that are genuinely initialisms should stay
 * shouted — "KLM" and "NS" are not "Klm" and "Ns".
 */
export function toDisplayCase(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);

  return words
    .map((word) => {
      // Already mixed case: somebody or something meant it that way.
      if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;

      // A short shouted word is an initialism only when it has no vowel to
      // pronounce. NS and KLM stay as they are; THE and DE do not, and an
      // earlier rule that went by length alone turned "SQ *THE CORNER SHOP"
      // into "THE Corner Shop".
      const letters = word.replace(/[^A-Za-z]/g, '');
      const pronounceable = /[aeiouy]/i.test(letters);
      if (letters.length > 0 && letters.length <= 3 && !pronounceable) {
        return word.toUpperCase();
      }

      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * A key for recognising the same merchant twice.
 *
 * Lower case, letters and digits only. Rules and merchant memory match on
 * this, so "KOFFIE" and "Koffie" and "koffie " are one merchant rather than
 * three.
 */
export function payeeKey(raw: string): string {
  return normalizePayee(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether cleaning actually changed anything worth showing.
 *
 * The review queue uses this to decide whether to show the original
 * underneath. Repeating an unchanged string twice is noise.
 */
export function wasCleaned(raw: string): boolean {
  return normalizePayee(raw) !== raw.trim();
}
