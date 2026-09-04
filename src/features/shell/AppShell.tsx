/* ===========================================================================
 * THE APP SHELL
 * ---------------------------------------------------------------------------
 * Bottom navigation, a quick way to record a payment, and whichever view the
 * hash says we are on. The database opens once here, and the starter accounts
 * are created on a first run.
 * ======================================================================== */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { openDatabase } from '@/data/client';
import { ensureStarterChart } from '@/data/seed';
import type { StorageStatus } from '@/data/worker/protocol';
import { useRoute, type Route } from '@/app/router';
import { AddPaymentSheet } from '@/features/entry/AddPaymentSheet';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { useAppUpdate } from '@/app/pwa/useAppUpdate';
import { requestPersistence } from '@/data/persistence';
import { countUnreviewed, STAGING_TABLES } from '@/data/repositories/stagingRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { LockGate } from './LockGate';
import { UpdateBanner } from './UpdateBanner';
import { BottomNav } from './BottomNav';
import { Toasts } from './Toasts';

/* ---------------------------------------------------------------------------
 * WHAT LOADS WHEN
 * ---------------------------------------------------------------------------
 * Home and Accounts are the two screens people actually open, so they stay in
 * the first bundle and the first paint owes nothing to the network. Everything
 * else is somewhere you go on purpose — a forecast, a statement import, the
 * settings — and is fetched at that moment instead.
 *
 * In practice the fetch is a disk read: the service worker precaches every
 * chunk on install, so by the time anybody taps "Ahead" the file is already
 * there and the fallback below is never seen. It matters on the very first
 * visit, which is exactly the visit worth protecting.
 * ------------------------------------------------------------------------ */

const TriageView = lazy(() =>
  import('@/features/triage/TriageView').then((m) => ({ default: m.TriageView })),
);
const TransactionsView = lazy(() =>
  import('@/features/transactions/TransactionsView').then((m) => ({
    default: m.TransactionsView,
  })),
);
const PotsView = lazy(() =>
  import('@/features/goals/PotsView').then((m) => ({ default: m.PotsView })),
);
// One lazy chunk for all three "Ahead" panes: they share the toggle at the
// top, so arriving on any of them means the other two are one tap away.
const AheadView = lazy(() =>
  import('@/features/forecast/AheadView').then((m) => ({ default: m.AheadView })),
);
const IndependenceView = lazy(() =>
  import('@/features/simulations/IndependenceView').then((m) => ({ default: m.IndependenceView })),
);
// The balance sheet carries three sheets, the valuation builder and the
// depreciation model. Nothing above this line may import from
// `@/features/accounts/*` or `@/data/repositories/accountsRepo`.
const AccountsView = lazy(() =>
  import('@/features/accounts/AccountsView').then((m) => ({ default: m.AccountsView })),
);

// The budget grid carries the multi-month planner and the cadence engine.
// Nothing above this line may import from `@/core/budget` or
// `@/app/budget/useBudget`, or the planner lands in the first paint.
const BudgetGrid = lazy(() =>
  import('@/features/budget/BudgetGrid').then((m) => ({ default: m.BudgetGrid })),
);

