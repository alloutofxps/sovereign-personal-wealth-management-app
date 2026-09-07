/* Settings: currency, where your data lives, and a way back to the design
 * system gallery so the primitives stay reviewable. */

import { Suspense, lazy, useState } from 'react';
import { COMMON_CURRENCIES, currencyDisplayName } from '@/core/money';
import { getStorageStatus, resetDatabase } from '@/data/client';
import { ensureStarterChart } from '@/data/seed';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { toast } from '@/app/toast';
import { Button, Card } from '@/design/ui';
import { ProtectStorage } from '@/features/storage/ProtectStorage';
import { DataAndSecurity } from './DataAndSecurity';
import { FxRatesSheet } from './FxRatesSheet';

// The same wizard the first launch shows. Lazy here as well as in the shell,
// so the two share one chunk instead of the settings screen carrying a copy.
const FirstFlightWizard = lazy(() =>
  import('@/features/onboarding/FirstFlightWizard').then((m) => ({
    default: m.FirstFlightWizard,
  })),
);

export function SettingsView() {
  const [, navigate] = useRoute();
  const currencyCode = useAppConfig((s) => s.currencyCode);
  const locale = useAppConfig((s) => s.locale);
  const setCurrency = useAppConfig((s) => s.setCurrency);
  const storage = getStorageStatus();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [editingRates, setEditingRates] = useState(false);
  const [working, setWorking] = useState(false);
  const [walkthrough, setWalkthrough] = useState(false);

  async function startAgain() {
    setWorking(true);
    try {
      await resetDatabase();
      await ensureStarterChart();
      setConfirmingReset(false);
      toast(
        'Everything has been cleared. You are starting fresh — there is a walkthrough further ' +
          'down this page if you would like one.',
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? `That did not work: ${error.message}`
          : 'That did not work. Your data has been left as it was.',
        { tone: 'attention' },
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Settings</h1>
      </header>

      <Card label="Currency">
        <label className="flex flex-col gap-2">
          <span className="text-caption text-ink-2">
            Sovereign works in one currency at a time. Everything you have already recorded stays
            the same amount — only the way it is written changes.
          </span>
          <select
            value={currencyCode}
            onChange={(e) => {
              setCurrency(e.target.value);
              toast(`Amounts are now shown in ${currencyDisplayName(e.target.value, locale)}.`);
            }}
            className="w-full rounded-md border border-line-strong bg-raised px-3 py-2.5 text-body text-ink"
          >
            {COMMON_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code} · {currencyDisplayName(code, locale)}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <ProtectStorage context="settings" />

      <DataAndSecurity />

      <Card label="Exchange rates and currencies">
        <div className="flex flex-col gap-3">
          <p className="text-caption text-ink-2">
            Everything is reported in {currencyCode}. Anything you hold in another currency is
            shown in its own currency first, with an estimate in {currencyCode} underneath —
            worked out from rates you give it, because nothing here goes online.
          </p>
          <div>
            <Button variant="secondary" size="sm" onClick={() => setEditingRates(true)}>
              Exchange rates
            </Button>
          </div>
        </div>
      </Card>

      <FxRatesSheet open={editingRates} onClose={() => setEditingRates(false)} />

      <Card label="Where your data lives">
        <p className="text-caption text-ink-2">
          {storage?.explanation ?? 'Checking where your data is being kept…'}
        </p>
        {storage && (
          <p className="pt-2 text-caption text-ink-3">
            {storage.persisted
              ? 'Your browser has agreed to keep it, even when space runs low.'
              : 'Your browser has not promised to keep this if it runs short of space. Adding Sovereign to your home screen makes that much more likely.'}
          </p>
        )}
      </Card>

      <Card label="Categories and rules">
        <p className="text-caption text-ink-2">
          How your spending is divided up, and anything you have asked Sovereign to file for
          you without being asked twice.
        </p>
        <div className="pt-3">
          <Button variant="secondary" onClick={() => navigate('categories')}>
            Manage categories
          </Button>
        </div>
      </Card>

      <Card label="Setting up">
        <p className="text-caption text-ink-2">
          The questions Sovereign asked on your first launch: where your money is, what you owe,
          what arrives every month and what you are putting by. Nothing is replaced — anything
          you add here is added alongside what you already have.
        </p>
        <div className="pt-3">
          <Button variant="secondary" onClick={() => setWalkthrough(true)}>
            Walk me through it again
          </Button>
        </div>
      </Card>

      {walkthrough && (
        <Suspense fallback={null}>
          <FirstFlightWizard onFinished={() => setWalkthrough(false)} />
        </Suspense>
      )}

      <Card label="Design system">
        <p className="text-caption text-ink-2">
          Every button, sheet and figure in Sovereign, on one page.
        </p>
        <div className="pt-3">
          <Button variant="secondary" onClick={() => navigate('gallery')}>
            Open the gallery
          </Button>
        </div>
      </Card>

      <Card label="Start again" accent="caution">
        {confirmingReset ? (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-ink">
              This will delete everything you have recorded on this device and cannot be undone.
              Are you sure?
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" block onClick={() => setConfirmingReset(false)}>
                Keep my data
              </Button>
              <Button variant="primary" block disabled={working} onClick={() => void startAgain()}>
                {working ? 'Clearing…' : 'Yes, delete it all'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-caption text-ink-2">
              Clear everything you have recorded and go back to a blank slate.
            </p>
            <div>
              <Button variant="secondary" onClick={() => setConfirmingReset(true)}>
                Clear everything
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
