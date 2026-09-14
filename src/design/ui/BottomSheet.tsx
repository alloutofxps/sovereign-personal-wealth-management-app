/* ===========================================================================
 * <BottomSheet>
 * ---------------------------------------------------------------------------
 * The primary modal surface. Four things matter more than the animation:
 *
 *  · The drag handle owns the gesture, not the sheet body, so a scrollable
 *    list inside the sheet scrolls instead of dragging the sheet away.
 *  · Height is a percentage of the wrapper, which is `fixed inset-0` and so
 *    is the real viewport. It was `100dvh`, which is a status-bar inset short
 *    in an iOS home-screen app — the same defect the viewport lock in
 *    `tokens.css` exists to document. The bottom padding carries
 *    `safe-area-inset-bottom`, so the last control never sits under the home
 *    indicator.
 *  · Focus is trapped and handed back, because `aria-modal` only tells
 *    assistive technology the rest is inert. It does not stop Tab leaving.
 *  · The shell behind recedes, the way a presented view does on iOS.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PHYSICS ARE HAND-WRITTEN
 *
 * This used a general animation library. It was correct and it cost roughly
 * half a megabyte of source in the opening bundle, second only to React
 * itself, to do four things this file now does in about ninety lines: move a
 * translate under a finger, resist past a limit, decide on release, and fade a
 * backdrop.
 *
 * The gesture is also better for being specific. A library has to guess what a
 * drag means; this knows. Downward is 1:1 with the finger because anything
 * else feels like lag. Upward is damped to a fifth because the sheet has
 * nowhere to go and the resistance is how the hand is told so. Release is
 * decided on velocity first and distance second, because a fast short flick is
 * a dismissal and a slow long drag is somebody having a look.
 *
 * Nothing here reads layout during a move. Only `transform` and `opacity`
 * change, so the whole gesture stays on the compositor.
 * ======================================================================== */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
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

/** Past either of these on release, the gesture reads as intent to dismiss. */
const DISMISS_DISTANCE = 120;
/** Pixels per millisecond. A flick, rather than a shove. */
const DISMISS_VELOCITY = 0.5;
/** How much of an upward drag is allowed through. The rest is resistance. */
const UPWARD_RESISTANCE = 0.2;
/** Long enough for the slide-out to finish before the node leaves the tree. */
const EXIT_MS = 260;
/**
 * How long the shell takes to recede, in agreement with `#app-shell`'s own
 * transition in `tokens.css`. `motion.test.ts` fails if the two drift, because
 * the consequence of them drifting is a compositor layer that is either
 * released while it is still being animated or never released at all.
 */
const RECEDE_MS = 380;

/**
 * How many sheets are open.
 *
 * Module-level because the shell can only be receded once however many sheets
 * are stacked, and the last one to close is the one that restores it. A count
 * kept in component state would have each sheet undoing the others.
 */
let openSheets = 0;

/**
 * Where the shell is being asked to go, as opposed to where it is.
 *
 * The attribute is written a frame late, so a queued frame must read this
 * rather than the value it closed over — two sheets opening and closing inside
 * one frame queue two callbacks, and the second has to win.
 */
let recedeTarget = false;

/**
 * Which recede is the current one.
 *
 * Everything deferred — the frame that starts the transform, the timer that
 * releases the layer — checks this before acting, so a superseded call does
 * nothing rather than doing something late. Measured: three sheets mounting
 * and unmounting in one frame produced three release timers, of which a
 * single `clearTimeout` could cancel one. The other two were free to remove
 * the promotion from under the next recede.
 */
let recedeGeneration = 0;

/**
 * Move the shell back, or bring it forward.
 *
 * The promotion is a separate step from the movement on purpose, and the frame
 * between them is the whole point of it: `will-change` asks the compositor to
 * prepare a layer, and asking in the same frame as the transform that needs it
 * is asking too late. See `[data-presenting]` in `tokens.css` for what the
 * attribute switches off as well as on.
 *
 * Under `prefers-reduced-motion` there is no transform to prepare for, so the
 * attribute is never set: somebody who asked for no motion should not be
 * paying for a compositor layer to deliver it.
 */
