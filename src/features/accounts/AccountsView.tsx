/* ===========================================================================
 * THE BALANCE SHEET
 * ---------------------------------------------------------------------------
 * Four sections, in the order somebody would count their own money: what is in
 * hand, what is invested, what they own, what they owe. Then the two things
 * that are neither quite — money fronted for other people, and money put by.
 *
 * The header states the arithmetic rather than assuming it is obvious. "What
 * you have, less what you owe, is what you are worth" is the one sentence that
 * makes a balance sheet legible to somebody who has never seen one, and it
 * costs a line to say.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import {
  type AccountGroup,
  type AccountId,
  type LedgerAccount,
} from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import { GROUP_HINTS, GROUP_TITLES, groupOf } from '@/core/ledger/accountClasses';
import { potStatusLabel } from '@/core/goals';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { debtTerms, type DebtTermsRow } from '@/data/repositories/ledgerRepo';
import { ACCOUNT_TABLES, lastValuedDates } from '@/data/repositories/accountsRepo';
import { CLAIM_TABLES, listOpenClaims, type Claim } from '@/data/repositories/claimsRepo';
import { ACCOUNT_IDS, SYSTEM_ACCOUNTS } from '@/data/seed';
import { useDashboard } from '@/app/dashboard/useDashboard';
import { useAccounts, useBalances } from '@/app/ledger/useLedger';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useFx } from '@/app/fx/useFx';
import { useRoute } from '@/app/router';
import { Button, Card, Money } from '@/design/ui';
import { PayCardSheet, PaybackSheet } from './SettleUpSheet';
import { WriteOffSheet } from './WriteOffSheet';
import { DebtTermsSheet } from './DebtTermsSheet';
import { AccountDetailSheet } from './AccountDetailSheet';
import { ConvertCurrencySheet } from './ConvertCurrencySheet';
import { CreateAccountSheet } from './CreateAccountSheet';
import { RecordValuationSheet } from './RecordValuationSheet';
import { LoanScheduleSheet } from './LoanScheduleSheet';
import { RecordLoanPaymentSheet } from './RecordLoanPaymentSheet';
import { NetWorthHistoryCard } from './NetWorthHistoryCard';
import { ReconcileAccountSheet } from '@/features/reconciliation/ReconcileAccountSheet';

const ORDER: AccountGroup[] = ['cash', 'foreign', 'investments', 'property', 'debts'];

export function AccountsView() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const dashboard = useDashboard();
  const fx = useFx();
  const accounts = useAccounts();
  const balances = useBalances();
  const claims = useLiveQuery(useCallback(() => listOpenClaims(), []), CLAIM_TABLES);
  const terms = useLiveQuery(useCallback(() => debtTerms(), []), ['accounts', 'postings']);
  const valued = useLiveQuery(useCallback(() => lastValuedDates(), []), ACCOUNT_TABLES);

  const [payingCard, setPayingCard] = useState(false);
  const [settling, setSettling] = useState<Claim | null>(null);
  const [writingOff, setWritingOff] = useState<Claim | null>(null);
  const [editingTerms, setEditingTerms] = useState<DebtTermsRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [viewing, setViewing] = useState<LedgerAccount | null>(null);
  const [revaluing, setRevaluing] = useState<LedgerAccount | null>(null);
  const [schedulingLoan, setSchedulingLoan] = useState<AccountId | null>(null);
  const [payingLoan, setPayingLoan] = useState<AccountId | null>(null);
  const [reconciling, setReconciling] = useState<AccountId | null>(null);
  const [collapsed, setCollapsed] = useState<Set<AccountGroup>>(new Set());

  const data = dashboard.data;
  const open = claims.data ?? [];

  const amountFor = useCallback(
    (id: AccountId): Minor => balances.data?.get(id)?.presented ?? minor(0),
    [balances.data],
  );

  // What an account is worth in the currency you report in. Summing `presented`
  // across accounts would add dollars to euros.
  const baseFor = useCallback(
    (id: AccountId): Minor => balances.data?.get(id)?.presentedBase ?? minor(0),
    [balances.data],
  );

  // Archived accounts keep every posting they ever had — they simply stop
  // being offered, which is the whole point of archiving rather than deleting.
  //
  // Receivables is left out too. It is a real asset and it belongs in what you
  // are worth, but it is presented below as the people who owe you rather than
  // as an account, and listing it twice would have somebody counting it twice.
  const live = useMemo(
    () =>
      (accounts.data ?? []).filter(
        (a) =>
          !a.archivedAt &&
          (a.type === 'ASSET' || a.type === 'LIABILITY') &&
          a.id !== SYSTEM_ACCOUNTS.receivables,
      ),
    [accounts.data],
  );

  /** What is owed back to you, kept out of the sections but not out of the sum. */
  const fronted = useMemo(
    () => amountFor(SYSTEM_ACCOUNTS.receivables),
    [amountFor],
  );

  const sections = useMemo(() => {
    const byGroup = new Map<AccountGroup, LedgerAccount[]>();
    for (const account of live) {
      const group = groupOf(account, fx.baseCurrency);
      byGroup.set(group, [...(byGroup.get(group) ?? []), account]);
    }
    return byGroup;
  }, [live, fx.baseCurrency]);

  // The three figures in the header come from the same balances as every row
  // below them, so the sum a person does by eye always comes out.
  const have = useMemo(
    () =>
      minor(
        live.filter((a) => a.type === 'ASSET').reduce((sum, a) => sum + baseFor(a.id), 0) +
          // Money other people owe you is still yours, so it counts here even
          // though it is shown further down rather than as an account.
          fronted,
      ),
    [live, baseFor, fronted],
  );
  const owe = useMemo(
    () =>
      minor(
        live.filter((a) => a.type === 'LIABILITY').reduce((sum, a) => sum + baseFor(a.id), 0),
      ),
    [live, baseFor],
  );
  const worth = minor(have - owe);

  const pots = data?.pots ?? [];
  const termsFor = (id: AccountId) => (terms.data ?? []).find((row) => row.id === id);

  function toggle(group: AccountGroup) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lead font-medium text-ink">Accounts</h1>
          <p className="text-caption text-ink-2">
            Everything you have, everything you owe, and everything that is put by.
          </p>
        </div>
        <span className="flex shrink-0 gap-2">
          {fx.hasForeign && (
            <Button variant="secondary" size="sm" onClick={() => setConverting(true)}>
              Convert
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add an account
          </Button>
        </span>
      </header>

      {/* --- the arithmetic, stated ---------------------------------------- */}
      <Card label="What you are worth" accent="liquid">
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <Money value={worth} size="figure" tone={worth < 0 ? 'deficit' : 'neutral'} />
            {data && data.netWorthChange !== 0 && (
              <span
                className={clsx(
                  'rounded-pill px-2.5 py-1 text-micro font-medium',
                  data.netWorthChange > 0 ? 'bg-liquid-wash text-liquid' : 'bg-raised text-ink-2',
                )}
              >
                {data.netWorthChange > 0 ? 'Up ' : 'Down '}
                {money.format(minor(Math.abs(data.netWorthChange)), { decimals: 'hide' })} this
                month
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-caption text-ink-2">
            <span>What you have</span>
            <Money value={have} size="caption" tone="neutral" />
            <span className="text-ink-3">less what you owe</span>
            <Money value={owe} size="caption" tone={owe > 0 ? 'caution' : 'muted'} />
            <span className="text-ink-3">is what you are worth.</span>
          </div>
        </div>
      </Card>

      {/* --- the line it got here along ------------------------------------ */}
      <NetWorthHistoryCard />

      {/* --- the four sections --------------------------------------------- */}
      {ORDER.map((group) => {
        const rows = sections.get(group) ?? [];
        if (rows.length === 0 && group !== 'cash') return null;

        // Section totals mix currencies, so they are in the reporting one.
        const total = minor(
          rows.reduce((sum, a) => sum + baseFor(a.id), 0),
        );
        const isCollapsed = collapsed.has(group);

        return (
          <section key={group} className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => toggle(group)}
              className="flex items-baseline justify-between gap-3 text-left"
              aria-expanded={!isCollapsed}
            >
              <span className="flex items-baseline gap-2">
                <Chevron open={!isCollapsed} />
                <span className="section-title text-ink">
                  {GROUP_TITLES[group]}
                </span>
              </span>
              <Money
                value={total}
                size="caption"
                tone={group === 'debts' && total > 0 ? 'caution' : 'muted'}
              />
            </button>

            {!isCollapsed && (
              <>
                <p className="-mt-1 max-w-[46ch] text-caption text-ink-2">
                  {GROUP_HINTS[group]}
                  {group === 'investments' && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => navigate('investments')}
                        className="text-caption text-liquid"
                      >
                        See what you hold
                      </button>
                    </>
                  )}
                </p>

                {rows.length === 0 ? (
                  <Card>
                    <p className="py-2 text-caption text-ink-2">
                      Nothing here yet. Add an everyday account and what is safe to spend will
                      start working itself out.
                    </p>
                  </Card>
                ) : (
                  <Card padding="none">
                    <ul className="divide-y divide-line-faint">
                      {rows.map((account) => (
                        <AccountRow
                          key={account.id}
                          account={account}
                          amount={amountFor(account.id)}
                          reserved={
                            account.id === ACCOUNT_IDS.card
                              ? (data?.reserved ?? minor(0))
                              : minor(0)
                          }
                          lastValued={valued.data?.get(account.id) ?? null}
                          locale={locale}
                          terms={termsFor(account.id)}
                          onOpen={() => setViewing(account)}
                          onPay={() => setPayingCard(true)}
                          onSchedule={() => setSchedulingLoan(account.id)}
                        />
                      ))}
                    </ul>
                  </Card>
                )}
              </>
            )}
          </section>
        );
      })}

      {/* --- money you fronted --------------------------------------------- */}
      <Section
        title="Money you fronted"
        hint="Things you paid for that somebody else owes you back. None of it counts as your spending."
      >
        {open.length === 0 ? (
          <Card>
            <p className="py-2 text-caption text-ink-2">
              Nothing outstanding. When you pay for something on someone else&rsquo;s behalf,
              tick &ldquo;I fronted this for someone else&rdquo; and it will wait here until the
              money comes back.
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setSettling(claim)}>
                      Record payback
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setWritingOff(claim)}>
                      Write off as my own spending
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {/* --- pots ----------------------------------------------------------- */}
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
                Nothing set up yet. Car insurance, a holiday, Christmas. Putting a bit by each
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

      <CreateAccountSheet open={adding} onClose={() => setAdding(false)} />
      <ConvertCurrencySheet open={converting} onClose={() => setConverting(false)} />

      <AccountDetailSheet
        account={viewing}
        balance={viewing ? amountFor(viewing.id) : minor(0)}
        terms={viewing ? termsFor(viewing.id) : undefined}
        onClose={() => setViewing(null)}
        onUpdateValue={() => {
          setRevaluing(viewing);
          setViewing(null);
        }}
        onEditTerms={() => {
          setEditingTerms(viewing ? (termsFor(viewing.id) ?? null) : null);
          setViewing(null);
        }}
        onReconcile={() => {
          setReconciling(viewing?.id ?? null);
          setViewing(null);
        }}
      />

      <ReconcileAccountSheet accountId={reconciling} onClose={() => setReconciling(null)} />

      <RecordValuationSheet
        account={revaluing}
        currentValue={revaluing ? amountFor(revaluing.id) : minor(0)}
        onClose={() => setRevaluing(null)}
      />

      <PayCardSheet
        open={payingCard}
        onClose={() => setPayingCard(false)}
        owed={amountFor(ACCOUNT_IDS.card)}
        reserved={data?.reserved ?? minor(0)}
      />
      <PaybackSheet open={settling !== null} onClose={() => setSettling(null)} claim={settling} />
      <WriteOffSheet
        open={writingOff !== null}
        onClose={() => setWritingOff(null)}
        claim={writingOff}
      />
      <LoanScheduleSheet
        accountId={schedulingLoan}
        onClose={() => setSchedulingLoan(null)}
        onRecordPayment={(id) => {
          setSchedulingLoan(null);
          setPayingLoan(id);
        }}
      />
      <RecordLoanPaymentSheet accountId={payingLoan} onClose={() => setPayingLoan(null)} />

      <DebtTermsSheet
        open={editingTerms !== null}
        onClose={() => setEditingTerms(null)}
        account={editingTerms}
        balance={editingTerms ? amountFor(editingTerms.id) : minor(0)}
      />
    </div>
  );
}

