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
 * WHY THE SEEDS ARE MAPPED BY HAND AND ONLY THE REST IS HASHED
 *
 * A hash gives stability but not meaning. Stability alone is not the claim:
 * the claim is that somebody can learn "verdigris is where I live, ochre is
 * what I eat" and then read a donut without a legend. That only holds if the
 * mapping says something true about the category, so every category the app
 * ships with is assigned below by hand.
 *
 * The strongest, most distinctive hues go to the categories a person sees
 * most often, because those are the ones that have to become recognisable
 * first. Home is the largest line in most households and takes the verdigris
 * the whole app is built around; food shopping is the most frequent and takes
 * the ochre.
 *
 * Two families carry two seeded categories each, and both pairs are honest
 * about it: eating out is food, and shopping sits with fun as discretionary
 * personal spending. Splitting either one across two hues to fill the grid
 * would be inventing a distinction the money does not have.
 *
 * Categories somebody makes themselves cannot be mapped by hand, so those
 * hash — over the id and never the name, so renaming "Fun" to "Going out"
 * does not repaint it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TAKES A STRING AND NOT A LEDGER TYPE
 *
 * Taking a plain string keeps `src/design` from having to know what a ledger
 * account is, so the charts and the features can both read this without
 * either of them importing the other's types.
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

/* ---------------------------------------------------------------------------
 * THE SEEDED TAXONOMY
 * ---------------------------------------------------------------------------
 * Keys are the stable ids from `src/data/seed.ts`, written as plain strings so
 * this module does not import it. They are seed data: every one of these can
 * be renamed or archived by the person using the app, and the colour follows
 * the id rather than the name through all of that.
 * ------------------------------------------------------------------------ */

const SEEDED_CATEGORIES: Record<string, Family> = {
  // Home is rent or a mortgage — the largest single line in most households —
  // and takes the verdigris the rest of the app is built around.
  'cat-home': 'housing',
  // The most frequent category of all: several entries in a normal week.
  'cat-groceries': 'food',
  // Eating out is food. Sharing the ochre with the weekly shop is true to
  // what it is, and truer than splitting it off to fill a slot.
  'cat-eating-out': 'food',
  // Contractual and recurring. Clay is the obligation hue, not a warning.
  'cat-bills': 'obligation',
  'cat-transport': 'transport',
  'cat-health': 'health',
  'cat-fun': 'leisure',
  // Discretionary personal spending, which is what fun is too.
  'cat-shopping': 'leisure',
};

/** Each starter group takes the family of the spending it mostly holds. */
const SEEDED_GROUPS: Record<string, Family> = {
  'grp-essential': 'housing',
  'grp-lifestyle': 'leisure',
  'grp-transit': 'transport',
};

/** The pot that funds a category is the same colour as the category. */
const SEEDED_POTS: Record<string, Family> = {
  'pot-home': 'housing',
  'pot-groceries': 'food',
  'pot-eating-out': 'food',
  'pot-bills': 'obligation',
  'pot-transport': 'transport',
  'pot-health': 'health',
  'pot-fun': 'leisure',
  'pot-shopping': 'leisure',
  'grp-pot-essential': 'housing',
  'grp-pot-lifestyle': 'leisure',
  'grp-pot-transit': 'transport',
};

/**
 * Where money sits, rather than what it was spent on.
 *
 * These follow the reference sheet: everyday money is the spine, anything
 * invested is the blue, anything owed is the clay, and anything at rest is
 * the teal.
 */
const ACCOUNT_KINDS: Record<string, Family> = {
  // Account classes.
  checking: 'housing',
  cash: 'housing',
  savings: 'health',
  credit_card: 'obligation',
  loan: 'obligation',
  mortgage: 'obligation',
  brokerage: 'transport',
  retirement: 'transport',
  real_estate: 'housing',
  vehicle: 'transport',
  other_asset: 'leisure',
  // Account groups, as used by the balance sheet.
  foreign: 'health',
  investments: 'transport',
  property: 'housing',
  debts: 'obligation',
};

