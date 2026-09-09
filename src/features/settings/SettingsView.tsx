/* ===========================================================================
 * SETTINGS
 * ---------------------------------------------------------------------------
 * It was nine cards in a column, each holding one control and a paragraph
 * explaining it. Nine identical boxes is the wallpaper problem in its purest
 * form: nothing on the screen said which of them mattered, and the paragraphs
 * meant a person had to read the screen to scan it.
 *
 * Sections and rows now. A section title says what a group is for; a row is a
 * thing you can change, with its family's square beside it and its current
 * value on the right. What used to be a paragraph under a control is either a
 * value the row already shows, or an `<Explain>` — because "what does this
 * actually do to my money" is the same question everywhere else in the app and
 * gets the same answer shape.
 *
 * ---------------------------------------------------------------------------
 * THE HOT ACCENT APPEARS ONCE, ON THE CONFIRM
 *
 * Clearing everything is the only irreversible thing in Sovereign, and it is
 * the only place in settings that gets `--color-hot`. Not on the row that
 * opens it — a destination is not a danger — and only on the button that
 * actually does it.
 * ======================================================================== */

import { Suspense, lazy, useState } from 'react';
import clsx from 'clsx';
import { COMMON_CURRENCIES, currencyDisplayName, minor } from '@/core/money';
import { getStorageStatus, resetDatabase } from '@/data/client';
import { ensureStarterChart } from '@/data/seed';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { useTheme, type ThemeChoice } from '@/app/theme';
import { toast } from '@/app/toast';
import { Button, Card, Explain, Input, Row, Select } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';
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

/** A group of rows, with a heading that says what the group is for. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title text-ink">{title}</h2>
        {action}
      </div>
      <Card padding="none">
        <div className="flex flex-col divide-y divide-line-faint px-1">{children}</div>
      </Card>
    </section>
  );
}

/** The chevron that says a row opens something. */
function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-ink-3">
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const explain = useExplain({ cgtRateBp, cgtExemption: minor(cgtExemptionMinor) });

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
      <header>
        <h1 className="headline text-ink">Settings</h1>
      </header>

      {/* --- money ------------------------------------------------------- */}
      <Section
        title="Money"
        action={
          <Explain topic="tax-regime" label="where you are taxed" onOpen={explain.open} />
        }
      >
        <Row
          family="housing"
          name="Currency"
          meta="What amounts are written in"
          trailing={
            <Select
              aria-label="Currency"
              value={currencyCode}
              onChange={(e) => {
                setCurrency(e.target.value);
                toast(`Amounts are now shown in ${currencyDisplayName(e.target.value, locale)}.`);
              }}
              options={COMMON_CURRENCIES.map((code) => ({
                value: code,
                label: code,
              }))}
              containerClassName="w-[5.5rem]"
            />
          }
        />

        <Row
          family="health"
          name="Exchange rates"
          meta={`Anything not in ${currencyCode}, at rates you give it`}
          trailing={<Chevron />}
          onClick={() => setEditingRates(true)}
        />

        <Row
          family="transport"
          name="Tax"
          meta="What the tax figures mean"
          trailing={
            <Select
              aria-label="Where you are taxed"
              value={taxRegime}
              onChange={(e) => setTaxRegime(e.target.value as typeof taxRegime)}
              options={[
                { value: 'none', label: 'None' },
                { value: 'dutch_box3', label: 'Yearly charge' },
                { value: 'flat_gains', label: 'On the gain' },
              ]}
              containerClassName="w-[8rem]"
            />
          }
        />
      </Section>

      {taxRegime === 'flat_gains' && (
        <Section
          title="Your rate and allowance"
          action={<Explain topic="cgt" label="your rate and allowance" onOpen={explain.open} />}
        >
          <div className="grid grid-cols-2 gap-2 px-3 py-3">
            <Input
              label="Rate"
              type="text"
              inputMode="decimal"
              defaultValue={(cgtRateBp / 100).toString()}
              onBlur={(e) => {
                const rate = Number(e.target.value.replace(',', '.'));
                if (Number.isFinite(rate)) setCgt(Math.round(rate * 100), cgtExemptionMinor);
              }}
              className="tnum"
            />
            <Input
              label="Yearly allowance"
              type="text"
              inputMode="decimal"
              defaultValue={(cgtExemptionMinor / 100).toString()}
              onBlur={(e) => {
                const amount = Number(e.target.value.replace(',', '.'));
                if (Number.isFinite(amount)) setCgt(cgtRateBp, Math.round(amount * 100));
              }}
              className="tnum"
            />
          </div>
          <p className="px-3 pb-3 text-caption text-ink-3">
            Rates change yearly and Sovereign never goes online to check.
          </p>
        </Section>
      )}

      {/* --- appearance --------------------------------------------------- */}
      <Appearance />

      {/* --- your data ---------------------------------------------------- */}
      <Section
        title="Your data"
        action={<Explain topic="storage" label="where your data lives" onOpen={explain.open} />}
      >
        <Row
          family="leisure"
          name="Where it is kept"
          meta={storage?.persisted ? 'Kept on this device' : 'On this device, not guaranteed'}
        />
        <Row
          family="food"
          name="Categories and rules"
          meta="How your spending is divided up"
          trailing={<Chevron />}
          onClick={() => navigate('categories')}
        />
      </Section>

      <ProtectStorage context="settings" />

      <DataAndSecurity />

      {/* --- how it works ------------------------------------------------- */}
      <Section title="How it works">
        <Row
          family="housing"
          name="The field manual"
          meta="Six chapters, each running the real engine"
          trailing={<Chevron />}
          onClick={() => navigate('manual')}
        />
        <Row
          family="health"
          name="Walk me through it again"
          meta="The first-launch questions. Nothing is replaced"
          trailing={<Chevron />}
          onClick={() => setWalkthrough(true)}
        />
        {/*
          * The gallery is a development surface, not a destination. `#/gallery`
          * still resolves so a bookmark keeps working, but nothing offers it
          * in a build somebody actually uses.
          */}
        {import.meta.env.DEV && (
          <Row
            family="transport"
            name="Design system gallery"
            meta="Development only"
            trailing={<Chevron />}
            onClick={() => navigate('gallery')}
          />
        )}
      </Section>

      {walkthrough && (
        <Suspense fallback={null}>
          <FirstFlightWizard onFinished={() => setWalkthrough(false)} />
        </Suspense>
      )}

      {/* --- the one irreversible thing ----------------------------------- */}
      <section className="flex flex-col gap-2">
        <h2 className="section-title text-ink">Start again</h2>
        <Card accent="caution">
          {confirmingReset ? (
            <div className="flex flex-col gap-3">
              <p className="text-caption text-ink">
                This deletes everything on this device and cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" block onClick={() => setConfirmingReset(false)}>
                  Keep my data
                </Button>
                {/*
                  * The only hot accent in settings, on the only step that
                  * cannot be walked back. Not on the row that opens this —
                  * a destination is not a danger.
                  */}
                <Button
                  variant="primary"
                  block
                  disabled={working}
                  className="bg-hot text-base hover:bg-hot"
                  onClick={() => void startAgain()}
                >
                  {working ? 'Clearing…' : 'Yes, delete it all'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-ink-2">Back to a blank slate.</p>
              <Button variant="secondary" size="sm" onClick={() => setConfirmingReset(true)}>
                Clear everything
              </Button>
            </div>
          )}
        </Card>
      </section>

      <FxRatesSheet open={editingRates} onClose={() => setEditingRates(false)} />
      {explain.sheet}
    </div>
  );
}