/** The liabilities that have a term, a rate and a contractual payment. */
const AMORTIZING_CLASSES = new Set(['mortgage', 'loan']);

/* --- one account in a list ------------------------------------------------ */

function AccountRow({
  account,
  amount,
  reserved,
  lastValued,
  locale,
  terms,
  onOpen,
  onPay,
  onSchedule,
}: {
  account: LedgerAccount;
  amount: Minor;
  reserved: Minor;
  lastValued: string | null;
  locale: string;
  terms: DebtTermsRow | undefined;
  onOpen: () => void;
  onPay: () => void;
  onSchedule: () => void;
}) {
  const money = useMoney();
  const fx = useFx();
  const owed = account.type === 'LIABILITY';
  const covered = owed && (amount === 0 || reserved >= amount);

  // A foreign account reads in its own currency first, because that is what
  // its statement says. What it is worth in yours goes underneath, quietly and
  // marked as an estimate — the rate was typed on some particular day.
  const foreign = fx.isForeign(account.currency);
  const approx = foreign ? fx.approxInBase(amount, account.currency!) : null;

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5">
      <button type="button" onClick={onOpen} className="flex items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="truncate text-body text-ink">{account.name}</p>
          <p className="truncate pt-0.5 text-caption text-ink-3">
            {describeRow({ account, amount, reserved, covered, lastValued, locale, terms, money })}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="flex flex-col items-end">
            {foreign ? (
              <span className="tnum text-lead text-ink">
                {fx.formatIn(amount, account.currency!)}
              </span>
            ) : (
              <Money
                value={amount}
                size="lead"
                tone={owed && amount > 0 ? 'neutral' : amount === 0 ? 'muted' : 'neutral'}
              />
            )}
            {approx && <span className="tnum text-micro text-ink-3">{approx}</span>}
          </span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m9 6 6 6-6 6"
              stroke="var(--color-ink-3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* A loan splits every payment in two, so it gets its own way in. A
          card does not — revolving debt has no schedule to show. */}
      {owed && amount > 0 && AMORTIZING_CLASSES.has(account.accountClass ?? '') && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onSchedule}>
            What each payment does
          </Button>
        </div>
      )}

      {owed && amount > 0 && account.id === ACCOUNT_IDS.card && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onPay}>
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
}

