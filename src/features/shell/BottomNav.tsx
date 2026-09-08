import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Route } from '@/app/router';

interface Tab {
  route: Route;
  label: string;
  icon: React.ReactNode;
}

/**
 * Four places and one action, on a floating frosted dock.
 *
 * The dock does not span the screen. It sits above the home indicator with air
 * on both sides, so content scrolls visibly past and under it and the screen
 * reads as one continuous surface rather than a page with a toolbar bolted to
 * the bottom.
 *
 * The active pill is a single element that slides, measured from the live
 * button rather than derived from an index: the labels differ in width, and an
 * index would put the pill in approximately the right place.
 *
 * The add button is a circle rather than a tab because it is an action, not a
 * destination. It never reads as "somewhere you are".
 */
export function BottomNav({
  route,
  onNavigate,
  onAdd,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  onAdd: () => void;
}) {
  const tabs: Tab[] = [
    { route: 'home', label: 'Home', icon: <HomeIcon /> },
    { route: 'forecast', label: 'Ahead', icon: <ChartIcon /> },
    { route: 'accounts', label: 'Accounts', icon: <WalletIcon /> },
    { route: 'settings', label: 'Settings', icon: <GearIcon /> },
  ];

  /** Which tab owns this route. Several routes live under one tab. */
  const activeRoute = (tab: Route): boolean => {
    if (route === tab) return true;
    if (tab === 'home') return route === 'budget';
    if (tab === 'forecast') {
      return (
        route === 'debt' ||
        route === 'independence' ||
        route === 'calendar' ||
        route === 'analytics' ||
        route === 'whatif'
      );
    }
    if (tab === 'accounts') {
      return route === 'pots' || route === 'triage' || route === 'transactions';
    }
    if (tab === 'settings') return route === 'categories' || route === 'manual';
    return false;
  };

  const activeIndex = tabs.findIndex((tab) => activeRoute(tab.route));

  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const dockRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  const measure = useCallback(() => {
    const button = refs.current[activeIndex];
    if (!button) {
      setPill(null);
      return;
    }
    setPill({ x: button.offsetLeft, w: button.offsetWidth });
  }, [activeIndex]);

  // Layout effect so the pill is under the right tab on the very first paint
  // rather than sliding in from the left when the app opens.
  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const dock = dockRef.current;
    if (!dock) return;
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pt-8 pb-[var(--dock-gap)]"
    >
      {/*
       * The scrim.
       *
       * Content is meant to scroll behind the dock, and it does. What it must
       * not do is carry on *past* it into the gap above the home indicator,
       * where a chart axis or a half row sits under a floating bar looking
       * like a rendering fault. This fades the page out as it reaches the
       * dock and fills the band below it, so the bottom of the screen reads
       * as chrome rather than as leftover list.
       */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 top-0 -z-10 bg-gradient-to-t from-base via-base to-transparent"
      />
      <div
        ref={dockRef}
        className={clsx(
          'glass pointer-events-auto relative flex w-full max-w-[26rem] items-center gap-1 rounded-[1.75rem] p-1.5',
          // The rim reads as a chamfer catching the same light as everything
          // else, which is what stops a floating object looking pasted on.
          'border-[0.5px] border-[var(--hairline-strong)]',
          'shadow-[inset_0_1px_0_0_var(--rim-top),var(--shadow-dock)]',
        )}
      >
        {pill && (
          <span
            aria-hidden="true"
            className={clsx(
              'absolute top-1.5 bottom-1.5 left-0 rounded-[1.4rem] bg-[var(--fill-subtle)]',
              'motion-safe:[transition:transform_360ms_var(--ease-snap),width_360ms_var(--ease-snap)]',
            )}
            style={{ transform: `translate3d(${pill.x}px,0,0)`, width: pill.w }}
          />
        )}

        {tabs.slice(0, 2).map((tab, index) => (
          <NavButton
            key={tab.route}
            ref={(el) => {
              refs.current[index] = el;
            }}
            tab={tab}
            active={index === activeIndex}
            onNavigate={onNavigate}
          />
        ))}

        <div className="relative z-10 flex shrink-0 items-center justify-center px-1">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a payment"
            className={clsx(
              'press flex size-11 items-center justify-center rounded-full bg-liquid text-base',
              'shadow-[0_4px_16px_-4px_color-mix(in_srgb,var(--color-liquid)_60%,transparent)]',
            )}
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {tabs.slice(2).map((tab, index) => (
          <NavButton
            key={tab.route}
            ref={(el) => {
              refs.current[index + 2] = el;
            }}
            tab={tab}
            active={index + 2 === activeIndex}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </nav>
  );
}

function NavButton({
  ref,
  tab,
  active,
  onNavigate,
}: {
  ref: React.Ref<HTMLButtonElement>;
  tab: Tab;
  active: boolean;
  onNavigate: (route: Route) => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onNavigate(tab.route)}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'press relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.4rem] py-2',
        'transition-colors',
        active ? 'text-liquid' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      {tab.icon}
      <span className="text-[0.625rem] font-medium tracking-[0.06em]">{tab.label}</span>
    </button>
  );
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5Z" {...stroke} />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V5" {...stroke} />
      <path d="M4 15.5 9 11l3.5 3L20 6.5" {...stroke} />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.5" {...stroke} />
      <path d="M3 10h18M16.5 14.5h1.5" {...stroke} />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" {...stroke} />
      <path
        d="M12 3.5v2m0 13v2M20.5 12h-2m-13 0h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7 6.3 6.3"
        {...stroke}
      />
    </svg>
  );
}