/**
 * What a security is, rather than where it is held.
 *
 * The allocation bar needs hues and there is no seventh palette in this app to
 * give it. These follow the same sentences as the account kinds above, so a
 * person who has learned the index once reads the bar with it: anything
 * invested is the blue, anything at rest is the teal, property is the
 * verdigris it is everywhere else.
 *
 * `other` is deliberately absent. It means "we do not know what this is", and
 * a category hue on that slice would be inventing an entry in an index that is
 * supposed to be learnable. The bar paints it neutral instead.
 *
 * `cash_equivalent` lands on the same verdigris as `real_estate`, which is a
 * real collision and the honest one: it is the family `cash` and `checking`
 * already carry, and a portfolio holding both a REIT and a money-market fund
 * gets two verdigris segments separated by the bar's gap and named in the
 * legend. Splitting them would mean a seventh family that means nothing.
 */
const ASSET_CLASSES: Record<string, Family> = {
  equity: 'transport',
  fixed_income: 'health',
  real_estate: 'housing',
  commodity: 'food',
  crypto: 'leisure',
  cash_equivalent: 'housing',
};

/**
 * The six field-manual chapters.
 *
 * A chapter tile takes the hue of the thing its chapter is about, so the
 * contents page indexes by the same colours the rest of the app teaches: the
 * pots chapter is the teal that savings are, the cards chapter the clay that
 * debts are.
 *
 * Four of the six mean something. `checking` and `two-books` do not, and are
 * assigned by elimination — there is no money category for "your records agree
 * with the bank" or for "every payment is stored twice", because neither is a
 * kind of spending. They take what is left so that six tiles are six colours,
 * and that is the whole of their claim. Do not read meaning into those two.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN `PINNED`
 *
 * `checking` is a chapter AND an account class. It was in `PINNED` for about
 * an hour and the contents page came out wrong: the reconciliation chapter
 * drew verdigris, because `ACCOUNT_KINDS` maps `checking` to a current account
 * and won the spread.
 *
 * Reordering the spread would have fixed the tile and turned every checking
 * account's row square purple — a worse bug in a place nobody would look. The
 * two keys are not in conflict; they are in different namespaces that happen
 * to share an English word, and `familyFor` takes "anything with a stable id",
 * which was always going to collide with something eventually.
 *
 * A chapter slug is a URL segment, not an account id. It gets its own lookup.
 */
const MANUAL_CHAPTERS: Record<string, Family> = {
  // The home screen's one number, which is the app's spine.
  'safe-to-spend': 'housing',
  // Money at rest, the same teal `savings` carries.
  pots: 'health',
  // What is owed, the same clay `credit_card` and `loan` carry.
  cards: 'obligation',
  // Anything invested, the same blue `brokerage` carries.
  selling: 'transport',
  // By elimination. See above.
  'two-books': 'food',
  checking: 'leisure',
};

const PINNED: Record<string, Family> = {
  ...ASSET_CLASSES,
  ...SEEDED_CATEGORIES,
  ...SEEDED_GROUPS,
  ...SEEDED_POTS,
  ...ACCOUNT_KINDS,
};

/**
 * A small, stable, well-spread hash, for categories somebody made themselves.
 *
 * FNV-1a, because it has to be deterministic across sessions and devices —
 * two phones showing the same household must colour it identically — and
 * because anything with a random seed would repaint the app on every launch.
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
 * Pass an account id, a category id, a pot id or an account class. Everything
 * the app seeds is mapped by hand above; anything else is hashed, which is
 * stable but arbitrary.
 */
export function familyFor(key: string | null | undefined): Family {
  if (!key) return 'housing';
  const pinned = PINNED[key];
  if (pinned) return pinned;
  return FAMILIES[hash(key) % FAMILIES.length]!;
}

/** Whether this id is one the app ships with, and so mapped by meaning. */
export function isSeededKey(key: string): boolean {
  return key in PINNED;
}

/** The binding class for anything with a stable id. */
export function familyClassFor(key: string | null | undefined): string {
  return familyClass(familyFor(key));
}

/**
 * The family for a field-manual chapter.
 *
 * Separate from `familyFor` on purpose — see the note above `MANUAL_CHAPTERS`.
 * A chapter slug is a URL segment and an account class is a column value, and
 * the two sharing the word "checking" is a coincidence rather than a meaning.
 */
export function familyForChapter(slug: string): Family {
  return MANUAL_CHAPTERS[slug] ?? 'housing';
}