/** The supporting line under an account's name, chosen by what it is. */
function describeRow(input: {
  account: LedgerAccount;
  amount: Minor;
  reserved: Minor;
  covered: boolean;
  lastValued: string | null;
  locale: string;
  terms: DebtTermsRow | undefined;
  money: { format: (amount: Minor) => string };
}): string {
  const { account, amount, reserved, covered, lastValued, locale, terms, money } = input;

  if (account.type === 'LIABILITY') {
    const rate =
      terms?.aprBp && terms.aprBp > 0 ? `${(terms.aprBp / 100).toFixed(2)}% a year` : null;

    if (amount === 0) {
      return rate ? `Nothing on it at the moment · ${rate}` : 'Nothing on it. Tap to add the rate.';
    }
    if (reserved > 0) {
      const reserve = covered
        ? `${money.format(reserved)} is set aside, ready to pay it`
        : `${money.format(reserved)} set aside so far`;
      return rate ? `${reserve} · ${rate}` : `${reserve} · tap to add the rate`;
    }
    return rate ? `What is still owed · ${rate}` : 'What is still owed. Tap to add the rate.';
  }

  if (lastValued) {
    return `Last valued ${describeDate(lastValued, locale)}${
      account.institution ? ` · ${account.institution}` : ''
    }`;
  }

  if (account.institution) return account.institution;
  if (account.onBudget && account.liquid) return 'Counts towards what is safe to spend.';
  return 'Counts towards what you are worth, not towards what is safe to spend.';
}

/* --- shared bits ---------------------------------------------------------- */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={clsx('transition-transform', open ? 'rotate-90' : '')}
    >
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
        <h2 className="section-title text-ink">{title}</h2>
        {action}
      </div>
      {hint && <p className="-mt-1 max-w-[46ch] text-caption text-ink-2">{hint}</p>}
      {children}
    </section>
  );
}
