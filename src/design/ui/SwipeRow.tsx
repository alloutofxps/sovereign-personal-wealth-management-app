/* ===========================================================================
 * <SwipeRow>
 * ---------------------------------------------------------------------------
 * The interaction the zero-inbox triage queue is built on: one swipe clears
 * one transaction. Clearing a backlog has to cost a single gesture, or the
 * queue becomes the administrative burden the research says drives churn.
 *
 * Accessibility is not optional here. A swipe is unreachable by keyboard and
 * by switch control, so both actions are also real buttons — visually hidden
 * until focused, then revealed in place.
 * ======================================================================== */

import clsx from 'clsx';
import { motion, useMotionValue, useTransform, animate, type MotionValue } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';

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

const TONE: Record<SwipeTone, string> = {
  liquid: 'bg-liquid-wash text-liquid',
  caution: 'bg-caution-wash text-caution',
  deficit: 'bg-deficit-wash text-deficit',
  neutral: 'bg-raised text-ink-2',
};

export function SwipeRow({ children, leftAction, rightAction, onClick, className }: SwipeRowProps) {
  const x = useMotionValue(0);
  const [committing, setCommitting] = useState(false);
  const dragged = useRef(false);

  // Each action fades and scales in only as its own side is pulled open.
  const leftProgress = useTransform(x, [0, COMMIT_AT], [0, 1], { clamp: true });
  const rightProgress = useTransform(x, [0, -COMMIT_AT], [0, 1], { clamp: true });

  const commit = (action: SwipeAction, direction: 1 | -1) => {
    setCommitting(true);
    // Slide the row clear of the list before the action mutates it, so the
    // removal reads as a consequence of the gesture rather than a jump cut.
    void animate(x, direction * 400, { duration: 0.18, ease: [0.16, 1, 0.3, 1] }).then(() => {
      action.onAction();
    });
  };

  return (
    <div className={clsx('relative isolate overflow-hidden', className)}>
      {leftAction && <ActionLayer action={leftAction} side="left" progress={leftProgress} />}
      {rightAction && <ActionLayer action={rightAction} side="right" progress={rightProgress} />}

      <motion.div
        style={{ x }}
        drag={committing ? false : 'x'}
        dragDirectionLock
        dragConstraints={{
          left: rightAction ? -MAX_TRAVEL : 0,
          right: leftAction ? MAX_TRAVEL : 0,
        }}
        dragElastic={0.08}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          const { x: offset } = info.offset;
          if (leftAction && offset > COMMIT_AT) commit(leftAction, 1);
          else if (rightAction && offset < -COMMIT_AT) commit(rightAction, -1);
          else void animate(x, 0, { type: 'spring', stiffness: 600, damping: 45 });
          // Let the click handler see the gesture before the flag resets.
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
        onClick={() => {
          if (!dragged.current) onClick?.();
        }}
        className={clsx(
          'relative z-10 bg-surface',
          onClick && 'cursor-pointer',
          '[@media(hover:hover)]:hover:bg-raised transition-colors',
        )}
      >
        {children}
      </motion.div>

      {/* Keyboard and switch-control path for the same two actions. */}
      <div className="absolute inset-y-0 right-0 z-20 flex items-center gap-1 pr-2 opacity-0 focus-within:relative focus-within:opacity-100">
        {leftAction && <FocusAction action={leftAction} />}
        {rightAction && <FocusAction action={rightAction} />}
      </div>
    </div>
  );
}

function ActionLayer({
  action,
  side,
  progress,
}: {
  action: SwipeAction;
  side: 'left' | 'right';
  progress: MotionValue<number>;
}) {
  const scale = useTransform(progress, [0, 1], [0.72, 1]);
  return (
    <motion.div
      aria-hidden="true"
      style={{ opacity: progress }}
      className={clsx(
        'absolute inset-y-0 z-0 flex w-1/2 items-center px-5',
        side === 'left' ? 'left-0 justify-start' : 'right-0 justify-end',
        TONE[action.tone ?? 'neutral'],
      )}
    >
      <motion.span style={{ scale }} className="flex items-center gap-2 text-caption font-medium">
        {action.icon}
        {action.label}
      </motion.span>
    </motion.div>
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
