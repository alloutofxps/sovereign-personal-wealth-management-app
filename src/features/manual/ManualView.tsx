/* ===========================================================================
 * THE FIELD MANUAL
 * ---------------------------------------------------------------------------
 * The second of the two tiers.
 *
 * The first tier is everywhere else in the app: a sentence under a figure, a
 * sheet that opens when you tap "how is this worked out?". Enough to keep
 * going, and deliberately not enough to explain a ledger.
 *
 * This is where the rest of it lives, and it stays. It is not a tour, it does
 * not appear uninvited, and it has no completion state — nothing here can be
 * finished, because it is a reference rather than a course. Somebody who
 * wonders in month seven why their pot asked for more than last month can come
 * and find out, and the chapter will not congratulate them for arriving.
 *
 * Every chapter carries a lab that runs the real engine on invented figures.
 * That combination is the point: a diagram of how something works can quietly
 * stop being true when the code changes, and an explanation drawn from
 * somebody's own money would let them act on a number that was never theirs.
 *
 * ---------------------------------------------------------------------------
 * THE CONTENTS PAGE IS TILES, AND THE HUE IS THE INDEX
 *
 * It was a numbered list. Numbers say "read these in order", and these are
 * reference — somebody arrives at chapter five from the investments screen
 * without having read four, and a "5" beside it tells them they are late.
 *
 * The hue does the indexing instead, and it is the hue the chapter's own
 * subject already carries everywhere else in the app: the pots chapter is the
 * teal that pots are, the cards chapter the clay that debts are. That is the
 * same index the donut and the envelope tiles teach, used once more.
 * ======================================================================== */

import { useEffect } from 'react';
import { useRoute, useRouteDetail } from '@/app/router';
import { familyClass, familyForChapter } from '@/design/category';
import { Button, Tile } from '@/design/ui';
import { CHAPTERS, chapterBySlug, readingMinutes, type Chapter } from './chapters';

export function ManualView() {
  const slug = useRouteDetail();
  const chapter = chapterBySlug(slug);

  // Arriving at a chapter from another screen should start at its top, not
  // wherever the contents page happened to be scrolled to.
  //
  // The document does not scroll, so `window.scrollTo` would do nothing. The
  // scrolling element is the shell's `<main>`, and this walks up to whatever
  // is actually carrying the overflow rather than assuming a depth.
  useEffect(() => {
    if (!chapter) return;
    document.querySelector('main.scroll-y')?.scrollTo({ top: 0 });
  }, [chapter]);

  return chapter ? <Reader chapter={chapter} /> : <Contents />;
}

/* --- the contents page --------------------------------------------------- */

function Contents() {
  const [, navigate] = useRoute();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="headline text-ink">The field manual</h1>
        <p className="measure text-caption text-ink-2">
          Six chapters, each running the same code your own money does.
        </p>
      </header>

      {/*
        * Two columns of tiles rather than one column of rows. A chapter is a
        * destination, not a list item, and the grid is what the envelope
        * screen already established for "several things of the same kind, each
        * with its own colour".
        */}
      <ul className="grid grid-cols-2 gap-2.5">
        {CHAPTERS.map((chapter) => (
          <li key={chapter.slug} className="contents">
            <Tile
              family={familyForChapter(chapter.slug)}
              onClick={() => navigate('manual', chapter.slug)}
              className="flex flex-col gap-1.5"
              aria-label={`${chapter.title}. ${readingMinutes(chapter)} minute read.`}
            >
              <span className="text-body font-medium">{chapter.title}</span>
              <span className="text-caption leading-relaxed opacity-80">
                {chapter.standfirst}
              </span>
              <span className="tnum pt-1 text-micro opacity-70">
                {readingMinutes(chapter)} min
              </span>
            </Tile>
          </li>
        ))}
      </ul>

      <p className="measure text-caption text-ink-3">
        Nothing here has to be read in order, and nothing has to be finished.
      </p>
    </div>
  );
}

/* --- one chapter --------------------------------------------------------- */

function Reader({ chapter }: { chapter: Chapter }) {
  const [, navigate] = useRoute();
  const position = CHAPTERS.findIndex((c) => c.slug === chapter.slug);
  const previous = position > 0 ? CHAPTERS[position - 1] : null;
  const next = position < CHAPTERS.length - 1 ? CHAPTERS[position + 1] : null;
  const family = familyForChapter(chapter.slug);

  return (
    <article className={`${familyClass(family)} flex flex-col gap-6`}>
      {/*
        * The running head.
        *
        * A chapter is long enough to lose your place in, and the one thing you
        * lose first is which chapter it is. It sticks under the shell's own
        * top inset rather than at zero, and carries the way out with it so
        * "back to the contents" is never a scroll away.
        */}
      <div className="sticky top-0 z-10 -mx-5 flex items-center justify-between gap-3 bg-base/85 px-5 py-2.5 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => navigate('manual')}
          className="press-row -mx-1 rounded-md px-1 text-caption text-ink-3 hover:text-ink-2"
        >
          ← All chapters
        </button>
        <span className="truncate text-caption text-ink-3">{chapter.title}</span>
      </div>

      <header className="flex flex-col gap-2">
        <span className="text-caption text-[var(--tile-ink)]">{chapter.engine}</span>
        <h1 className="headline max-w-[24ch] text-balance text-ink">{chapter.title}</h1>
      </header>

      <div className="flex flex-col gap-5">
        <chapter.Body />
      </div>

      <nav className="flex flex-col gap-2 border-t border-line pt-5">
        {previous && (
          <Button variant="secondary" block onClick={() => navigate('manual', previous.slug)}>
            ← {previous.title}
          </Button>
        )}
        {next && (
          <Button variant="secondary" block onClick={() => navigate('manual', next.slug)}>
            {next.title} →
          </Button>
        )}
        {!next && (
          <p className="text-caption text-ink-3">
            The last chapter. Nothing is unlocked by finishing it.
          </p>
        )}
      </nav>
    </article>
  );
}
