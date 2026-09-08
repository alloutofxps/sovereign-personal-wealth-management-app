/* ===========================================================================
 * TABS
 * ---------------------------------------------------------------------------
 * The full WAI-ARIA tab pattern, which is more than markup: arrow keys move
 * between tabs, Home and End jump to the ends, and only the selected tab is in
 * the page's tab order, so a keyboard user tabs *past* the strip rather than
 * through every tab in it.
 *
 * The indicator is a single element that slides between tabs, rather than a
 * border toggling on and off. Its position is measured from the selected
 * button and applied as a transform, so the movement runs on the compositor
 * and the strip reflows correctly when the labels or the width change.
 *
 * It respects reduced motion, because a moving pill is decoration and
 * decoration is the first thing that should hold still when somebody has asked
 * for less movement.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STRIP SCROLLS RATHER THAN WRAPS
 *
 * The tabs were free to wrap, and on a 393px phone the Ahead strip wrapped
 * "Where it went" onto three lines and "What if" onto two. That is worse than
 * it sounds: every tab in a flex row is as tall as the tallest, so one wrapped
 * label triples the height of the whole strip, and the sliding pill — sized
 * from the selected button — stopped being a pill and became a circle.
 *
 * Five labels of this length genuinely do not fit across that screen at any
 * size worth reading, so something had to give. Scrolling gives up the least:
 * `whitespace-nowrap` holds every label on one line and stops a tab shrinking
 * below it, `flex-1` still shares the space out evenly whenever there *is*
 * enough, and the strip overflows into a horizontal scroll only when there is
 * not. The selected tab is scrolled back into view on every change, so the
 * current pane is never the one hidden off the edge.
 * ======================================================================== */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const stripRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  /**
   * Where the pill should sit.
   *
   * Measured rather than derived from an index, because the tabs are flexed
   * and a label of a different length moves every edge after it.
   */
  const measure = useCallback(() => {
    const index = tabs.findIndex((tab) => tab.value === value);
    const button = refs.current[index];
    if (!button) return;
    setIndicator({ x: button.offsetLeft, w: button.offsetWidth });
  }, [tabs, value]);

  // Layout effect so the pill is in place on the first paint rather than
  // sliding in from the left the first time the strip renders.
  useLayoutEffect(measure, [measure]);

  /*
   * Bring the selected tab back into view.
   *
   * Only ever scrolls the strip itself. `scrollIntoView` would scroll every
   * ancestor too, which on a strip sitting at the top of a screen means the
   * whole page jumps whenever somebody changes pane.
   *
   * Instant rather than smooth, and that is not a shortcut. Where this strip
   * drives a route, the view above it is keyed on that route and remounts, so
   * every change arrives as a fresh strip scrolled to nought — and animating
   * from nought is animating from a position nobody was ever looking at. It
   * reads as the strip sliding about on its own.
   *
   * Does nothing at all when everything already fits, which is most strips.
   */
  useEffect(() => {
    const strip = stripRef.current;
    const index = tabs.findIndex((tab) => tab.value === value);
    const button = refs.current[index];
    if (!strip || !button || strip.scrollWidth <= strip.clientWidth) return;

    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left - 8;
    else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth + 8;
    }
  }, [tabs, value]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [measure]);

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
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={clsx(
        'relative flex gap-1 rounded-pill border-[0.5px] border-[var(--hairline)] bg-sunken p-1',
        // Scrolls only when the labels genuinely do not fit; see the note at
        // the top of this file. The bar itself is hidden — the half-visible
        // tab at the edge is the affordance, the way it is on iOS.
        'no-bar overflow-x-auto',
        className,
      )}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className={clsx(
            'absolute top-1 bottom-1 left-0 rounded-pill bg-liquid',
            'motion-safe:[transition:transform_320ms_var(--ease-snap),width_320ms_var(--ease-snap)]',
          )}
          style={{ transform: `translate3d(${indicator.x}px,0,0)`, width: indicator.w }}
        />
      )}

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
              'press relative z-10 flex-1 whitespace-nowrap rounded-pill px-3 py-1.5 text-caption outline-none',
              'transition-colors focus-visible:ring-1 focus-visible:ring-liquid',
              selected ? 'text-base' : 'text-ink-2 hover:text-ink',
            )}
          >
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
