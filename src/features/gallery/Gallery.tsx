/* ===========================================================================
 * DESIGN SYSTEM GALLERY
 * ---------------------------------------------------------------------------
 * Phase 2's reviewable surface. Every primitive is here in the states it will
 * actually be used in, so the design language can be judged before any feature
 * is built on top of it.
 *
 * The currency switcher at the top is the point of the whole exercise: change
 * it and every figure on the page reformats — symbol, placement, grouping,
 * separators and decimal precision — without a single component knowing which
 * currency it is rendering.
 * ======================================================================== */

import { useState } from 'react';
import {
  COMMON_CURRENCIES,
  currencyDisplayName,
  minor,
  type Minor,
} from '@/core/money';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import {
  AmountInput,
  BottomSheet,
  Button,
  Card,
  Money,
  StatPill,
  SwipeRow,
} from '@/design/ui';

const LOCALES = [
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'de-DE', label: 'Deutsch' },
  { tag: 'fr-FR', label: 'Français' },
  { tag: 'nl-NL', label: 'Nederlands' },
  { tag: 'ja-JP', label: '日本語' },
];

interface DemoTransaction {
  id: string;
  merchant: string;
  category: string;
  amount: Minor;
  when: string;
  pending?: boolean;
}

const SEED: DemoTransaction[] = [
  { id: 't1', merchant: 'Albert Heijn', category: 'Groceries', amount: minor(-4235), when: 'Today' },
  { id: 't2', merchant: 'NS Reizigers', category: 'Transport', amount: minor(-1180), when: 'Today', pending: true },
  { id: 't3', merchant: 'Salary — Eurofiber', category: 'Income', amount: minor(412_000), when: 'Yesterday' },
  { id: 't4', merchant: 'Spotify', category: 'Subscriptions', amount: minor(-1199), when: 'Yesterday' },
  { id: 't5', merchant: 'Coolblue', category: 'Refund from Electronics', amount: minor(8999), when: 'Mon' },
];

