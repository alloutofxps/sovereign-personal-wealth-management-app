/* ===========================================================================
 * <SwipeRow>
 * ---------------------------------------------------------------------------
 * The interaction the zero-inbox triage queue is built on: one swipe clears
 * one transaction. Clearing a backlog has to cost a single gesture, or the
 * queue becomes the administrative burden the research says drives churn.
 *
 * Accessibility is not optional here. A swipe is unreachable by keyboard and
 * by switch control, so both actions are also real buttons, visually hidden
 * until focused, then revealed in place.
 *
 * ---------------------------------------------------------------------------
 * THE GESTURE
 *
 * Pointer events applied straight to `style.transform`, never through React
 * state. A row that re-renders on every pointermove is a row that stutters in
 * a list of forty, and there is nothing useful React can do with sixty
 * intermediate positions.
 *
 * Direction is locked on the first few pixels. Without that, a vertical scroll
 * that starts a hair off-axis drags the row sideways and the list feels loose.
 * Once the axis is decided it is kept for the whole gesture.
 * ======================================================================== */

import clsx from 'clsx';
import { useRef, type ReactNode } from 'react';

export type SwipeTone = 'liquid' | 'caution' | 'deficit' | 'neutral';

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  tone?: SwipeTone;
  onAction: () => void;
}

export interface SwipeRowProps {
  children: ReactNode;
  /** Revealed by swiping right. Conventionally the confirming action. */
  leftAction?: SwipeAction;
  /** Revealed by swiping left. Conventionally defer, split or re-categorise. */
  rightAction?: SwipeAction;
  onClick?: () => void;
  className?: string;
}

/** Distance past which the gesture commits rather than springing back. */
const COMMIT_AT = 96;
const MAX_TRAVEL = 132;
/** Pixels of movement before the axis is decided. */
const AXIS_LOCK_AT = 6;
/** Past the constraint, travel is damped rather than stopped dead. */
const OVERSHOOT = 0.08;

const TONE: Record<SwipeTone, string> = {
  liquid: 'bg-liquid-wash text-liquid',
  caution: 'bg-caution-wash text-caution',
  deficit: 'bg-deficit-wash text-deficit',
  neutral: 'bg-raised text-ink-2',
};

export function SwipeRow({ children, leftAction, rightAction, onClick, className }: SwipeRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const state = useRef({
    active: false,
    axis: '' as '' | 'x' | 'y',
    startX: 0,
    startY: 0,
    offset: 0,
    dragged: false,
    committing: false,
  });

  /** Move the row and fade whichever action is being pulled open. */
  function paint(offset: number) {
    const row = rowRef.current;
    if (row) row.style.transform = `translate3d(${offset}px,0,0)`;

    // Opacity belongs to the layer and scale to the label inside it, so the
    // label is passed down as a custom property rather than needing a second
    // ref. Setting opacity on the child would do nothing: the layer itself is
    // transparent until pulled, and a parent's opacity is not overridable.
    const openness = Math.min(1, Math.abs(offset) / COMMIT_AT);
    const reveal = (layer: HTMLDivElement | null, showing: boolean) => {
      if (!layer) return;
      const amount = showing ? openness : 0;
      layer.style.opacity = String(amount);
      layer.style.setProperty('--reveal', String(0.72 + 0.28 * amount));
    };
    reveal(leftRef.current, offset > 0);
    reveal(rightRef.current, offset < 0);
  }

  function settle(to: number, ms: number, easing: string, then?: () => void) {
    const row = rowRef.current;
    if (!row) return;
    row.style.transition = `transform ${ms}ms ${easing}`;
    paint(to);
    if (then) window.setTimeout(then, ms);
  }

  function commit(action: SwipeAction, direction: 1 | -1) {
    state.current.committing = true;
    // Slide the row clear of the list before the action mutates it, so the
    // removal reads as a consequence of the gesture rather than a jump cut.
    settle(direction * 400, 180, 'cubic-bezier(0.16,1,0.3,1)', action.onAction);
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (state.current.committing || event.button !== 0) return;
    const row = rowRef.current;
    if (row) row.style.transition = 'none';
    state.current = {
      active: true,
      axis: '',
      startX: event.clientX,
      startY: event.clientY,
      offset: 0,
      dragged: false,
      committing: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = state.current;
    if (!s.active) return;

    const dx = event.clientX - s.startX;
    const dy = event.clientY - s.startY;

    // Decide the axis once, on the first real movement, and keep it. A
    // vertical scroll that starts a hair off-axis must not drag the row.
    if (s.axis === '') {
      if (Math.abs(dx) < AXIS_LOCK_AT && Math.abs(dy) < AXIS_LOCK_AT) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (s.axis === 'x') event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (s.axis !== 'x') return;

    s.dragged = true;
    const min = rightAction ? -MAX_TRAVEL : 0;
    const max = leftAction ? MAX_TRAVEL : 0;
    // Past the limit the row still moves, just reluctantly.
    s.offset = dx > max ? max + (dx - max) * OVERSHOOT : dx < min ? min + (dx - min) * OVERSHOOT : dx;
    paint(s.offset);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = state.current;
    if (!s.active) return;
    s.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (s.axis !== 'x') return;

    if (leftAction && s.offset > COMMIT_AT) commit(leftAction, 1);
    else if (rightAction && s.offset < -COMMIT_AT) commit(rightAction, -1);
    else settle(0, 320, 'var(--ease-snap)');

    // Let the click handler see the gesture before the flag resets.
    window.setTimeout(() => {
      s.dragged = false;
    }, 0);
  };

  return (
    <div className={clsx('relative isolate overflow-hidden', className)}>
      {leftAction && <ActionLayer ref={leftRef} action={leftAction} side="left" />}
      {rightAction && <ActionLayer ref={rightRef} action={rightAction} side="right" />}

      <div
        ref={rowRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (!state.current.dragged) onClick?.();
        }}
        className={clsx(
          'relative z-10 bg-surface transition-colors',
          // Vertical panning stays with the list; horizontal is ours.
          'touch-pan-y',
          onClick && 'cursor-pointer',
          '[@media(hover:hover)]:hover:bg-raised',
        )}
      >
        {children}
      </div>

      {/* Keyboard and switch-control path for the same two actions. */}
      <div className="absolute inset-y-0 right-0 z-20 flex items-center gap-1 pr-2 opacity-0 focus-within:relative focus-within:opacity-100">
        {leftAction && <FocusAction action={leftAction} />}
        {rightAction && <FocusAction action={rightAction} />}
      </div>
    </div>
  );
}

function ActionLayer({
  ref,
  action,
  side,
}: {
  ref: React.Ref<HTMLDivElement>;
  action: SwipeAction;
  side: 'left' | 'right';
}) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ opacity: 0 }}
      className={clsx(
        'absolute inset-y-0 z-0 flex w-1/2 items-center px-5',
        side === 'left' ? 'left-0 justify-start' : 'right-0 justify-end',
        TONE[action.tone ?? 'neutral'],
      )}
    >
      <span className="flex origin-center items-center gap-2 text-caption font-medium [scale:var(--reveal,0.72)]">
        {action.icon}
        {action.label}
      </span>
    </div>
  );
}

function FocusAction({ action }: { action: SwipeAction }) {
  return (
    <button
      type="button"
      onClick={action.onAction}
      className={clsx(
        'rounded-md px-3 py-1.5 text-caption font-medium',
        'sr-only focus:not-sr-only focus:static',
        TONE[action.tone ?? 'neutral'],
      )}
    >
      {action.label}
    </button>
  );
}
