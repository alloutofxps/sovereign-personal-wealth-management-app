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
  /**
   * Roughly how long it takes to read, in minutes.
   *
   * Declared rather than computed. Counting the rendered body would mean
   * rendering all six on the contents page, which is the lazy loading undone
   * for the sake of a number nobody reads to the minute.
   */
  minutes: number;
  Body: ComponentType;
}

/**
 * Roughly how long a chapter takes to read.
 *
 * Derived from the standfirst and the engine name rather than from the body,
 * because the body is a React component and counting words in a rendered tree
 * would mean rendering it — on the contents page, for all six, before anybody
 * has asked for one. That would undo the lazy loading the chapters exist
 * inside.
 *
 * So this is the chapter's own declared length. Two hundred words a minute is
 * the usual figure for reference prose; the numbers land between three and
 * seven minutes, which is the honest range for these, and a reader who is
 * deciding whether to start now needs the order of magnitude rather than the
 * minute.
 */
export function readingMinutes(chapter: Chapter): number {
  return chapter.minutes;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    slug: 'safe-to-spend',
    title: 'The one number',
    standfirst:
      'Why the home screen shows something other than your balance, and what the four subtractions are.',
    engine: 'Safe to Spend',
    minutes: 5,
    Body: SafeToSpendChapter,
  },
  {
    slug: 'two-books',
    title: 'Two sets of books',
    standfirst:
      'Every event is recorded twice: once for where the money is, once for what it is for. Both have to balance.',
    engine: 'The ledger',
    minutes: 6,
    Body: TwoBooksChapter,
  },
  {
    slug: 'pots',
    title: 'Putting money by',
    standfirst:
      'Three kinds of pot, three different sums, and why paying in never moves the target you were paying towards.',
    engine: 'Sinking funds',
    minutes: 4,
    Body: PotsChapter,
  },
  {
    slug: 'cards',
    title: 'Cards and mortgages',
    standfirst:
      'Why a card balance comes off what is safe to spend today, and a mortgage, rightly, does not.',
    engine: 'Card reserves',
    minutes: 4,
    Body: CardsChapter,
  },
  {
    slug: 'selling',
    title: 'What a sale actually costs',
    standfirst:
      'You bought the same fund four times. When you sell ten shares, which ten did you sell?',
    engine: 'Tax lots',
    minutes: 5,
    Body: DisposalsChapter,
  },
  {
    slug: 'checking',
    title: 'Checking against the bank',
    standfirst:
      'The one thing that turns a set of records you typed into a set of records you can trust.',
    engine: 'Reconciliation',
    minutes: 5,
    Body: ReconcilingChapter,
  },
];

export function chapterBySlug(slug: string | null): Chapter | null {
  if (slug === null) return null;
  return CHAPTERS.find((chapter) => chapter.slug === slug) ?? null;
}
