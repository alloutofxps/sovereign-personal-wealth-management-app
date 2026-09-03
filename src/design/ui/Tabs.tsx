/* ===========================================================================
 * TABS
 * ---------------------------------------------------------------------------
 * The full WAI-ARIA tab pattern, which is more than markup: arrow keys move
 * between tabs, Home and End jump to the ends, and only the selected tab is in
 * the page's tab order, so a keyboard user tabs *past* the strip rather than
 * through every tab in it.
 *
 * The indicator is a single element that slides between tabs using a layout
 * animation, rather than a border toggling on and off. It respects reduced
 * motion, because a moving pill is decoration and decoration is the first
 * thing that should hold still when somebody has asked for less movement.
 * ======================================================================== */

import { useId, useRef, type ReactNode } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import clsx from 'clsx';

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  /** Rendered after the label in tabular figures. */
  count?: number;
}

export interface TabsProps<T extends string = string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the strip for screen readers, e.g. "Filter transactions". */
  label: string;
  className?: string;
}

export function Tabs<T extends string = string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: TabsProps<T>) {
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: React.KeyboardEvent) {
    const current = tabs.findIndex((t) => t.value === value);
    if (current < 0) return;

    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;

    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.value);
    // The pattern is "selection follows focus", so move focus with it.
    refs.current[next]?.focus();
  }

  return (
    <LayoutGroup id={groupId}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={clsx(
          'flex gap-1 rounded-pill border border-line bg-sunken p-1',
          className,
        )}
      >
        {tabs.map((tab, index) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${groupId}-tab-${tab.value}`}
              aria-selected={selected}
              aria-controls={`${groupId}-panel-${tab.value}`}
              // Only the selected tab is reachable by Tab; arrows do the rest.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={clsx(
                'relative flex-1 rounded-pill px-3 py-1.5 text-caption transition-colors outline-none',
                'focus-visible:ring-1 focus-visible:ring-liquid',
                selected ? 'text-base' : 'text-ink-2 hover:text-ink',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute inset-0 rounded-pill bg-liquid"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 42 }
                  }
                />
              )}
              <span className="relative flex items-center justify-center gap-1.5">
                {tab.label}
                {tab.count !== undefined && (
                  <span className={clsx('tnum', selected ? 'text-base/70' : 'text-ink-3')}>
                    {tab.count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/** The panel a tab controls. Rendering only the active one is fine and normal. */
export function TabPanel({
  id,
  tabValue,
  children,
}: {
  /** The same id passed to the Tabs above it is not available, so pass a stable one. */
  id: string;
  tabValue: string;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={`${id}-panel-${tabValue}`} aria-labelledby={`${id}-tab-${tabValue}`}>
      {children}
    </div>
  );
}
