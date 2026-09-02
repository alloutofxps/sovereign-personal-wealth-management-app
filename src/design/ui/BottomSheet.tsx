/* ===========================================================================
 * <BottomSheet>
 * ---------------------------------------------------------------------------
 * The primary modal surface on mobile. Three details matter more than the
 * animation:
 *
 *  · The drag handle owns the gesture, not the sheet body — so a scrollable
 *    list inside the sheet scrolls instead of dragging the sheet away.
 *  · Height is `dvh`, and the bottom padding carries `safe-area-inset-bottom`,
 *    so the last control never sits under the iOS home indicator.
 *  · The page behind is scroll-locked at its current offset and restored on
 *    close, so dismissing a sheet never jumps the list underneath.
 * ======================================================================== */

import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Supporting line under the title. Also the dialog's accessible description. */
  description?: string;
  children: ReactNode;
  /** Pinned below the scrolling content, above the safe area. */
  footer?: ReactNode;
  /** `tall` reserves the full viewport less a top inset, for long lists. */
  size?: 'auto' | 'tall';
  /** Set false for a sheet that must be resolved by an explicit choice. */
  dismissible?: boolean;
}

/** Past either of these, the gesture reads as intent to dismiss. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 480;

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'auto',
  dismissible = true,
}: BottomSheetProps) {
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const descriptionId = useId();

  // Lock the page behind the sheet without losing its scroll position.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = body.style.cssText;
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      body.style.cssText = previous;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  /**
   * Keep Tab inside the sheet.
   *
   * `aria-modal` only tells assistive technology that the rest of the page is
   * inert — it does not stop the browser moving focus there. Without a real
   * trap, a keyboard user tabs straight out of an open sheet and onto controls
   * hidden behind the backdrop, with no way to tell where they have landed.
   */
  useEffect(() => {
    if (!open) return;

    const sheet = sheetRef.current;
    if (!sheet) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      [
        ...sheet.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Start on the first control rather than the sheet itself, so the first
    // Tab does not appear to do nothing.
    const initial = focusable()[0];
    (initial ?? sheet).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        sheet.focus();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (!sheet.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Hand focus back to whatever opened the sheet.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  const startDrag = (event: PointerEvent) => {
    if (dismissible) dragControls.start(event);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={dismissible ? onClose : undefined}
          />

          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? labelId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={clsx(
              'relative flex w-full max-w-[34rem] flex-col outline-none',
              'rounded-t-sheet border-t border-x border-line-strong bg-surface',
              'shadow-[0_-16px_48px_-12px_rgba(0,0,0,0.7)]',
              size === 'tall' ? 'h-[calc(100dvh-3.5rem)]' : 'max-h-[calc(100dvh-3.5rem)]',
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40, mass: 0.9 }}
            drag={dismissible ? 'y' : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.75 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
            }}
          >
            {/* The handle is the drag surface, so content below can scroll. */}
            <div
              onPointerDown={startDrag}
              className={clsx(
                'shrink-0 px-5 pt-3',
                dismissible ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-default',
              )}
            >
              {dismissible && (
                <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" aria-hidden="true" />
              )}
              {title && (
                <div className="pt-3">
                  <h2 id={labelId} className="text-lead font-medium text-ink">
                    {title}
                  </h2>
                  {description && (
                    <p id={descriptionId} className="pt-1 text-caption text-ink-2">
                      {description}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-2">
              {children}
            </div>

            {footer && (
              <div className="shrink-0 border-t border-line bg-surface px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
                {footer}
              </div>
            )}
            {!footer && <div className="h-[var(--safe-bottom)] shrink-0" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
