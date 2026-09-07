/* ===========================================================================
 * TAGS
 * ---------------------------------------------------------------------------
 * A tag is a label you put across payments that have nothing else in common:
 * the Italy trip, the kitchen, everything your sister owes you half of. They
 * cut across categories on purpose — the flights were travel, the villa was
 * accommodation, the wine was eating out, and all three were the holiday.
 *
 * ---------------------------------------------------------------------------
 * WHAT A TAG IS NOT
 *
 * A tag never touches a total. Not what is safe to spend, not an envelope, not
 * a single posting. This is the one rule that keeps them worth having.
 *
 * The moment a tag can hold money back or be given money, it is a second
 * budgeting system running alongside the first, and the two will disagree —
 * a payment tagged "holiday" and filed under "eating out" would be counted
 * once, twice or not at all depending on which screen you happened to be
 * looking at. Categories decide what money is for and they are answerable to
 * the ledger. Tags are how you find things again afterwards, and they are
 * answerable to nobody.
 *
 * That is why they live in their own table, joined to entries and to nothing
 * else, and why no arithmetic in this application reads them.
 * ======================================================================== */

export class TagError extends Error {
  override name = 'TagError';
}

/** Long enough for "Sam and Alex's wedding, September". */
export const MAX_TAG_LENGTH = 40;

/**
 * A tag name, tidied but recognisably what was typed.
 *
 * Case is kept. "NYC" and "Nyc" read differently and somebody who typed the
 * first meant it; the slug below is what decides they are the same tag.
 */
export function normaliseTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * The key two spellings of the same tag agree on.
 *
 * Lower case, and everything that is not a letter or a digit becomes a single
 * hyphen. "Italy 2026", "italy 2026" and "  ITALY  2026 " are one tag, which
 * is the whole point: a tag that splits in two the first time somebody
 * capitalises it differently is worse than no tag at all.
 */
export function tagSlug(raw: string): string {
  return normaliseTagName(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Check a name before it becomes a tag.
 *
 * Returns the tidied name, or throws with a sentence that says what to do
 * rather than what went wrong.
 */
export function assertUsableTagName(raw: string): string {
  const name = normaliseTagName(raw);

  if (name === '') {
    throw new TagError('A tag needs a name — something you would search for later.');
  }
  if (name.length > MAX_TAG_LENGTH) {
    throw new TagError(
      `That name is longer than a tag can be. Keep it under ${MAX_TAG_LENGTH} characters, ` +
        `so it still reads on a small screen.`,
    );
  }
  if (tagSlug(name) === '') {
    throw new TagError(
      'A tag needs at least one letter or number in its name, or there is nothing to match it on.',
    );
  }

  return name;
}

/** Whether two names would be the same tag. */
export function sameTag(a: string, b: string): boolean {
  return tagSlug(a) === tagSlug(b);
}

/* ===========================================================================
 * SAYING WHAT HAPPENED
 * ---------------------------------------------------------------------------
 * Bulk actions are the one place in this app where somebody changes a lot of
 * records at once, and the confirmation is the only evidence of what they did.
 * These sentences are that evidence, so they count out loud.
 * ======================================================================== */

/** "Tagged 14 payments as Italy 2026." */
export function describeTagging(count: number, name: string): string {
  if (count === 0) return `Nothing was tagged. Every one of them already had ${name}.`;
  return `Tagged ${count} ${count === 1 ? 'payment' : 'payments'} as ${name}.`;
}

/** "Took Italy 2026 off 3 payments." */
export function describeUntagging(count: number, name: string): string {
  if (count === 0) return `Nothing changed. None of them had ${name} on it.`;
  return `Took ${name} off ${count} ${count === 1 ? 'payment' : 'payments'}.`;
}

/** What the bar along the bottom says while things are selected. */
export function describeSelection(count: number, noun = 'payment'): string {
  if (count === 0) return `Nothing chosen yet. Tap a ${noun} to start.`;
  return `${count} ${count === 1 ? noun : `${noun}s`} chosen`;
}

/**
 * What deleting a tag will actually do, said before it is done.
 *
 * Names the number of payments, because "delete tag" sounds like it might take
 * the payments with it, and it does not.
 */
export function describeTagRemoval(name: string, usedOn: number): string {
  if (usedOn === 0) {
    return `${name} is not on anything, so removing it changes nothing else.`;
  }
  return (
    `${name} will be taken off ${usedOn} ${usedOn === 1 ? 'payment' : 'payments'}. ` +
    `The payments themselves are not touched — only the label.`
  );
}
