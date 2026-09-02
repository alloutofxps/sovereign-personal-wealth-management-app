import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import clsx from 'clsx';
import { useToasts } from '@/app/toast';

const VISIBLE_FOR_MS = 5000;

/** Confirmations, stacked above the navigation bar. */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+var(--safe-bottom))] z-40 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            className={clsx(
              'pointer-events-auto flex w-full max-w-[34rem] items-start gap-3',
              'rounded-md border px-3.5 py-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]',
              t.tone === 'attention'
                ? 'border-caution-dim/60 bg-caution-wash'
                : 'border-line-strong bg-overlay',
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
                className="shrink-0 text-caption font-medium text-liquid"
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
              className="shrink-0 text-ink-3 hover:text-ink-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <Timer id={t.id} onDone={dismiss} />
          </motion.div>
        ))}
      </AnimatePresence>
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