// Quarantined deliberately: the analytics chunk carries the Sankey geometry,
// the ranking maths and the trailing-median engine, none of which anybody
// needs to open the app. Nothing above this line may import from
// `@/core/analytics`, `@/charts/SankeyFlow` or `@/charts/CategoryBars`.
const AnalyticsView = lazy(() =>
  import('@/features/analytics/AnalyticsView').then((m) => ({ default: m.AnalyticsView })),
);
const CategoryManagerView = lazy(() =>
  import('@/features/categories/CategoryManagerView').then((m) => ({
    default: m.CategoryManagerView,
  })),
);
const SettingsView = lazy(() =>
  import('@/features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
);
// The gallery is every primitive in the design system on one page. It is
// reached from Settings and most people will never open it, so it carries its
// own chunk rather than riding along with the settings screen.
const Gallery = lazy(() =>
  import('@/features/gallery/Gallery').then((m) => ({ default: m.Gallery })),
);

type Startup =
  | { state: 'opening' }
  | { state: 'ready'; storage: StorageStatus }
  | { state: 'failed'; message: string };

export function AppShell() {
  const [startup, setStartup] = useState<Startup>({ state: 'opening' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storage = await openDatabase();
        const { created } = await ensureStarterChart();
        // Somebody arriving for the first time has not invested anything yet;
        // asking then is the request browsers are most likely to refuse. After
        // a real write it is a different conversation.
        if (!created) void requestPersistence();
        if (!cancelled) setStartup({ state: 'ready', storage });
      } catch (error) {
        if (cancelled) return;
        setStartup({
          state: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Sovereign could not open your data on this device.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (startup.state === 'opening') return <Opening />;
  if (startup.state === 'failed') return <Failed message={startup.message} />;

  return (
    <LockGate>
      <Shell storage={startup.storage} />
    </LockGate>
  );
}

function Shell({ storage }: { storage: StorageStatus }) {
  const [route, navigate] = useRoute();
  const [adding, setAdding] = useState(false);
  const update = useAppUpdate();
  const unreviewed = useLiveQuery(useCallback(() => countUnreviewed(), []), STAGING_TABLES);

  return (
    <div className="min-h-dvh bg-base">
      {!storage.durable && <StorageWarning explanation={storage.explanation} />}

      <main
        className="mx-auto w-full max-w-[42rem] px-4 pb-[calc(5.5rem+var(--safe-bottom))] pt-[calc(1rem+var(--safe-top))]"
        // Re-mounting on route change resets scroll and any local view state,
        // which is what a person expects when they switch tabs.
        key={route}
      >
        <Suspense fallback={<ViewLoading />}>
          <View route={route} onAdd={() => setAdding(true)} unreviewed={unreviewed.data ?? 0} />
        </Suspense>
      </main>

      <BottomNav route={route} onNavigate={navigate} onAdd={() => setAdding(true)} />
      <AddPaymentSheet open={adding} onClose={() => setAdding(false)} />
      <UpdateBanner update={update} />
      <Toasts />
    </div>
  );
}

function View({
  route,
  onAdd,
  unreviewed,
}: {
  route: Route;
  onAdd: () => void;
  unreviewed: number;
}) {
  switch (route) {
    case 'home':
      return <Dashboard onAdd={onAdd} unreviewed={unreviewed} />;
    case 'triage':
      return <TriageView />;
    case 'transactions':
      return <TransactionsView />;
    case 'accounts':
      return <AccountsView />;
    case 'pots':
      return <PotsView />;
    case 'forecast':
    case 'calendar':
    case 'debt':
      return <AheadView />;
    case 'independence':
      return <IndependenceView />;
    case 'budget':
      return <BudgetGrid />;
    case 'analytics':
      return <AnalyticsView />;
    case 'categories':
      return <CategoryManagerView />;
    case 'settings':
      return <SettingsView />;
    case 'gallery':
      return <Gallery />;
  }
}

/**
 * The gap while a split view arrives.
 *
 * Deliberately almost nothing: it holds the height so the bottom bar does not
 * jump, and says nothing at all, because a spinner that flashes for forty
 * milliseconds reads as a fault rather than as progress.
 */
function ViewLoading() {
  return <div className="min-h-[60dvh]" aria-hidden="true" />;
}

function Opening() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-base px-6 text-center">
      <div
        className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-liquid"
        aria-hidden="true"
      />
      <p className="text-body text-ink-2">Getting your money ready…</p>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-base px-6 text-center">
      <h1 className="text-lead font-medium text-ink">Sovereign could not open your data</h1>
      <p className="max-w-[38ch] text-body text-ink-2">{message}</p>
      <p className="max-w-[38ch] text-caption text-ink-3">
        Nothing has been lost. Reloading the page usually sorts this out — and if you have
        Sovereign open in another tab, close that one first.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="h-11 rounded-md bg-liquid px-5 font-medium text-base"
      >
        Reload and try again
      </button>
    </div>
  );
}

function StorageWarning({ explanation }: { explanation: string }) {
  return (
    <div
      className={clsx(
        'border-b border-caution-dim/50 bg-caution-wash px-4 py-3',
        'pt-[calc(0.75rem+var(--safe-top))]',
      )}
      role="status"
    >
      <p className="mx-auto max-w-[42rem] text-caption text-caution">{explanation}</p>
    </div>
  );
}