/* ===========================================================================
 * APPEARANCE
 * ---------------------------------------------------------------------------
 * Three states, each showing what it looks like rather than describing it.
 *
 * The previous note here argued a swatch was pointless because the app itself
 * is the preview. That holds for the two fixed choices and not for the third:
 * "match my phone" cannot be previewed by the screen, because the screen is
 * already showing whichever one the phone resolved to. The swatch is what
 * makes the difference between "Daylight" and "following your phone, which is
 * currently Daylight" visible before you commit to it.
 * ======================================================================== */

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'My phone' },
  { value: 'daylight', label: 'Daylight' },
  { value: 'midnight', label: 'Midnight' },
];

/** The two grounds, drawn literally so a choice shows itself. */
function Swatch({ theme, resolved }: { theme: ThemeChoice; resolved: 'daylight' | 'midnight' }) {
  const shown = theme === 'system' ? resolved : theme;
  const light = shown === 'daylight';
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'block h-7 w-full overflow-hidden rounded-md border',
        light ? 'border-line-strong' : 'border-transparent',
      )}
      style={{ background: light ? '#edf0ea' : '#0b0f22' }}
    >
      {/* A line of "ink" and a hint of the accent, so the swatch shows the
          pairing rather than just the ground. */}
      <span className="flex h-full items-center gap-1 px-1.5">
        <span
          className="h-1 flex-1 rounded-pill"
          style={{ background: light ? '#10130f' : '#eef1ff' }}
        />
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: light ? '#0c5a47' : '#4fd1a5' }}
        />
      </span>
    </span>
  );
}

function Appearance() {
  const choice = useTheme((s) => s.choice);
  const resolved = useTheme((s) => s.resolved);
  const setChoice = useTheme((s) => s.setChoice);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="section-title text-ink">How it looks</h2>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Appearance">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                onClick={() => setChoice(theme.value)}
                aria-pressed={choice === theme.value}
                className={clsx(
                  'press flex flex-col gap-1.5 rounded-lg border p-1.5 transition-colors',
                  choice === theme.value
                    ? 'border-liquid bg-liquid-wash'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <Swatch theme={theme.value} resolved={resolved} />
                <span
                  className={clsx(
                    'text-caption',
                    choice === theme.value ? 'text-liquid' : 'text-ink-2',
                  )}
                >
                  {theme.label}
                </span>
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-3">
            {choice === 'system'
              ? `Following your phone, which is ${resolved} now.`
              : 'Staying this way whatever your phone does.'}
          </p>
        </div>
      </Card>
    </section>
  );
}
