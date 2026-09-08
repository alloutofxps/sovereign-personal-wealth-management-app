/* ===========================================================================
 * THE HOME DASHBOARD
 * ---------------------------------------------------------------------------
 * Four tiers, in the order someone reads them:
 *
 *   1  What is safe to spend, and what that is per day.
 *   2  How fast the money is going, and the curve behind it.
 *   3  What you are worth, and whether the card bill is covered.
 *   4  Anything waiting for a decision.
 *
 * Every figure comes from one live query over the ledger, so recording a
 * payment moves all four at once.
 * ======================================================================== */

import { Suspense, lazy, useState } from 'react';
import { useDashboard } from '@/app/dashboard/useDashboard';
import { useRecentEntries } from '@/app/ledger/useLedger';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { Button, Card, Money } from '@/design/ui';
// Loaded when somebody taps a payment, not before. It is a sheet that only
// appears on demand, and it brings the whole audit view and the statement-check
// wording with it — none of which belongs in front of a person who has opened
// the app to see one number.
// The other sheet that only exists once somebody asks for it. It carries the
// whole keypad, and the keypad now carries an arithmetic parser — none of
// which belongs in front of a person opening the app to read one number.
const AddBillSheet = lazy(() =>
  import('./AddBillSheet').then((m) => ({ default: m.AddBillSheet })),
);

const PaymentDetailsSheet = lazy(() =>
  import('@/features/entry/PaymentDetailsSheet').then((m) => ({
    default: m.PaymentDetailsSheet,
  })),
);
import { BalanceCard } from './BalanceCard';
import { GettingStarted } from './GettingStarted';
import { PaceCard } from './PaceCard';
import { SafeToSpendCard, SafeToSpendSkeleton } from './SafeToSpendCard';
import { SafeToSpendSheet } from './SafeToSpendSheet';
import { TriageBar } from './TriageBar';

export function Dashboard({ onAdd, unreviewed = 0 }: { onAdd: () => void; unreviewed?: number }) {
  const [, navigate] = useRoute();
  const locale = useAppConfig((s) => s.locale);
  const dashboard = useDashboard();
  const entries = useRecentEntries(8);
  const [explaining, setExplaining] = useState(false);
  const [addingBill, setAddingBill] = useState(false);

  const data = dashboard.data;
  const recent = entries.data ?? [];
  const [looking, setLooking] = useState<(typeof recent)[number] | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Your money</h1>
        <p className="text-caption text-ink-2">Everything you record stays on this device.</p>
      </header>

      {dashboard.error && (
        <Card accent="caution">
          <p className="text-body text-ink">Sovereign could not work out your figures.</p>
          <p className="pt-1 text-caption text-ink-2">{dashboard.error}</p>
          <div className="pt-3">
            <Button variant="secondary" onClick={dashboard.refresh}>
              Try again
            </Button>
          </div>
        </Card>
      )}

      {!data && <SafeToSpendSkeleton />}

      {data && !data.hasActivity && (
        <GettingStarted
          onAdd={onAdd}
          onAddBill={() => setAddingBill(true)}
          hasSchedule={data.hasSchedule}
        />
      )}

      {data?.hasActivity && (
        <>
          {/* 1 — the liquidity anchor */}
          <SafeToSpendCard data={data} onExplain={() => setExplaining(true)} />

          {/* 2 — pace and the curve */}
          <PaceCard data={data} />

          {/* 3 — the balance sheet */}
          <BalanceCard data={data} />

          {/* 4 — anything waiting */}
          <TriageBar
            data={data}
            unreviewed={unreviewed}
            onOpenReview={() => navigate('triage')}
            onAddBill={() => setAddingBill(true)}
            onOpenCalendar={() => navigate('calendar')}
          />
        </>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="section-title text-ink">
              What you have recorded
            </h2>
            <span className="flex gap-3">
              <button
                type="button"
                onClick={() => navigate('budget')}
                className="text-caption text-liquid"
              >
                Budget
              </button>
              <button
                type="button"
                onClick={() => navigate('analytics')}
                className="text-caption text-liquid"
              >
                Where it went
              </button>
              <button
                type="button"
                onClick={() => navigate('transactions')}
                className="text-caption text-liquid"
              >
                See everything
              </button>
            </span>
          </div>

          <Card padding="none">
            <ul className="divide-y divide-line-faint">
              {recent.map((entry) => {
                const spent = entry.postings.find(
                  (p) => p.book === 'FINANCIAL' && p.amount > 0 && p.accountId.startsWith('cat-'),
                );
                const undone = entry.kind === 'REVERSAL';
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setLooking(entry)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors active:bg-raised"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body text-ink">{entry.description}</p>
                        <p className="truncate pt-0.5 text-caption text-ink-3">
                          {describeDate(entry.date, locale)}
                          {undone ? ' · a correction' : ''}
                        </p>
                      </div>
                      {spent && <Money value={spent.amount} size="lead" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      <SafeToSpendSheet open={explaining} onClose={() => setExplaining(false)} data={data} />
      {addingBill && (
        <Suspense fallback={null}>
          <AddBillSheet open={addingBill} onClose={() => setAddingBill(false)} />
        </Suspense>
      )}
      {looking && (
        <Suspense fallback={null}>
          <PaymentDetailsSheet entry={looking} onClose={() => setLooking(null)} />
        </Suspense>
      )}
    </div>
  );
}
