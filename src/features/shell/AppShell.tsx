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
import { isAheadRoute, useRoute, type Route } from '@/app/router';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { useAppUpdate } from '@/app/pwa/useAppUpdate';
import { requestPersistence } from '@/data/persistence';
import { countUnreviewed, STAGING_TABLES } from '@/data/repositories/stagingRepo';
import { onboardingCompletedAt } from '@/data/repositories/onboardingRepo';
import { countEntries } from '@/data/repositories/ledgerRepo';
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

// Loaded when the + button is pressed, not before. It is the biggest sheet in
// the app — three entry kinds, a split editor and a category picker — and none
// of it is needed to show somebody what is safe to spend.
const AddPaymentSheet = lazy(() =>
  import('@/features/entry/AddPaymentSheet').then((m) => ({ default: m.AddPaymentSheet })),
);

// Shown to a database that has never finished it, which is once per household
// and never again. It carries the account, bill and pot forms, so it stays out
// of the first paint of every launch after that one.
const FirstFlightWizard = lazy(() =>
  import('@/features/onboarding/FirstFlightWizard').then((m) => ({
    default: m.FirstFlightWizard,
  })),
);

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
// The investments screen carries the holdings register, the allocation
// arithmetic and the fee-drag projection. Nothing above this line may import
// from `@/features/investments/*`, `@/core/investments` or
// `@/data/repositories/investmentsRepo`.
const InvestmentsView = lazy(() =>
  import('@/features/investments/InvestmentsView').then((m) => ({
    default: m.InvestmentsView,
  })),
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

// The analytics pane is not routed from here. It is one of the five panes
// behind the Ahead toggle, so `AheadView` owns it along with the others — see
// the 'analytics' case below. It stays quarantined either way: nothing above
// this line may import from `@/core/analytics`, `@/charts/SankeyFlow` or
// `@/charts/CategoryBars`, which carry the Sankey geometry, the ranking maths
// and the trailing-median engine that nobody needs to open the app.
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

// The field manual carries six working models of the app's own engines — the
// ledger builders, the disposal relief, the reconciliation maths — and is
// reached on purpose, from a question. Nothing above this line may import from
// `@/features/manual/*`.
const ManualView = lazy(() =>
  import('@/features/manual/ManualView').then((m) => ({ default: m.ManualView })),
);

type Startup =
  | { state: 'opening' }
  | { state: 'ready'; storage: StorageStatus; firstFlight: boolean }
  | { state: 'failed'; message: string };

/**
 * Did the person arrive here meaning to record something?
 *
 * The home-screen shortcut in the web manifest says "Record a payment" and
 * opens `/?action=add`. It has said that since the manifest was written and
 * nothing read it, so the shortcut opened the dashboard and the person was
 * left to find the record button themselves.
 *
 * The query is stripped on the way past. Without that a refresh reopens the
 * sheet, which is the same shortcut firing again from a URL the person never
 * chose the second time.
 */
function wantsToRecord(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') !== 'add') return false;
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return true;
}

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
        // Two cheap reads, on the launch path only, and both have to agree
        // before anybody is walked through setting up their money.
        //
        // The stored flag is the direct answer, and it travels in `meta` with
        // an export, so a restore does not ask again. The entry count is the
        // backstop for the databases that predate the flag: a ledger with
        // records in it has plainly been set up, whatever `meta` says, and
        // being offered "where is your money?" on top of four months of
        // history would read as though the restore had failed.
        const [finishedBefore, entries] = await Promise.all([
          onboardingCompletedAt(),
          countEntries().catch(() => 1),
        ]);
        if (!cancelled) {
          setStartup({
            state: 'ready',
            storage,
            firstFlight: finishedBefore === null && entries === 0,
          });
        }
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
      <Shell storage={startup.storage} firstFlight={startup.firstFlight} />
    </LockGate>
  );
}

function Shell({ storage, firstFlight }: { storage: StorageStatus; firstFlight: boolean }) {
  const [route, navigate] = useRoute();
  // Behind the lock, not in front of it: the wizard writes to the ledger, and
  // nothing writes to the ledger before somebody has proved they own it.
  const [onboarding, setOnboarding] = useState(firstFlight);
  const [adding, setAdding] = useState(wantsToRecord);
  const update = useAppUpdate();
  const unreviewed = useLiveQuery(useCallback(() => countUnreviewed(), []), STAGING_TABLES);

  return (
    /* -----------------------------------------------------------------------
     * THE SHELL
     * -----------------------------------------------------------------------
     * The document does not scroll. `html` and `body` are fixed at exactly one
     * viewport (see tokens.css), and this fills it. Scrolling belongs to the
     * `<main>` below and to nothing else, which is what stops the whole page
     * rubber-banding away from under the dock and showing the browser's own
     * background behind it.
     *
     * The id is not decoration. `BottomSheet` finds this element to recede it
     * when a sheet is presented, the way an iOS view controller does — and
     * that recede is why tokens.css pins this element to the viewport with
     * `inset: 0` rather than letting it take a height from here. A `h-dvh`
     * shell put the dock 59px up the screen on iOS. The comment on
     * `#app-shell` in tokens.css has the whole story.
     * -------------------------------------------------------------------- */
    <div id="app-shell" className="flex flex-col overflow-hidden bg-base">
      {!storage.durable && <StorageWarning explanation={storage.explanation} />}

      <main
        className="scroll-y mx-auto w-full max-w-[42rem] flex-1 px-4 pb-[calc(6rem+var(--safe-bottom))] pt-[var(--safe-top)]"
        // Re-mounting on route change resets scroll and any local view state,
        // which is what a person expects when they switch tabs.
        key={route}
      >
        <Suspense fallback={<ViewLoading />}>
          <View route={route} onAdd={() => setAdding(true)} unreviewed={unreviewed.data ?? 0} />
        </Suspense>
      </main>

      <BottomNav route={route} onNavigate={navigate} onAdd={() => setAdding(true)} />
      {adding && (
        <Suspense fallback={null}>
          <AddPaymentSheet open={adding} onClose={() => setAdding(false)} />
        </Suspense>
      )}
      <UpdateBanner update={update} />
      <Toasts />
      {onboarding && (
        <Suspense fallback={null}>
          <FirstFlightWizard onFinished={() => setOnboarding(false)} />
        </Suspense>
      )}
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
  // Five panes, one toggle, one component — and one list saying which five,
  // so the shell, the dock and the view cannot disagree about it. See
  // AHEAD_ROUTES in the router for what went wrong when they did.
  if (isAheadRoute(route)) return <AheadView />;

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
    case 'independence':
      return <IndependenceView />;
    case 'investments':
      return <InvestmentsView />;
    case 'budget':
      return <BudgetGrid />;
    case 'categories':
      return <CategoryManagerView />;
    case 'settings':
      return <SettingsView />;
    case 'gallery':
      return <Gallery />;
    case 'manual':
      return <ManualView />;
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
  // A height, not the screen's height. A spacer that lives for forty
  // milliseconds has no reason to know how tall the web view is.
  return <div className="min-h-[22rem]" aria-hidden="true" />;
}

function Opening() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-base px-6 text-center">
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
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-base px-6 text-center">
      <h1 className="text-lead font-medium text-ink">Sovereign could not open your data</h1>
      <p className="max-w-[38ch] text-body text-ink-2">{message}</p>
      <p className="max-w-[38ch] text-caption text-ink-3">
        Nothing has been lost. Reloading the page usually sorts this out. If you have
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
