/* ===========================================================================
 * THE BAR THAT APPEARS WHEN THINGS ARE CHOSEN
 * ---------------------------------------------------------------------------
 * Sits above the bottom navigation, says how many are chosen, and offers what
 * can be done with them. It is the only evidence a person has of what a bulk
 * action is about to touch, so the count is the loudest thing on it.
 *
 * Kept out of the design barrel on purpose: `@/design/ui` is imported on the
 * first paint, and this belongs to two screens that are both loaded on demand.
 * ======================================================================== */

import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface SelectionAction {
  label: string;
  onAction: () => void;
  /** The one that releases or files something. At most one per bar. */
  primary?: boolean;
  disabled?: boolean;
}

export function SelectionBar({
  count,
  summary,
  actions,
  onCancel,
  onSelectAll,
  allChosen,
}: {
  count: number;
  /** A complete sentence: "3 payments chosen". */
  summary: string;
  actions: SelectionAction[];
  onCancel: () => void;
  onSelectAll: () => void;
  allChosen: boolean;
}) {
  return (
    <div
      className={clsx(
        'fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-raised',
        'pb-[calc(var(--nav-height)+0.5rem)] pt-3',
      )}
      role="region"
      aria-label="What to do with what you have chosen"
    >
      <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body font-medium text-ink" aria-live="polite">
            {summary}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <BarButton onClick={onSelectAll}>{allChosen ? 'None' : 'All'}</BarButton>
            <BarButton onClick={onCancel}>Cancel</BarButton>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onAction}
              disabled={action.disabled === true || count === 0}
              className={clsx(
                'h-10 rounded-md px-3.5 text-caption font-medium transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
                action.primary
                  ? 'bg-liquid text-base hover:bg-liquid-bright'
                  : 'border border-line-strong bg-surface text-ink hover:bg-overlay',
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BarButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-caption text-ink-2 hover:text-ink">
      {children}
    </button>
  );
}

/**
 * The tick beside a row while a list is in selection mode.
 *
 * A shape rather than a native checkbox: the whole row is the target, and a
 * real input inside a button would give two things to tap that do the same
 * thing and disagree about which one the screen reader announces.
 */
export function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'flex size-5 shrink-0 items-center justify-center rounded-sm border text-micro transition-colors',
        on ? 'border-liquid bg-liquid text-base' : 'border-line-strong text-transparent',
      )}
    >
      ✓
    </span>
  );
}
