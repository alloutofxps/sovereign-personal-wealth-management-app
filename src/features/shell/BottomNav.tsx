import clsx from 'clsx';
import type { Route } from '@/app/router';

interface Tab {
  route: Route;
  label: string;
  icon: React.ReactNode;
}

/**
 * Four places and one action. The add button sits in the middle because it is
 * the thing people do most often, and it is a circle rather than a tab so it
 * never reads as "somewhere you are".
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
    { route: 'triage', label: 'To review', icon: <InboxIcon /> },
    { route: 'accounts', label: 'Accounts', icon: <WalletIcon /> },
    { route: 'settings', label: 'Settings', icon: <GearIcon /> },
  ];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md"
    >
      <div className="mx-auto grid max-w-[42rem] grid-cols-5 items-center px-2 pb-[var(--safe-bottom)]">
        {tabs.slice(0, 2).map((tab) => (
          <NavButton key={tab.route} tab={tab} active={route === tab.route} onNavigate={onNavigate} />
        ))}

        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a payment"
            className={clsx(
              'flex size-12 items-center justify-center rounded-full bg-liquid text-base',
              'transition-transform active:scale-95',
              'shadow-[0_4px_16px_-4px_color-mix(in_srgb,var(--color-liquid)_60%,transparent)]',
            )}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {tabs.slice(2).map((tab) => (
          <NavButton key={tab.route} tab={tab} active={route === tab.route} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}

function NavButton({
  tab,
  active,
  onNavigate,
}: {
  tab: Tab;
  active: boolean;
  onNavigate: (route: Route) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(tab.route)}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex h-14 flex-col items-center justify-center gap-1 transition-colors',
        active ? 'text-liquid' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      {tab.icon}
      <span className="text-micro tracking-[0.04em]">{tab.label}</span>
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

function InboxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" {...stroke} />
      <path d="M4 13h4l1.5 2.5h5L16 13h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" {...stroke} />
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
