/* ===========================================================================
 * THE WAY THROUGH TO THE LONG ANSWER
 * ---------------------------------------------------------------------------
 * The hinge between the two tiers. It sits under a short explanation, on a
 * screen somebody is using, and offers the chapter that explains the rest.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * Some of the screens that carry one of these are in the first paint — the
 * Safe-to-Spend sheet is one. This module imports the router and the slug
 * list, and nothing else. In particular it does NOT import `./chapters`,
 * which would pull six chapters, the ledger builders, the disposal engine and
 * the reconciliation maths into the opening bundle through a re-export edge —
 * the exact pattern that has cost this project a bundle budget before.
 *
 * The slug is still typed, because `chapters/slugs.ts` holds the addresses on
 * their own with no imports of its own. A mistyped chapter fails to compile,
 * and the opening bundle pays six short strings for that.
 * ======================================================================== */

import { useRoute } from '@/app/router';
import type { ChapterSlug } from './chapters/slugs';

export function ManualLink({
  chapter,
  /** A complete phrase: "Read how pots are worked out". */
  children,
}: {
  chapter: ChapterSlug;
  children: React.ReactNode;
}) {
  const [, navigate] = useRoute();

  return (
    <button
      type="button"
      onClick={() => navigate('manual', chapter)}
      className="target self-start text-caption text-liquid underline-offset-4 hover:underline"
    >
      {children} →
    </button>
  );
}
