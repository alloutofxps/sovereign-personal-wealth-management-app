/* The review queue. It fills up once bank statements can be brought in, which
 * is the next slice. Until then this says so plainly rather than showing an
 * empty list with no explanation. */

import { Card } from '@/design/ui';

export function TriageView() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">To review</h1>
        <p className="text-caption text-ink-2">
          Anything that needs a quick look from you will collect here.
        </p>
      </header>

      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-lead text-ink">Nothing needs reviewing</p>
          <p className="max-w-[36ch] text-caption text-ink-2">
            When you bring in a statement from your bank, anything Sovereign is not sure about
            will wait here for you. You will be able to clear each one with a single swipe.
          </p>
          <p className="max-w-[36ch] text-caption text-ink-3">
            Bringing in statements is not built yet. Everything you add by hand is already
            confirmed, so it goes straight to your records.
          </p>
        </div>
      </Card>
    </div>
  );
}
