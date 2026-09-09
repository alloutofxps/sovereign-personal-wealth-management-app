/* ===========================================================================
 * THE EXPLANATION SHEET
 * ---------------------------------------------------------------------------
 * What opens when somebody presses an information button. Three parts, in the
 * order somebody needs them:
 *
 *   short   the whole answer, on its own. Most people stop here, and that is
 *           the design rather than a failure of it.
 *   worked  the same sum in their own figures, when the screen knows them.
 *   how     the arithmetic in general, for anybody still reading.
 *
 * Then, where a chapter exists, the way through to it. The chapter carries the
 * caveats that will not fit in three sentences — which is the whole reason a
 * short version is allowed to be short without being a half-truth.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { loadExplanations, type ExplainContext, type ExplainTopic, type Explanation } from '@/content/explain';
import { BottomSheet } from '@/design/ui';
import { ManualLink } from '@/features/manual/ManualLink';

export function ExplainSheet({
  topic,
  context,
  onClose,
}: {
  /** Null closes the sheet. The screen owns which topic is open. */
  topic: ExplainTopic | null;
  context: ExplainContext;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<Explanation | null>(null);

  /*
   * The registry arrives when somebody asks for it, not before.
   *
   * `cancelled` matters here: pressing two buttons quickly would otherwise
   * race, and the slower load could land after the faster one and show the
   * wrong explanation under the right title.
   */
  useEffect(() => {
    if (topic === null) return;
    let cancelled = false;
    void loadExplanations().then((all) => {
      if (!cancelled) setEntry(all[topic]);
    });
    return () => {
      cancelled = true;
    };
  }, [topic]);

  const showing = topic !== null && entry !== null && entry.id === topic ? entry : null;
  const worked = showing?.worked?.(context) ?? null;

  return (
    <BottomSheet
      open={topic !== null}
      onClose={onClose}
      title={showing?.title ?? ''}
      {...(showing ? { description: showing.short } : {})}
    >
      {showing && (
        <div className="flex flex-col gap-5 pb-2">
          {worked !== null && (
            <p className="card p-4 text-body leading-relaxed text-ink">{worked}</p>
          )}

          <ul className="flex flex-col gap-3">
            {showing.how.map((line, index) => (
              <li key={index} className="flex gap-3 text-body leading-relaxed text-ink-2">
                {/* A drawn rule rather than a dash character: it sits on the
                    optical baseline at any size, and it keeps the one glyph
                    this app has no other use for out of running text. */}
                <span
                  aria-hidden="true"
                  className="mt-[0.7em] h-px w-3 shrink-0 rounded-full bg-ink-4"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {showing.manual && (
            <div className="flex border-t border-line pt-4">
              <ManualLink chapter={showing.manual}>Read the whole story</ManualLink>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
