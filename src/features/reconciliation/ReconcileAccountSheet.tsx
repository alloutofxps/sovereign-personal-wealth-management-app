/* ===========================================================================
 * CHECKING AN ACCOUNT AGAINST ITS STATEMENT
 * ---------------------------------------------------------------------------
 * The oldest job in bookkeeping, and the one that turns a set of records into
 * something a person actually trusts. You put in what the bank says the
 * account came to, tick off what has gone through, and either it agrees to the
 * penny or it does not.
 *
 * Three decisions worth naming.
 *
 * The difference is shown at all times, at the top, and it is exact. Not a
 * progress bar, not "nearly there" — the number, and whether it is nothing.
 * Rounding it or softening it would defeat the only reason to do this.
 *
 * An unbalanced check is amber, never red, and the sentence describing it
 * blames nothing. A difference is usually a receipt somebody has not entered
 * yet, and being shouted at about it is not the way to get it entered.
 *
 * And nothing is locked until the difference is nothing at all. There is no
 * "close enough" button, no adjustment entry offered to paper over a gap. An
 * app that will quietly invent a transaction to make the totals agree has
 * taught its user that the totals do not mean anything.
 * ======================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import { isoDate, type AccountId } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import {
  describeDifference,
  describeLock,
  reconciliationState,
  type ReconcilableLine,
} from '@/core/reconciliation/reconciliationMath';
import {
  RECONCILIATION_TABLES,
  commitReconciliation,
  getReconciliationState,
  togglePostingClearance,
} from '@/data/repositories/reconciliationRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { useMoney } from '@/app/money/useMoney';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Card, Input } from '@/design/ui';

export function ReconcileAccountSheet({
  accountId,
  onClose,
}: {
  accountId: AccountId | null;
  onClose: () => void;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);

  const [step, setStep] = useState<'details' | 'ticking'>('details');
  const [statementDate, setStatementDate] = useState(toIsoDate(new Date()));
  const [statementBalance, setStatementBalance] = useState<Minor>(minor(0));
  const [busy, setBusy] = useState(false);

  const query = useLiveQuery(
    useCallback(
      () =>
        accountId
          ? getReconciliationState(accountId, isoDate(statementDate), statementBalance)
          : Promise.resolve(null),
      [accountId, statementDate, statementBalance],
    ),
    RECONCILIATION_TABLES,
  );

  const view = query.data ?? null;

  // Every opening starts fresh. Carrying the last account's statement balance
  // into this one would be a wrong figure presented as a starting point.
  useEffect(() => {
    if (!accountId) return;
    setStep('details');
    setStatementDate(toIsoDate(new Date()));
    setStatementBalance(minor(0));
  }, [accountId]);

  // Recomputed from the lines on every render rather than read off the last
  // query, so a tap shows its effect immediately instead of after a round trip
  // to the database.
  const state = useMemo(
    () =>
      view
        ? reconciliationState({
            lines: view.lines,
            statementBalance,
            statementDate,
          })
        : null,
    [view, statementBalance, statementDate],
  );

  const balanced = state?.status === 'balanced';

  async function toggle(line: ReconcilableLine) {
    if (line.clearance === 'reconciled') {
      toast('That one was locked by an earlier statement check, so it cannot be changed.', {
        tone: 'attention',
      });
      return;
    }
    try {
      await togglePostingClearance(
        line.postingId,
        line.clearance === 'cleared' ? 'pending' : 'cleared',
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be changed.', {
        tone: 'attention',
      });
    }
  }

  async function finish() {
    if (!accountId) return;
    setBusy(true);
    try {
      const result = await commitReconciliation(
        accountId,
        isoDate(statementDate),
        statementBalance,
      );
      toast(
        result.locked === 0
          ? 'Everything up to that date was already checked, so nothing changed.'
          : `Checked and locked. ${result.locked} ${result.locked === 1 ? 'payment' : 'payments'} ` +
              `now ${result.locked === 1 ? 'matches' : 'match'} your statement exactly.`,
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That check could not be finished.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={accountId !== null}
      onClose={onClose}
      size="tall"
      title={view ? `Check ${view.accountName}` : 'Statement check'}
      description={
        step === 'details'
          ? 'What your bank statement says, so the two can be compared exactly.'
          : 'Tick off everything that appears on your statement.'
      }
      footer={
        step === 'details' ? (
          <Button variant="primary" block onClick={() => setStep('ticking')}>
            Start checking
          </Button>
        ) : (
          <Button variant="primary" block disabled={!balanced || busy} onClick={() => void finish()}>
            {busy
              ? 'Locking…'
              : balanced
                ? 'Lock & finish statement check'
                : 'Keep going until the difference is nothing'}
          </Button>
        )
      }
    >
      {step === 'details' ? (
        <div className="flex flex-col gap-4 pb-2">
          <Input
            type="date"
            label="Statement ending date"
            value={statementDate}
            onChange={(e) => e.target.value && setStatementDate(e.target.value)}
            hint="Everything up to and including this day is what gets checked."
          />

          <div className="flex flex-col gap-2">
            <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
              Statement ending balance
            </span>
            <AmountInput
              value={statementBalance}
              onChange={setStatementBalance}
              label="What your bank says the account came to"
              hint="Copy the closing figure from the statement, exactly as it is printed."
              allowNegative
            />
          </div>

          {view?.lastReconciliation && (
            <Card>
              <p className="text-caption text-ink-2">
                You last checked this account on{' '}
                {describeDate(view.lastReconciliation.statementDate, locale)}, when it came to{' '}
                {money.format(view.lastReconciliation.statementBalance)} and matched exactly.
              </p>
            </Card>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {/* --- the difference, always in view ------------------------- */}
          <div
            className={
              'sticky top-0 z-10 -mx-1 flex flex-col gap-1.5 rounded-md border px-3.5 py-3 ' +
              (balanced
                ? 'border-liquid-dim/50 bg-liquid-wash'
                : 'border-caution-dim/50 bg-caution-wash')
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-caption text-ink-2">Your statement</span>
              <span className="tnum text-caption text-ink">{money.format(statementBalance)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-caption text-ink-2">Ticked off here</span>
              <span className="tnum text-caption text-ink">
                {money.format(state?.clearedBalance ?? minor(0))}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line-faint pt-1.5">
              <span className="text-caption font-medium text-ink">Difference</span>
              <span
                className={
                  'tnum text-lead font-medium ' + (balanced ? 'text-liquid' : 'text-caution')
                }
              >
                {balanced ? '✓ ' : ''}
                {money.format(minor(Math.abs(state?.discrepancy ?? 0)))}
              </span>
            </div>
            {state && (
              <p className={'text-caption ' + (balanced ? 'text-liquid' : 'text-ink-2')}>
                {describeDifference(state, money.format)}
              </p>
            )}
          </div>

          {/* --- the list ---------------------------------------------- */}
          {!view || view.lines.length === 0 ? (
            <p className="py-4 text-caption text-ink-2">
              There is nothing recorded on this account up to that date, so there is nothing to
              check.
            </p>
          ) : (
            <ul className="flex flex-col">
              {view.lines.map((line) => (
                <li key={line.postingId}>
                  <button
                    type="button"
                    onClick={() => void toggle(line)}
                    disabled={line.clearance === 'reconciled'}
                    aria-pressed={line.clearance !== 'pending'}
                    className="flex w-full items-center gap-3 border-b border-line-faint px-1 py-3 text-left disabled:opacity-60"
                  >
                    <Mark clearance={line.clearance} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption text-ink">
                        {line.description}
                      </span>
                      <span className="block text-micro text-ink-3">
                        {describeDate(line.date, locale)}
                        {line.clearance === 'reconciled' ? ' · already locked' : ''}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-caption text-ink-2">
                      {money.format(line.amount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {state && (
            <p className="pt-1 text-caption text-ink-3">
              {balanced
                ? describeLock(state.lockedCount)
                : `${state.clearedCount} ticked, ${state.pendingCount} not. Nothing is locked ` +
                  `until the difference is nothing at all.`}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * The state of one line, at a glance.
 *
 * A hollow ring, a filled tick, a padlock. Shape carries the meaning, not just
 * colour — this list is read quickly, often on a phone, sometimes by somebody
 * who cannot separate the emerald from the grey.
 */
function Mark({ clearance }: { clearance: ReconcilableLine['clearance'] }) {
  if (clearance === 'reconciled') {
    return (
      <span aria-label="Locked" className="flex h-5 w-5 shrink-0 items-center justify-center">
        <LockIcon />
      </span>
    );
  }

  if (clearance === 'cleared') {
    return (
      <span
        aria-label="Ticked off"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-liquid"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m5 13 4 4L19 7"
            stroke="var(--color-base)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-label="Not ticked off"
      className="h-5 w-5 shrink-0 rounded-full border border-line-strong"
    />
  );
}

export function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="4"
        y="10"
        width="16"
        height="11"
        rx="2"
        stroke="var(--color-ink-3)"
        strokeWidth="2"
      />
      <path
        d="M8 10V7a4 4 0 1 1 8 0v3"
        stroke="var(--color-ink-3)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
