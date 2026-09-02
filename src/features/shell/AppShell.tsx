/* ===========================================================================
 * THE APP SHELL
 * ---------------------------------------------------------------------------
 * Bottom navigation, a quick way to record a payment, and whichever view the
 * hash says we are on. The database opens once here, and the starter accounts
 * are created on a first run.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { openDatabase } from '@/data/client';
import { ensureStarterChart } from '@/data/seed';
import type { StorageStatus } from '@/data/worker/protocol';
import { useRoute, type Route } from '@/app/router';
import { AddPaymentSheet } from '@/features/entry/AddPaymentSheet';
import { Gallery } from '@/features/gallery/Gallery';
import { HomeView } from '@/features/home/HomeView';
import { TriageView } from '@/features/triage/TriageView';
import { AccountsView } from '@/features/accounts/AccountsView';
import { SettingsView } from '@/features/settings/SettingsView';
import { BottomNav } from './BottomNav';
import { Toasts } from './Toasts';

type Startup =
  | { state: 'opening' }
  | { state: 'ready'; storage: StorageStatus }
  | { state: 'failed'; message: string };

export function AppShell() {
  const [route, navigate] = useRoute();
  const [startup, setStartup] = useState<Startup>({ state: 'opening' });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storage = await openDatabase();
        await ensureStarterChart();
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
    <div className="min-h-dvh bg-base">
      {!startup.storage.durable && <StorageWarning explanation={startup.storage.explanation} />}

      <main
        className="mx-auto w-full max-w-[42rem] px-4 pb-[calc(5.5rem+var(--safe-bottom))] pt-[calc(1rem+var(--safe-top))]"
        // Re-mounting on route change resets scroll and any local view state,
        // which is what a person expects when they switch tabs.
        key={route}
      >
        <View route={route} onAdd={() => setAdding(true)} />
      </main>

      <BottomNav route={route} onNavigate={navigate} onAdd={() => setAdding(true)} />
      <AddPaymentSheet open={adding} onClose={() => setAdding(false)} />
      <Toasts />
    </div>
  );
}

function View({ route, onAdd }: { route: Route; onAdd: () => void }) {
  switch (route) {
    case 'home':
      return <HomeView onAdd={onAdd} />;
    case 'triage':
      return <TriageView />;
    case 'accounts':
      return <AccountsView />;
    case 'settings':
      return <SettingsView />;
    case 'gallery':
      return <Gallery />;
  }
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
