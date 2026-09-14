import type { AppUpdate } from '@/app/pwa/useAppUpdate';
import { Button } from '@/design/ui';

/** One quiet line above the navigation, offering a newer version. */
export function UpdateBanner({ update }: { update: AppUpdate }) {
  if (!update.ready) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-[calc(4.5rem+var(--safe-bottom))] z-40 flex justify-center px-4"
      role="status"
    >
      <div className="flex w-full max-w-[34rem] items-center gap-3 rounded-md border border-line-strong bg-overlay px-3.5 py-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
        <p className="flex-1 text-caption text-ink">
          There is a newer version of Sovereign ready.
        </p>
        <Button variant="quiet" size="sm" onClick={update.apply}>
          Refresh
        </Button>
        <button
          type="button"
          aria-label="Not now"
          onClick={update.dismiss}
          className="shrink-0 text-ink-3 [@media(hover:hover)]:hover:text-ink-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
