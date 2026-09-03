/* ===========================================================================
 * ACCOUNTS
 * ---------------------------------------------------------------------------
 * The whole picture, in four parts: what you can spend, what you owe, what
 * other people owe you, and what is put by. Every figure comes from the same
 * live query as the dashboard, so the two can never disagree.
 * ======================================================================== */

import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import { potStatusLabel } from '@/core/goals';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { CLAIM_TABLES, listOpenClaims, type Claim } from '@/data/repositories/claimsRepo';
import { ACCOUNT_IDS } from '@/data/seed';
import { useDashboard } from '@/app/dashboard/useDashboard';
import { useAccounts, useBalances } from '@/app/ledger/useLedger';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { Button, Card, Money } from '@/design/ui';
import { PayCardSheet, PaybackSheet } from './SettleUpSheet';

export function AccountsView() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const dashboard = useDashboard();
  const accounts = useAccounts();
  const balances = useBalances();
  const claims = useLiveQuery(useCallback(() => listOpenClaims(), []), CLAIM_TABLES);

  const [payingCard, setPayingCard] = useState(false);
  const [settling, setSettling] = useState<Claim | null>(null);

  const data = dashboard.data;
  const all = accounts.data ?? [];
  const open = claims.data ?? [];

  const amountFor = (id: AccountId): Minor => balances.data?.get(id)?.presented ?? minor(0);

  const liquid = all.filter((a) => a.type === 'ASSET' && a.liquid && a.onBudget);
  const debts = all.filter((a) => a.type === 'LIABILITY');
  const pots = data?.pots ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Accounts</h1>
        <p className="text-caption text-ink-2">
          Everything you have, everything you owe, and everything that is put by.
        </p>
      </header>

      {/* --- the banner ---------------------------------------------------- */}
      <Card label="What you are worth" accent="liquid">
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <Money
              value={data?.netWorth ?? minor(0)}
              size="figure"
              tone={(data?.netWorth ?? 0) < 0 ? 'deficit' : 'neutral'}
            />
            {data && data.netWorthChange !== 0 && (
              <span
                className={clsx(
                  'rounded-pill px-2.5 py-1 text-micro font-medium',
                  data.netWorthChange > 0
                    ? 'bg-liquid-wash text-liquid'
                    : 'bg-raised text-ink-2',
                )}
              >
                {data.netWorthChange > 0 ? 'Up ' : 'Down '}
                {money.format(minor(Math.abs(data.netWorthChange)), { decimals: 'hide' })} this month
              </span>
            )}
          </div>
          <p className="text-caption text-ink-2">
            What you have, less what you owe. Money you have put by is still yours, so it counts.
          </p>
        </div>
      </Card>

      {/* --- 1. what you can spend ----------------------------------------- */}
      <Section title="What you can spend" hint="Money you could use today.">
        <AccountList accounts={liquid} amountFor={amountFor} empty="No everyday accounts yet." />
      </Section>

      {/* --- 2. what you owe ----------------------------------------------- */}
      {debts.length > 0 && (
        <Section title="What you owe" hint="Cards and short-term borrowing.">
          <Card padding="none">
            <ul className="divide-y divide-line-faint">
              {debts.map((account) => {
                const owed = amountFor(account.id);
                const reserved =
                  account.id === ACCOUNT_IDS.card ? (data?.reserved ?? minor(0)) : minor(0);
                const covered = owed === 0 || reserved >= owed;

                return (
                  <li key={account.id} className="flex flex-col gap-3 px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-body text-ink">{account.name}</p>
                        <p className="pt-0.5 text-caption text-ink-3">
                          {owed === 0
                            ? 'Nothing on it at the moment'
                            : covered
                              ? `${money.format(reserved)} is set aside, ready to pay it`
                              : `${money.format(reserved)} set aside so far`}
                        </p>
                      </div>
                      <Money value={owed} size="lead" tone={owed > 0 ? 'neutral' : 'muted'} />
                    </div>

                    {owed > 0 && (
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setPayingCard(true)}>
                          Pay this bill
                        </Button>
                        {covered && (
                          <span className="rounded-pill bg-liquid-wash px-2 py-0.5 text-micro font-medium text-liquid">
                            Ready to pay in full
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      )}

      {/* --- 3. money you fronted ------------------------------------------ */}
      <Section
        title="Money you fronted"
        hint="Things you paid for that somebody else owes you back. None of it counts as your spending."
      >
        {open.length === 0 ? (
          <Card>
            <p className="py-2 text-caption text-ink-2">
              Nothing outstanding. When you pay for something on someone else&rsquo;s behalf, tick
              &ldquo;I fronted this for someone else&rdquo; and it will wait here until the money
              comes back.
            </p>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-line-faint">
              {open.map((claim) => (
                <li key={claim.id} className="flex flex-col gap-3 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body text-ink">{claim.counterparty} owes you</p>
                      <p className="pt-0.5 text-caption text-ink-3">
                        Added {describeDate(claim.openedOn, locale)}
                        {claim.settled > 0 ? ` · ${money.format(claim.settled)} back so far` : ''}
                      </p>
                    </div>
                    <Money value={claim.outstanding} size="lead" tone="caution" />
                  </div>
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => setSettling(claim)}>
                      Record payback
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {/* --- 4. pots ------------------------------------------------------- */}
      <Section
        title="Your pots"
        hint="Money put by for things that only come round now and then."
        action={
          <button
            type="button"
            onClick={() => navigate('pots')}
            className="text-caption text-liquid"
          >
            Manage
          </button>
        }
      >
        {pots.length === 0 ? (
          <Card>
            <div className="flex flex-col items-start gap-3 py-1">
              <p className="text-caption text-ink-2">
                Nothing set up yet. Car insurance, a holiday, Christmas — putting a bit by each
                month means they never arrive as a shock.
              </p>
              <Button variant="secondary" size="sm" onClick={() => navigate('pots')}>
                Start a pot
              </Button>
            </div>
          </Card>
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-line-faint">
              {pots.map((pot) => (
                <li
                  key={pot.envelopeId}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body text-ink">{pot.name}</p>
                    <p className="truncate pt-0.5 text-caption text-ink-3">
                      {potStatusLabel(pot.status)}
                      {pot.targetAmount > 0 ? ` · of ${money.format(pot.targetAmount)}` : ''}
                    </p>
                  </div>
                  <Money value={pot.currentBalance} size="lead" tone="liquid" />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <PayCardSheet
        open={payingCard}
        onClose={() => setPayingCard(false)}
        owed={amountFor(ACCOUNT_IDS.card)}
        reserved={data?.reserved ?? minor(0)}
      />
      <PaybackSheet open={settling !== null} onClose={() => setSettling(null)} claim={settling} />
    </div>
  );
}

/* --- shared bits --------------------------------------------------------- */

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">{title}</h2>
        {action}
      </div>
      {hint && <p className="-mt-1 max-w-[46ch] text-caption text-ink-2">{hint}</p>}
      {children}
    </section>
  );
}

function AccountList({
  accounts,
  amountFor,
  empty,
}: {
  accounts: LedgerAccount[];
  amountFor: (id: AccountId) => Minor;
  empty: string;
}) {
  if (accounts.length === 0) {
    return (
      <Card>
        <p className="py-2 text-caption text-ink-2">{empty}</p>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <ul className="divide-y divide-line-faint">
        {accounts.map((account) => {
          const value = amountFor(account.id);
          return (
            <li key={account.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <span className="min-w-0 truncate text-body text-ink">{account.name}</span>
              <Money value={value} size="lead" tone={value < 0 ? 'deficit' : 'neutral'} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
