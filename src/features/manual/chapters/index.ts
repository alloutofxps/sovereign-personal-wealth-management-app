/* ===========================================================================
 * THE CHAPTERS
 * ---------------------------------------------------------------------------
 * One list, in reading order, and the `slug` is the second segment of the hash
 * — `#/manual/pots`. That is what makes a chapter linkable from the screen it
 * explains, which is the whole two-tier idea: a short answer where you are
 * standing, and a way through to the long one without losing your place.
 *
 * The slugs themselves live in `slugs.ts`, with no imports, so a screen in the
 * first paint can name a chapter without dragging six of them into the opening
 * bundle. This file is the reading order and the prose; that one is the
 * addresses.
 * ======================================================================== */

import type { ComponentType } from 'react';
import type { ChapterSlug } from './slugs';
import { SafeToSpendChapter } from './safeToSpend';
import { TwoBooksChapter } from './twoBooks';
import { PotsChapter } from './pots';
import { CardsChapter } from './cards';
import { DisposalsChapter } from './disposals';
import { ReconcilingChapter } from './reconciling';

export interface Chapter {
  slug: ChapterSlug;
  title: string;
  /** One sentence on the contents page. What you will know afterwards. */
  standfirst: string;
  /** Which engine the chapter's lab actually runs, named honestly. */
  engine: string;
  Body: ComponentType;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    slug: 'safe-to-spend',
    title: 'The one number',
    standfirst:
      'Why the home screen shows something other than your balance, and what the four subtractions are.',
    engine: 'Safe to Spend',
    Body: SafeToSpendChapter,
  },
  {
    slug: 'two-books',
    title: 'Two sets of books',
    standfirst:
      'Every event is recorded twice: once for where the money is, once for what it is for. Both have to balance.',
    engine: 'The ledger',
    Body: TwoBooksChapter,
  },
  {
    slug: 'pots',
    title: 'Putting money by',
    standfirst:
      'Three kinds of pot, three different sums, and why paying in never moves the target you were paying towards.',
    engine: 'Sinking funds',
    Body: PotsChapter,
  },
  {
    slug: 'cards',
    title: 'Cards and mortgages',
    standfirst:
      'Why a card balance comes off what is safe to spend today, and a mortgage, rightly, does not.',
    engine: 'Card reserves',
    Body: CardsChapter,
  },
  {
    slug: 'selling',
    title: 'What a sale actually costs',
    standfirst:
      'You bought the same fund four times. When you sell ten shares, which ten did you sell?',
    engine: 'Tax lots',
    Body: DisposalsChapter,
  },
  {
    slug: 'checking',
    title: 'Checking against the bank',
    standfirst:
      'The one thing that turns a set of records you typed into a set of records you can trust.',
    engine: 'Reconciliation',
    Body: ReconcilingChapter,
  },
];

export function chapterBySlug(slug: string | null): Chapter | null {
  if (slug === null) return null;
  return CHAPTERS.find((chapter) => chapter.slug === slug) ?? null;
}
