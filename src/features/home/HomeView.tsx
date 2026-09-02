/* The first thing you see. Slice 1 shows what you have and what you have
 * recorded; the full five-second dashboard arrives with the liquidity engine. */

import { minor } from '@/core/money';
import { ACCOUNT_IDS } from '@/data/seed';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useBalances, useRecentEntries, useSpendableCash } from '@/app/ledger/useLedger';
import { Button, Card, Money, StatPill } from '@/design/ui';

export function HomeView({ onAdd }: { onAdd: () => void }) {
  const locale = useAppConfig((s) => s.locale);
  const cash = useSpendableCash();
  const balances = useBalances();
  const entries = useRecentEntries(12);

  const cardOwed = balances.data?.get(ACCOUNT_IDS.card)?.presented ?? minor(0);
  const setAside = balances.data?.get(ACCOUNT_IDS.potCardBill)?.presented ?? minor(0);
  const recent = entries.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Your money</h1>
        <p className="text-caption text-ink-2">
          Everything you record here stays on this device.
        </p>
      </header>

      <Card label="In your everyday accounts" accent="liquid">
        {cash.loading ? (
          <div className="h-11 w-40 animate-pulse rounded-sm bg-raised" />
        ) : (
          <Money value={cash.data ?? minor(0)} size="anchor" tone="liquid" />
        )}
        <p className="pt-2 text-caption text-ink-2">
          This is what is actually in your everyday account and savings right now.
        </p>
      </Card>

      {cardOwed !== 0 && (
        <div className="grid grid-cols-2 gap-2">
          <StatPill
            label="On your card"
            value={<Money value={cardOwed} size="lead" />}
            detail="What you owe at the moment"
          />
          <StatPill
            label="Already set aside"
            value={<Money value={setAside} size="lead" tone="liquid" />}
            detail={
              setAside === cardOwed
                ? 'Enough to cover the whole bill'
                : 'Towards your next card bill'
            }
            tone={setAside === cardOwed ? 'liquid' : 'caution'}
          />
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">
          What you have recorded
        </h2>

        {entries.loading ? (
          <Card padding="none">
            <div className="divide-y divide-line-faint">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse bg-raised/40" />
              ))}
            </div>
          </Card>
        ) : recent.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-lead text-ink">Nothing recorded yet</p>
              <p className="max-w-[34ch] text-caption text-ink-2">
                Add the first thing you spent and it will show up here straight away. It is saved
                on this device, so it will still be here next time you open Sovereign.
              </p>
              <Button variant="primary" onClick={onAdd}>
                Add your first payment
              </Button>
            </div>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-line-faint">
              {recent.map((entry) => {
                const spent = entry.postings.find(
                  (p) => p.book === 'FINANCIAL' && p.amount > 0 && p.accountId.startsWith('cat-'),
                );
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body text-ink">{entry.description}</p>
                      <p className="truncate pt-0.5 text-caption text-ink-3">
                        {describeDate(entry.date, locale)}
                      </p>
                    </div>
                    {spent && <Money value={spent.amount} size="lead" tone="neutral" />}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