function setShellReceded(receded: boolean): void {
  const shell = document.getElementById('app-shell');
  if (!shell) return;

  // Several sheets stacked ask for the same recede. Deduped on the intent and
  // NOT on the attribute, because the attribute is written a frame late: a
  // check against it short-circuits nothing and each ask then queues its own
  // frame, each of which starts its own release timer. Only the last would be
  // tracked in `releaseLayer`, so the untracked ones survive a `clearTimeout`
  // and can strip the promotion out from under the next recede. Measured: six
  // `data-presenting` writes for one sheet before this line.
  if (recedeTarget === receded) return;
  recedeTarget = receded;

  const still =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (still) {
    shell.setAttribute('data-receded', String(receded));
    return;
  }

  const generation = (recedeGeneration += 1);
  shell.setAttribute('data-presenting', '');

  requestAnimationFrame(() => {
    if (generation !== recedeGeneration) return;
    // `recedeTarget`, not the argument: see the note on it above.
    shell.setAttribute('data-receded', String(recedeTarget));

    // Timed from inside the frame, because the release has to measure from
    // when the movement starts and not from when the hint was set. Those are
    // 16ms apart in a visible page and unbounded apart in one that is not:
    // `requestAnimationFrame` does not fire in a hidden or occluded page and
    // `setTimeout` does. Measured with a MutationObserver, with this timer
    // outside the frame: the layer was released at 454ms and the transform
    // started at 717ms — promoted for nothing, then animated unpromoted.
    //
    // A timer rather than `transitionend`, which fires once per property and
    // not at all when the attribute is set to the value it already had.
    setTimeout(() => {
      if (generation !== recedeGeneration) return;
      shell.removeAttribute('data-presenting');
    }, RECEDE_MS + 60);
  });
}

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
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const descriptionId = useId();

  /**
   * Kept mounted through the exit so the slide-out is visible.
   *
   * `open` is the caller's intent; `present` is what is in the tree. They
   * differ for exactly one animation.
   */
  const [present, setPresent] = useState(open);
  const [entered, setEntered] = useState(false);

  /* --- mount, enter, exit ------------------------------------------------ */

  useEffect(() => {
    if (open) {
      setPresent(true);
      // A frame between mount and the entering class, or the browser has
      // nothing to transition from and the sheet simply appears.
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }

    setEntered(false);
    const timer = setTimeout(() => setPresent(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  /* --- the shell behind -------------------------------------------------- */

  useEffect(() => {
    if (!present) return;
    openSheets += 1;
    setShellReceded(true);
    return () => {
      openSheets -= 1;
      if (openSheets === 0) setShellReceded(false);
    };
  }, [present]);

  /* --- escape ------------------------------------------------------------ */

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, dismissible, onClose]);

  /* --- focus trap --------------------------------------------------------
   *
   * `aria-modal` only tells assistive technology that the rest of the page is
   * inert. It does not stop the browser moving focus there, so without a real
   * trap a keyboard user tabs straight out of an open sheet and onto controls
   * hidden behind the backdrop, with no way to tell where they have landed.
   * -------------------------------------------------------------------- */

  /*
   * `present` is in the dependencies and that is the load-bearing part.
   *
   * On the render where `open` first becomes true, `present` is still false —
   * it is set by the mount effect above, one render later — so the portal is
   * not in the tree and `sheetRef.current` is null. With `[open]` alone this
   * effect returned here and never ran again, which meant that on a cold open
   * there was no focus move AND NO TAB HANDLER: `aria-modal` told assistive
   * technology the rest of the page was inert while the browser was still
   * free to move focus into it.
   *
   * Measured before the fix, three sheets, cold open then re-open inside the
   * 260ms exit window while the portal was still mounted: false → true every
   * time. `present` flips exactly when the element exists.
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
    (focusable()[0] ?? sheet).focus();

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
  }, [open, present]);

  /* --- the drag ----------------------------------------------------------
   *
   * Written against pointer events and applied straight to `style.transform`
   * rather than through state. A drag that re-renders on every move is a drag
   * that stutters on a long list, and React has nothing useful to say about
   * sixty intermediate positions.
   * -------------------------------------------------------------------- */

  const drag = useRef({ active: false, startY: 0, lastY: 0, lastAt: 0, velocity: 0, offset: 0 });
  /**
   * Whether the pointer moved far enough for this to have been a drag.
   *
   * The handle is both the gesture's target and the keyboard's close button,
   * so a press that goes nowhere has to close the sheet and a press that
   * travels must not. Four pixels is below the threshold of a deliberate
   * movement and above the jitter of a thumb on glass.
   */
  const travelled = useRef(false);

  const paint = useCallback((offset: number) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
    // The backdrop thins as the sheet leaves, so the shell behind comes back
    // into view under the finger rather than all at once on release.
    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.opacity = String(Math.max(0, 1 - offset / (DISMISS_DISTANCE * 3)));
    }
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dismissible || event.button !== 0) return;
    travelled.current = false;
    const sheet = sheetRef.current;
    if (!sheet) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.style.transition = 'none';
    drag.current = {
      active: true,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      velocity: 0,
      offset: 0,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state.active) return;

    const raw = event.clientY - state.startY;
    // Past this it was a drag, so the click that follows is not a press
    // of the close button.
    if (Math.abs(raw) > 4) travelled.current = true;
    // Down tracks the finger exactly. Up is damped, because the sheet has
    // nowhere further to go and the resistance is how that is communicated.
    state.offset = raw >= 0 ? raw : raw * UPWARD_RESISTANCE;

    const dt = event.timeStamp - state.lastAt;
    if (dt > 0) {
      state.velocity = (event.clientY - state.lastY) / dt;
      state.lastY = event.clientY;
      state.lastAt = event.timeStamp;
    }

    paint(state.offset);
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state.active) return;
    state.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const sheet = sheetRef.current;
    if (!sheet) return;

    // Velocity first: a fast short flick is a dismissal, a slow long drag is
    // somebody having a look at what is underneath.
    const dismissing = state.velocity > DISMISS_VELOCITY || state.offset > DISMISS_DISTANCE;

    if (dismissing) {
      // Carry the momentum off-screen rather than cutting to a fixed slide.
      sheet.style.transition = `transform ${EXIT_MS}ms var(--ease-sheet)`;
      sheet.style.transform = 'translate3d(0, 100%, 0)';
      onClose();
      return;
    }

    sheet.style.transition = 'transform 340ms var(--ease-snap)';
    sheet.style.transform = 'translate3d(0, 0, 0)';
    if (backdropRef.current) backdropRef.current.style.opacity = '';
  };

  // Clear the inline transform whenever the sheet settles, so the CSS classes
  // own position again and a reopened sheet does not start where it was left.
  useEffect(() => {
    if (open || !sheetRef.current) return;
    const sheet = sheetRef.current;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (backdropRef.current) backdropRef.current.style.opacity = '';
  }, [open]);

  if (typeof document === 'undefined' || !present) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        ref={backdropRef}
        role="presentation"
        onClick={dismissible ? onClose : undefined}
        className={clsx(
          'absolute inset-0 bg-[var(--scrim)] transition-opacity duration-200',
          entered ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={clsx(
          'relative flex w-full max-w-[34rem] flex-col outline-none',
          'rounded-t-sheet bg-surface',
          'shadow-[var(--shadow-sheet)]',
          'border-t-[0.5px] border-x-[0.5px] border-[var(--hairline-strong)]',
          '[transition:transform_380ms_var(--ease-sheet)]',
          entered ? 'translate-y-0' : 'translate-y-full',
          // Percentages, not `dvh`: the parent is `fixed inset-0`, so 100% of
          // it is the web view and `100dvh` is a status bar less than that.
          size === 'tall' ? 'h-[calc(100%-3.5rem)]' : 'max-h-[calc(100%-3.5rem)]',
        )}
      >
        {/* The handle owns the gesture, so content below can still scroll.
         *
         * It is a real button, not a div, because the gesture it carries is
         * otherwise the only way out of the sheet that is not Escape — and a
         * swipe is unreachable by keyboard and by switch control. Same rule as
         * `SwipeRow`'s actions. The visual treatment is unchanged: what changes
         * is that the thing which already looked like the way out can now be
         * focused and pressed. */}
        <button
          type={'button'}
          aria-label={dismissible ? 'Close' : undefined}
          disabled={!dismissible}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={() => {
            if (!dismissible) return;
            // A tap that did not travel is a press of the close button; a tap
            // that did is the end of a drag, which `endDrag` has already
            // decided about.
            if (travelled.current) return;
            onClose();
          }}
          className={clsx(
            // `target` because the handle is now a real control and it is
            // 16px tall: the bar is drawn small on purpose and the hit area
            // has to be 44. It overflows upwards into the backdrop, which
            // also closes the sheet, and downwards into the title, which is
            // not interactive.
            'target block w-full shrink-0 px-5 pt-3',
            dismissible ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-default',
          )}
        >
          {dismissible && (
            <div className="mx-auto h-1 w-9 rounded-full bg-ink-4" aria-hidden="true" />
          )}
        </button>

        {title && (
          <div className="px-5 pt-3">
            <h2 id={labelId} className="text-lead font-medium tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="pt-1 text-caption text-ink-2">
                {description}
              </p>
            )}
          </div>
        )}

        <div className="scroll-y min-h-0 flex-1 px-5 pt-4 pb-2">{children}</div>

        {footer && (
          <div className="shrink-0 border-t-[0.5px] border-[var(--hairline)] bg-surface px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
            {footer}
          </div>
        )}
        {!footer && <div className="h-[var(--safe-bottom)] shrink-0" />}
      </div>
    </div>,
    document.body,
  );
}
