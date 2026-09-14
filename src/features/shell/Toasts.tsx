import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useToasts } from '@/app/toast';

const VISIBLE_FOR_MS = 5000;
/** Long enough for the fade out, short enough not to hold the stack open. */
const EXIT_MS = 200;

/** Confirmations, stacked above the navigation bar. */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  /**
   * Toasts that have gone from the store but are still fading.
   *
   * The store is the truth about what is *current*; this holds the last
   * frame of anything on its way out, so a dismissal fades rather than
   * vanishing mid-sentence. Entrance needs no such trick, because a node
   * mounting with the leaving classes off already animates from them.
   */
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());
  const [held, setHeld] = useState(toasts);
  const previous = useRef(toasts);

  useEffect(() => {
    const gone = previous.current.filter((old) => !toasts.some((t) => t.id === old.id));
    previous.current = toasts;

    if (gone.length === 0) {
      setHeld(toasts);
      return;
    }

    // Keep the departed on screen, marked, until the transition has run.
    setHeld((current) => {
      const byId = new Map(current.map((t) => [t.id, t]));
      for (const t of toasts) byId.set(t.id, t);
      return [...byId.values()];
    });
    setLeaving((current) => new Set([...current, ...gone.map((t) => t.id)]));

    const timer = setTimeout(() => {
      setHeld(toasts);
      setLeaving((current) => {
        const next = new Set(current);
        for (const t of gone) next.delete(t.id);
        return next;
      });
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  const shown = held;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+var(--safe-bottom))] z-40 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="false"
    >
      {shown.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex w-full max-w-[34rem] items-start gap-3',
            'card px-3.5 py-3',
            '[transition:opacity_200ms_ease,transform_260ms_var(--ease-snap)]',
            leaving.has(t.id)
              ? 'translate-y-2 scale-[0.98] opacity-0'
              : 'translate-y-0 scale-100 opacity-100',
            t.tone === 'attention' ? 'bg-caution-wash' : 'bg-overlay',
          )}
        >
          <p
            className={clsx(
              'flex-1 text-caption',
              t.tone === 'attention' ? 'text-caution' : 'text-ink',
            )}
          >
            {t.message}
          </p>
          {t.action && (
            <button
              type="button"
              className="target press shrink-0 text-caption font-medium text-liquid"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="press shrink-0 text-ink-3 hover:text-ink-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <Timer id={t.id} onDone={dismiss} />
        </div>
      ))}
    </div>
  );
}

function Timer({ id, onDone }: { id: number; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(id), VISIBLE_FOR_MS);
    return () => clearTimeout(timer);
  }, [id, onDone]);
  return null;
}