export function Gallery() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [amountOpen, setAmountOpen] = useState(false);
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [queue, setQueue] = useState(SEED);
  const [cleared, setCleared] = useState(0);

  return (
    <div className="min-h-dvh bg-base pb-24">
      <Header />

      <main className="mx-auto flex w-full max-w-[42rem] flex-col gap-10 px-4 pt-6">
        <CurrencySection />

        <Section
          title="Money"
          note="There is one way to show money, in five sizes. At the larger sizes the pence are set smaller so the part that matters reads first."
        >
          <Card>
            <div className="flex flex-col gap-5">
              <Row label="Anchor · Safe-to-Spend">
                <Money value={minor(184_270)} size="anchor" tone="liquid" />
              </Row>
              <Row label="Figure · net worth">
                <Money value={minor(4_213_688)} size="figure" />
              </Row>
              <Row label="Lead · negative">
                <Money value={minor(-6000)} size="lead" />
              </Row>
              <Row label="Body · signed delta">
                <Money value={minor(21_450)} signDisplay="always" tone="liquid" />
              </Row>
              <Row label="Caption · compact axis label">
                <Money value={minor(1_250_000_00)} size="caption" compact tone="muted" />
              </Row>
              <Row label="Adaptive decimals">
                <div className="flex items-baseline gap-3">
                  <Money value={minor(95_000)} decimals="adaptive" />
                  <Money value={minor(1_500_000_00)} decimals="adaptive" />
                </div>
              </Row>
            </div>
          </Card>
        </Section>

        <Section
          title="Stat pills"
          note="These sit along the bottom of your dashboard. Colour and a small dot show what needs attention — nothing here ever turns red at you."
        >
          <div className="grid grid-cols-2 gap-2">
            <StatPill
              label="Waiting for you"
              value="12"
              detail="The oldest has been waiting 4 days"
              tone="caution"
              dot
            />
            <StatPill
              label="Bills due soon"
              value="3"
              detail="Rent, energy and your phone bill"
              tone="neutral"
              dot
            />
            <StatPill
              label="Safe to spend each day"
              value={<Money value={minor(3140)} size="lead" tone="liquid" />}
              detail="You can spend this much a day for the next 9 days"
              tone="liquid"
            />
            <StatPill
              label="A little over"
              value={<Money value={minor(-6000)} size="lead" tone="deficit" />}
              detail="Your clothing budget is short. Tap to move money across."
              tone="deficit"
              dot
            />
          </div>
        </Section>

        <Section
          title="Cards"
          note="Cards sit on four levels of depth with an optional hairline of colour along the top. Nothing is filled with colour, so the numbers stay easy to read."
        >
          <div className="flex flex-col gap-3">
            <Card label="Safe to spend" action="Over the next 30 days" accent="liquid">
              <div className="flex items-end justify-between gap-4">
                <Money value={minor(184_270)} size="figure" tone="liquid" />
                <span className="pb-1 text-caption text-ink-2">6 days until you are paid</span>
              </div>
            </Card>
            <Card
              label="Saving up for car insurance"
              action="Needed by March"
              accent="caution"
              elevation="raised"
            >
              <div className="flex items-end justify-between gap-4">
                <Money value={minor(48_000)} size="figure" />
                <span className="pb-1 text-caption text-ink-2">
                  Put aside <Money value={minor(9600)} size="caption" tone="caution" /> a month
                </span>
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Buttons" note="The green button is only ever used for the action that actually moves or confirms your money.">
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary">Confirm</Button>
                <Button variant="secondary">Review later</Button>
                <Button variant="ghost">Skip</Button>
                <Button variant="quiet">Edit rule</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
              </div>
            </div>
          </Card>
        </Section>

        <Section
          title="Bottom sheet"
          note="Drag the bar at the top down to close a sheet. The content scrolls on its own, and the buttons stay clear of the home indicator at the bottom of the screen."
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>
              Open sheet
            </Button>
            <Button variant="primary" onClick={() => setAmountOpen(true)}>
              Open keypad
            </Button>
          </div>
        </Section>

        <Section
          title="Swipe rows · triage queue"
          note="Swipe a row right if it looks right, or left to come back to it later. You can also tab to a row and use the buttons, so you never have to swipe."
        >
          <Card padding="none">
            <div className="divide-y divide-line-faint">
              {queue.map((tx) => (
                <SwipeRow
                  key={tx.id}
                  leftAction={{
                    label: 'Looks right',
                    tone: 'liquid',
                    icon: <CheckIcon />,
                    onAction: () => {
                      setQueue((q) => q.filter((t) => t.id !== tx.id));
                      setCleared((c) => c + 1);
                    },
                  }}
                  rightAction={{
                    label: 'Come back to it',
                    tone: 'caution',
                    icon: <ClockIcon />,
                    onAction: () => setQueue((q) => q.filter((t) => t.id !== tx.id)),
                  }}
                >
                  <TransactionRow tx={tx} />
                </SwipeRow>
              ))}
              {queue.length === 0 && (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <p className="text-lead text-ink">You are all caught up</p>
                  <p className="max-w-[24rem] text-caption text-ink-2">
                    You reviewed {cleared} {cleared === 1 ? 'payment' : 'payments'}. There is
                    nothing else waiting for you right now.
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setQueue(SEED)}>
                    Put the examples back
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </Section>

        <Palette />
      </main>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Change the category"
        description="We can also remember this, so anything else from this shop goes to the same place."
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" block onClick={() => setSheetOpen(false)}>
              Save this
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-1 pb-2">
          {['Groceries', 'Household', 'Dining out', 'Transport', 'Subscriptions', 'Health'].map(
            (category, index) => (
              <button
                key={category}
                type="button"
                className="flex items-center justify-between rounded-md px-3 py-3 text-left transition-colors hover:bg-raised"
              >
                <span className="text-body text-ink">{category}</span>
                {index === 0 && <CheckIcon className="text-liquid" />}
              </button>
            ),
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={amountOpen}
        onClose={() => setAmountOpen(false)}
        title="Add a payment"
        footer={
          <Button variant="primary" block onClick={() => setAmountOpen(false)}>
            Save this payment
          </Button>
        }
      >
        <AmountInput
          value={amount}
          onChange={setAmount}
          onSubmit={() => setAmountOpen(false)}
          label="Amount"
          hint="Just tap the numbers. They fill in from the right, so there is no decimal point to get wrong."
          allowNegative
        />
      </BottomSheet>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[42rem] items-baseline justify-between gap-4 px-4 pt-[calc(0.875rem+var(--safe-top))] pb-3.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-lead font-medium tracking-[-0.01em] text-ink">Sovereign</h1>
          <span className="text-micro uppercase tracking-[0.14em] text-ink-3">Design system</span>
        </div>
        <span className="text-micro uppercase tracking-[0.14em] text-liquid">Phase 2</span>
      </div>
    </header>
  );
}

function CurrencySection() {
  const currencyCode = useAppConfig((s) => s.currencyCode);
  const locale = useAppConfig((s) => s.locale);
  const setCurrency = useAppConfig((s) => s.setCurrency);
  const setLocale = useAppConfig((s) => s.setLocale);
  const money = useMoney();

  return (
    <Section
      title="Base currency"
      note="Sovereign works in one currency at a time. Change either setting below and every amount on this page updates straight away — the symbol, the separators, and even how many decimal places are shown."
    >
      <Card accent="liquid">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Currency">
              <select
                value={currencyCode}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-md border border-line-strong bg-raised px-3 py-2.5 text-body text-ink"
              >
                {COMMON_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {currencyDisplayName(code, locale)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Locale">
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="w-full rounded-md border border-line-strong bg-raised px-3 py-2.5 text-body text-ink"
              >
                {LOCALES.map((l) => (
                  <option key={l.tag} value={l.tag}>
                    {l.label} · {l.tag}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="rounded-md border border-line bg-sunken px-3.5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <Money value={minor(123_456_789)} size="figure" />
              <Money value={minor(-4235)} size="lead" />
              <Money value={minor(0)} size="lead" tone="muted" />
            </div>
            <p className="pt-2.5 text-caption text-ink-3">
              Amounts in {money.currency} are shown to {money.exponent} decimal place
              {money.exponent === 1 ? '' : 's'}. Your device tells us that, so every currency comes
              out right without us keeping a list of our own.
            </p>
          </div>
        </div>
      </Card>
    </Section>
  );
}

function Palette() {
  const swatches: { name: string; className: string; note: string }[] = [
    { name: 'base', className: 'bg-base', note: 'app ground' },
    { name: 'surface', className: 'bg-surface', note: 'cards' },
    { name: 'raised', className: 'bg-raised', note: 'controls' },
    { name: 'overlay', className: 'bg-overlay', note: 'pressed' },
    { name: 'line', className: 'bg-line', note: 'hairlines' },
    { name: 'ink', className: 'bg-ink', note: 'primary type' },
    { name: 'ink-2', className: 'bg-ink-2', note: 'secondary' },
    { name: 'ink-3', className: 'bg-ink-3', note: 'labels' },
    { name: 'liquid', className: 'bg-liquid', note: 'money you can spend' },
    { name: 'caution', className: 'bg-caution', note: 'needs a decision from you' },
    { name: 'deficit', className: 'bg-deficit', note: 'money going out' },
  ];

  return (
    <Section
      title="Palette"
      note="There is no alarming red anywhere in Sovereign. Going a little over is just a number that needs moving, not something to be told off about."
    >
      <Card>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {swatches.map((s) => (
            <div key={s.name} className="flex items-center gap-2.5">
              <div className={`size-8 shrink-0 rounded-sm border border-line ${s.className}`} />
              <div className="min-w-0">
                <div className="truncate font-mono text-caption text-ink">{s.name}</div>
                <div className="truncate text-micro text-ink-3">{s.note}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

function TransactionRow({ tx }: { tx: DemoTransaction }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-body text-ink">{tx.merchant}</span>
          {tx.pending && (
            <span className="shrink-0 rounded-sm border border-line-strong px-1.5 py-px text-micro uppercase tracking-[0.1em] text-ink-3">
              Pending
            </span>
          )}
        </div>
        <div className="truncate pt-0.5 text-caption text-ink-3">
          {tx.category} · {tx.when}
        </div>
      </div>
      <Money value={tx.amount} size="lead" tone={tx.amount > 0 ? 'liquid' : 'neutral'} />
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">{title}</h2>
        {note && <p className="max-w-[46ch] text-caption text-ink-2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-caption text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m4 12.5 5 5L20 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
