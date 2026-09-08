/* ===========================================================================
 * THE SIX FAMILIES
 * ---------------------------------------------------------------------------
 * Colour encodes category, never sentiment. Housing is the same verdigris in
 * the donut, the envelope tile, the transaction row's icon square and the
 * calendar dot — and that consistency is what turns colour into an index a
 * person can navigate by, which is what lets the prose come out of the
 * screens.
 *
 * Two rules hold the whole thing up:
 *
 *   1. A family is never reassigned. The hue a category has today is the hue
 *      it has next year, or the index is worthless.
 *   2. A family never means good or bad. `obligation` is clay because bills
 *      are a kind of thing, not because they are a problem.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TAKES A STRING AND NOT A LEDGER TYPE
 *
 * Categories are created by the person using the app, so there is no fixed
 * table that could cover them. Anything with a stable identity — an account
 * id, a category id, an account class — hashes to a family and keeps it
 * forever, because the hash is over the id rather than over the name. Renaming
 * "Fun" to "Going out" does not change its colour.
 *
 * The seeded categories and the account classes are pinned by hand, because
 * those are the ones somebody would notice being wrong: groceries should be
 * the food ochre and a mortgage should not be the leisure purple.
 *
 * Taking a plain string also keeps `src/design` from having to know what a
 * ledger account is, so the charts and the features can both read this
 * without either of them importing the other's types.
 * ======================================================================== */

export const FAMILIES = [
  'housing',
  'food',
  'transport',
  'obligation',
  'leisure',
  'health',
] as const;

export type Family = (typeof FAMILIES)[number];

/** The class that binds `--tile-ink` and `--tile-wash` for a family. */
export function familyClass(family: Family): string {
  return `cat-${family}`;
}

/**
 * The ones worth pinning.
 *
 * Keys are the stable ids from `src/data/seed.ts` and the account classes from
 * `src/core/ledger/accountClasses.ts`, written as plain strings so this module
 * stays free of either. A key that is not here falls through to the hash,
 * which is the normal case for anything somebody made themselves.
 */
const PINNED: Record<string, Family> = {
  // Seeded spending categories.
  'cat-home': 'housing',
  'cat-groceries': 'food',
  'cat-eating-out': 'food',
  'cat-transport': 'transport',
  'cat-health': 'health',
  'cat-fun': 'leisure',
  'cat-shopping': 'leisure',
  'cat-bills-and-subs': 'obligation',

  // Seeded groups.
  'grp-essential': 'housing',
  'grp-lifestyle': 'leisure',
  'grp-transit': 'transport',

  // Where money sits. These follow the reference sheet: cash and property are
  // the spine, anything invested is the blue, anything owed is the clay.
  cash: 'housing',
  savings: 'health',
  current: 'housing',
  foreign: 'transport',
  investments: 'transport',
  brokerage: 'transport',
  pension: 'transport',
  property: 'housing',
  debts: 'obligation',
  credit_card: 'obligation',
  loan: 'obligation',
  mortgage: 'obligation',
  income: 'leisure',
  reserve: 'health',
};

/**
 * A small, stable, well-spread hash.
 *
 * FNV-1a, because it needs to be deterministic across sessions and devices —
 * two phones showing the same household must colour it identically — and
 * because anything with a random seed would repaint the whole app on every
 * launch.
 */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The family for anything with a stable id.
 *
 * Pass an account id, a category id or an account class. The same string
 * always gives the same family, on every device, for as long as the id lives.
 */
export function familyFor(key: string | null | undefined): Family {
  if (!key) return 'housing';
  const pinned = PINNED[key];
  if (pinned) return pinned;
  return FAMILIES[hash(key) % FAMILIES.length]!;
}

/** The binding class for anything with a stable id. */
export function familyClassFor(key: string | null | undefined): string {
  return familyClass(familyFor(key));
}
