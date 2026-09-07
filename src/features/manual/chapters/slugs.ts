/* ===========================================================================
 * THE CHAPTER ADDRESSES
 * ---------------------------------------------------------------------------
 * Just the slugs, in their own module with no imports at all.
 *
 * They live apart from the chapters themselves because screens in the first
 * paint link into the manual — the Safe-to-Spend sheet is one — and importing
 * the chapter list to name a chapter would pull six chapters, the ledger
 * builders, the disposal engine and the reconciliation maths along with it.
 * That is the barrel-leak pattern this project has paid for before.
 *
 * Splitting the list out means a link can be typed rather than stringly
 * addressed: `ManualLink` takes a `ChapterSlug`, so a mistyped chapter fails
 * to compile instead of quietly landing on the contents page, and it costs the
 * opening bundle six short strings.
 *
 * These appear in the address bar, so they are as permanent as any URL.
 * Changing one breaks a link somebody kept.
 * ======================================================================== */

export const CHAPTERS = [
  'safe-to-spend',
  'two-books',
  'pots',
  'cards',
  'selling',
  'checking',
] as const;

export type ChapterSlug = (typeof CHAPTERS)[number];
