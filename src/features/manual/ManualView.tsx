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
 * ======================================================================== */

import { useEffect } from 'react';
import { useRoute, useRouteDetail } from '@/app/router';
import { Button } from '@/design/ui';
import { CHAPTERS, chapterBySlug, type Chapter } from './chapters';

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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-lead font-medium text-ink">The field manual</h1>
        <p className="max-w-[58ch] text-body leading-relaxed text-ink-2">
          How Sovereign works out what it tells you. Six chapters, each with a working model of
          the thing it is describing. The same code that runs on your own money, running on
          figures that are openly made up.
        </p>
        <p className="max-w-[58ch] text-caption text-ink-3">
          Nothing here has to be read in order and nothing has to be finished. It is a reference,
          and it will be here in a year when something finally makes you curious.
        </p>
      </header>

      <ol className="flex flex-col gap-2">
        {CHAPTERS.map((chapter, index) => (
          <li key={chapter.slug}>
            <button
              type="button"
              onClick={() => navigate('manual', chapter.slug)}
              className="flex w-full flex-col gap-1 rounded-lg border border-line bg-raised px-4 py-3.5 text-left transition-colors hover:border-line-strong"
            >
              <span className="flex items-baseline gap-3">
                <span className="tnum text-micro text-ink-3">{index + 1}</span>
                <span className="text-body font-medium text-ink">{chapter.title}</span>
              </span>
              <span className="max-w-[58ch] pl-[1.6rem] text-caption leading-relaxed text-ink-2">
                {chapter.standfirst}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* --- one chapter --------------------------------------------------------- */

function Reader({ chapter }: { chapter: Chapter }) {
  const [, navigate] = useRoute();
  const position = CHAPTERS.findIndex((c) => c.slug === chapter.slug);
  const previous = position > 0 ? CHAPTERS[position - 1] : null;
  const next = position < CHAPTERS.length - 1 ? CHAPTERS[position + 1] : null;

  return (
    <article className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => navigate('manual')}
        className="self-start text-caption text-ink-3 hover:text-ink-2"
      >
        ← All chapters
      </button>

      <header className="flex flex-col gap-2">
        <span className="text-caption text-ink-3">
          Chapter {position + 1} · {chapter.engine}
        </span>
        <h1 className="max-w-[24ch] text-balance text-figure font-medium leading-tight text-ink">
          {chapter.title}
        </h1>
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
            That is the last chapter. Nothing is unlocked by finishing it. You simply know how the
            app works now.
          </p>
        )}
      </nav>
    </article>
  );
}
