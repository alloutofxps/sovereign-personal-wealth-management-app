/* ===========================================================================
 * ONE ACCOUNT, IN FULL
 * ---------------------------------------------------------------------------
 * What it is worth, who holds it, whether it is part of the budget, and what
 * has happened to it. For a house or a car that history is a list of marks
 * rather than transactions, which is the honest shape: nothing has been spent
 * on a house since it was bought, it has simply been reassessed.
 * ======================================================================== */

import { useCallback, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import { isoDate, type LedgerAccount } from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import { isRevaluable } from '@/core/ledger/accountClasses';
import { toIsoDate } from '@/core/liquidity';
import {
  ACCOUNT_TABLES,
  archiveAccount,
  calculateDepreciation,
  listValuations,
  renameAccount,
  type DepreciationEstimate,
  type ValuationMark,
} from '@/data/repositories/accountsRepo';
import {
  RECONCILIATION_TABLES,
  reconciliationHistory,
  unlockReconciliation,
} from '@/data/repositories/reconciliationRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import type { DebtTermsRow } from '@/data/repositories/ledgerRepo';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Explain, Input, Money, Outcome } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function AccountDetailSheet({
  account,
  balance,
  onClose,
  onUpdateValue,
  onEditTerms,
  onReconcile,
  terms,
}: {
  account: LedgerAccount | null;
  balance: Minor;
  onClose: () => void;
  onUpdateValue: () => void;
  onEditTerms: () => void;
  onReconcile: () => void;
  terms: DebtTermsRow | undefined;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  /*
   * One host, three topics: how this account is treated, what a statement
   * check does, and -- reached from the archive line -- nothing, because
   * putting an account away is a fact about the interface rather than about
   * the money, and the app does not explain its own controls.
   */
  const explain = useExplain();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [unlocking, setUnlocking] = useState<string | null>(null);

  // Every statement check ever done on this account. Until now the repository
  // could answer this and nothing asked, so the sentence the whole feature
  // earns — "it has agreed with the bank every month since June" — was
  // computed and thrown away.
  const checks = useLiveQuery(
    useCallback(
      () => (account ? reconciliationHistory(account.id) : Promise.resolve([])),
      [account],
    ),
    RECONCILIATION_TABLES,
  );

  async function saveName() {
    if (!account) return;
    try {
      await renameAccount(account.id, draftName);
      toast(`Now called ${draftName.trim()}.`);
      setRenaming(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That name could not be saved.', {
        tone: 'attention',
      });
    }
  }

  async function unlock(id: string) {
    try {
      const { unlocked } = await unlockReconciliation(id);
      toast(
        `Unlocked. ${unlocked} ${unlocked === 1 ? 'payment is' : 'payments are'} editable ` +
          `again, and the check stays in your history marked as reopened.`,
      );
      setUnlocking(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be unlocked.', {
        tone: 'attention',
      });
    }
  }
  const [busy, setBusy] = useState(false);

  const id = account?.id ?? null;

  const marks = useLiveQuery(
    useCallback(async () => (id ? listValuations(id) : []), [id]),
    ACCOUNT_TABLES,
  );

  const drift = useLiveQuery(
    useCallback(
      async () => (id ? calculateDepreciation(id, isoDate(toIsoDate(new Date()))) : null),
      [id],
    ),
    ACCOUNT_TABLES,
  );

  const canRevalue = account ? isRevaluable(account) : false;

  // Only accounts that have a statement to check against. A house does not
  // send one, and its value is a judgement rather than a fact to be verified.
  const canReconcile = Boolean(
    account && (account.type === 'ASSET' || account.type === 'LIABILITY') && !canRevalue,
  );
  const owed = account?.type === 'LIABILITY';

  async function archive() {
    if (!account) return;
    setBusy(true);
    try {
      await archiveAccount(account.id);
      toast(`${account.name} has been put away. Everything it recorded is still there.`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be put away.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={account !== null}
      onClose={onClose}
      size="tall"
      title={account?.name ?? 'Account'}
      footer={
        canRevalue ? (
          <Button variant="primary" block onClick={onUpdateValue}>
            Update value
          </Button>
        ) : undefined
      }
    >
      {account && (
        <div className="flex flex-col gap-4 pb-2">
          {/* --- the headline ------------------------------------------- */}
          <Card>
            <div className="flex flex-col gap-2">
              <Money value={balance} size="figure" tone={owed && balance > 0 ? 'caution' : 'neutral'} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-caption text-ink-2">{describeStanding(account, owed)}</p>
                <Explain
                  topic="safe-to-spend"
                  label="what is safe to spend"
                  onOpen={explain.open}
                />
              </div>
              {account.institution && (
                <p className="text-caption text-ink-3">Held with {account.institution}.</p>
              )}

              {/* A name is the one thing about an account that is purely how
                  somebody refers to it, so it is the one thing safe to change
                  after the fact. Everything else would rewrite what past
                  entries meant. */}
              {renaming ? (
                <div className="flex flex-col gap-2 pt-1">
                  <Input
                    label="What to call it"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={() => void saveName()}>
                      Save the name
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                      Leave it
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(account.name);
                    setRenaming(true);
                  }}
                  className="self-start text-caption text-liquid"
                >
                  Change what this is called
                </button>
              )}
            </div>
          </Card>

          {/* --- statement checks --------------------------------------- */}
          {(checks.data ?? []).length > 0 && (
            <Card label="Checked against your bank">
              <div className="flex flex-col gap-3">
                {(checks.data ?? []).map((check) => (
                  <div key={check.id} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-caption text-ink">
                        {describeDate(check.statementDate, locale)}
                      </span>
                      <span className="tnum text-caption text-ink-2">
                        {money.format(check.statementBalance)}
                      </span>
                    </div>
                    <p className="text-micro text-ink-3">
                      {check.status === 'completed'
                        ? 'Matched to the exact penny, and locked.'
                        : 'Matched at the time, then reopened so it could be edited.'}
                    </p>

                    {check.status === 'completed' &&
                      (unlocking === check.id ? (
                        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3 py-2.5">
                          <p className="text-caption text-ink-2">
                            This will let those payments be edited and undone again. The check
                            stays in your history, marked as reopened, so the months that once
                            agreed with your bank still explain themselves.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void unlock(check.id)}
                            >
                              Yes, unlock it
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setUnlocking(null)}>
                              Leave it locked
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setUnlocking(check.id)}
                          className="self-start text-micro text-ink-3 underline underline-offset-2"
                        >
                          Unlock this statement check
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* --- borrowing terms ---------------------------------------- */}
          {owed && (
            <Card label="The terms">
              <div className="flex flex-col gap-2">
                <p className="text-caption text-ink-2">
                  {terms?.aprBp && terms.aprBp > 0
                    ? `${(terms.aprBp / 100).toFixed(2)}% a year.`
                    : 'No rate recorded yet.'}
                  {terms?.minPayment && terms.minPayment > 0
                    ? ` The least they will accept is ${money.format(minor(terms.minPayment))} a month.`
                    : ''}
                </p>
                <div>
                  <Button variant="secondary" size="sm" onClick={onEditTerms}>
                    {terms?.aprBp ? 'Change the terms' : 'Add the rate'}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* --- what it is probably worth by now ------------------------ */}
          {drift.data && drift.data.drift !== 0 && (
            <DepreciationNote
              estimate={drift.data}
              format={(a) => money.format(a)}
              onAccept={onUpdateValue}
            />
          )}

          {/* --- the marks ---------------------------------------------- */}
          {canRevalue && (
            <section className="flex flex-col gap-2">
              <h3 className="section-title text-ink">
                What it has been worth
              </h3>
              {(marks.data ?? []).length === 0 ? (
                <Card>
                  <p className="py-1 text-caption text-ink-2">
                    Nothing recorded yet. Tap &ldquo;Update value&rdquo; whenever you have a
                    better idea of what it is worth.
                  </p>
                </Card>
              ) : (
                <Card padding="none">
                  <ul className="divide-y divide-line-faint">
                    {(marks.data ?? []).map((mark, index, all) => (
                      <MarkRow
                        key={mark.id}
                        mark={mark}
                        previous={all[index + 1]}
                        locale={locale}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          )}

          {/* --- checking it against the bank --------------------------- */}
          {canReconcile && (
            <Outcome className="items-start">
              <div className="flex w-full items-center justify-between gap-2">
                <p className="text-caption text-ink-2">
                  What matches gets locked, so it cannot change by accident.
                </p>
                <Explain
                  topic="checking"
                  label="checking against your bank"
                  onOpen={explain.open}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={onReconcile}>
                Check against a statement
              </Button>
            </Outcome>
          )}

          {/* --- putting it away ---------------------------------------- */}
          <div className="pt-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void archive()}>
              {busy ? 'Putting away…' : 'Put this account away'}
            </Button>
            <p className="pt-1.5 text-caption text-ink-3">
              It has to be empty first. Nothing it recorded moves.
            </p>
          </div>
        </div>
      )}
      {explain.sheet}
    </BottomSheet>
  );
}

/** One line saying how this account is treated, in the person's own terms. */
function describeStanding(account: LedgerAccount, owed: boolean): string {
  if (owed) {
    return 'What is still owed. It comes off what you are worth, and paying it down is not spending.';
  }
  if (account.onBudget && account.liquid) {
    return 'Money you could spend today. It counts towards what is safe to spend.';
  }
  return 'Counts towards what you are worth, never towards what is safe to spend.';
}

function MarkRow({
  mark,
  previous,
  locale,
}: {
  mark: ValuationMark;
  previous: ValuationMark | undefined;
  locale: string;
}) {
  const money = useMoney();
  const formatShort = (amount: Minor) => money.format(amount, { decimals: 'hide' });
  const change = previous ? minor(mark.value - previous.value) : null;

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-body text-ink">{describeDate(mark.date, locale)}</p>
        {mark.notes && <p className="truncate pt-0.5 text-caption text-ink-3">{mark.notes}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money value={mark.value} size="caption" />
        {change !== null && change !== 0 && (
          <span className={`text-micro ${change > 0 ? 'text-liquid' : 'text-ink-3'}`}>
            {change > 0 ? 'up ' : 'down '}
            {formatShort(minor(Math.abs(change)))}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * What the model reckons a car is worth by now.
 *
 * Offered, never applied. A car quietly revaluing itself in the background is
 * the app changing somebody's net worth while they are not looking, so this
 * only ever suggests the figure and waits.
 */
function DepreciationNote({
  estimate,
  format,
  onAccept,
}: {
  estimate: DepreciationEstimate;
  format: (amount: Minor) => string;
  onAccept: () => void;
}) {
  const fallen = estimate.drift < 0;

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <p className="text-caption text-ink-2">
          {fallen
            ? `Going by how things like this usually hold their value, it is probably nearer ` +
              `${format(estimate.projected)} by now, about ${format(minor(Math.abs(estimate.drift)))} ` +
              `below what is recorded.`
            : `The figure recorded is below what the usual rate would suggest, which is ` +
              `${format(estimate.projected)}.`}
        </p>
        <p className="text-caption text-ink-3">
          Nothing has been changed. This is only a suggestion, and your own estimate is
          always the better one.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={onAccept}>
            Update the value
          </Button>
        </div>
      </div>
    </Card>
  );
}
