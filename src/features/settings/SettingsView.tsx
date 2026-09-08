/* Settings: currency, where your data lives, and a way back to the design
 * system gallery so the primitives stay reviewable. */

import { Suspense, lazy, useState } from 'react';
import clsx from 'clsx';
import { COMMON_CURRENCIES, currencyDisplayName } from '@/core/money';
import { getStorageStatus, resetDatabase } from '@/data/client';
import { ensureStarterChart } from '@/data/seed';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { useTheme, type ThemeChoice } from '@/app/theme';
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
  const taxRegime = useAppConfig((s) => s.taxRegime);
  const setTaxRegime = useAppConfig((s) => s.setTaxRegime);
  const cgtRateBp = useAppConfig((s) => s.cgtRateBp);
  const cgtExemptionMinor = useAppConfig((s) => s.cgtExemptionMinor);
  const setCgt = useAppConfig((s) => s.setCgt);
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
        'Everything has been cleared. You are starting fresh. There is a walkthrough further ' +
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
            the same amount. Only the way it is written changes.
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

      <Appearance />

      <ProtectStorage context="settings" />

      <DataAndSecurity />

      <Card label="Exchange rates and currencies">
        <div className="flex flex-col gap-3">
          <p className="text-caption text-ink-2">
            Everything is reported in {currencyCode}. Anything you hold in another currency is
            shown in its own currency first, with an estimate in {currencyCode} underneath,
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

      <Card label="Tax">
        <div className="flex flex-col gap-3">
          <p className="text-caption text-ink-2">
            Sovereign can show what part of your investments would go in tax, next to the figure
            that ignores it. It does not guess where you live, it is an estimate of one thing, and
            it knows nothing about your circumstances.
          </p>
          <label className="flex flex-col gap-2">
            <span className="text-caption text-ink-2">
              Where you are taxed
            </span>
            <select
              value={taxRegime}
              onChange={(e) => setTaxRegime(e.target.value as 'none' | 'dutch_box3' | 'flat_gains')}
              className="w-full rounded-md border border-line-strong bg-raised px-3 py-2.5 text-body text-ink"
            >
              <option value="none">Do not show it</option>
              <option value="dutch_box3">Netherlands: Box 3, charged every year</option>
              <option value="flat_gains">One flat rate on gains, when you sell</option>
            </select>
          </label>

          {taxRegime === 'flat_gains' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption text-ink-3">Rate</span>
                <input
                  type="text"
                  inputMode="decimal"
                  defaultValue={(cgtRateBp / 100).toString()}
                  onBlur={(e) => {
                    const rate = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(rate)) setCgt(Math.round(rate * 100), cgtExemptionMinor);
                  }}
                  className="tnum w-full rounded-md border border-line bg-raised px-3 py-2.5 text-body text-ink"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption text-ink-3">
                  Yearly allowance
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  defaultValue={(cgtExemptionMinor / 100).toString()}
                  onBlur={(e) => {
                    const amount = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(amount)) setCgt(cgtRateBp, Math.round(amount * 100));
                  }}
                  className="tnum w-full rounded-md border border-line bg-raised px-3 py-2.5 text-body text-ink"
                />
              </label>
            </div>
          )}

          {taxRegime !== 'none' && (
            <p className="text-caption text-ink-3">
              Rates change every year and Sovereign never goes online to check. The figure names
              the year it was worked out on. Keep it up to date yourself.
            </p>
          )}
        </div>
      </Card>

      <Card label="The field manual">
        <p className="text-caption text-ink-2">
          How Sovereign works out what it tells you, in six chapters. Each one comes with a
          working model of the thing it describes, running on made-up figures.
        </p>
        <div className="pt-3">
          <Button variant="secondary" onClick={() => navigate('manual')}>
            Open the manual
          </Button>
        </div>
      </Card>

      <Card label="Setting up">
        <p className="text-caption text-ink-2">
          The questions Sovereign asked on your first launch: where your money is, what you owe,
          what arrives every month and what you are putting by. Nothing is replaced. Anything
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

/* ===========================================================================
 * APPEARANCE
 * ---------------------------------------------------------------------------
 * Three buttons and no preview swatch. The preview is the screen it is sitting
 * on, which changes under the finger the moment the choice is made — a small
 * square claiming to show what light looks like, next to an app that is
 * already showing it, is a control explaining itself to nobody.
 * ======================================================================== */

/* The two themes have names now, so the control uses them. Phase 6 gives this
   the live swatches and the shared row pattern; this keeps it working. */
const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Match my phone' },
  { value: 'daylight', label: 'Daylight' },
  { value: 'midnight', label: 'Midnight' },
];

function Appearance() {
  const choice = useTheme((s) => s.choice);
  const resolved = useTheme((s) => s.resolved);
  const setChoice = useTheme((s) => s.setChoice);

  return (
    <Card label="Appearance">
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-2">
          {choice === 'system'
            ? `Following your phone, which is set to ${resolved} at the moment.`
            : 'Staying this way whatever your phone is set to.'}
        </p>
        <div className="flex gap-1.5" role="group" aria-label="Appearance">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              onClick={() => setChoice(theme.value)}
              aria-pressed={choice === theme.value}
              className={clsx(
                'press rounded-md border px-3 py-2 text-caption transition-colors',
                choice === theme.value
                  ? 'border-liquid-dim bg-liquid-wash text-liquid'
                  : 'border-line bg-raised text-ink-2',
              )}
            >
              {theme.label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
