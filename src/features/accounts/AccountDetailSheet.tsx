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
import { isRevaluable, isoDate, type LedgerAccount } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import {
  ACCOUNT_TABLES,
  archiveAccount,
  calculateDepreciation,
  listValuations,
  type DepreciationEstimate,
  type ValuationMark,
} from '@/data/repositories/accountsRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import type { DebtTermsRow } from '@/data/repositories/ledgerRepo';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Money } from '@/design/ui';

export function AccountDetailSheet({
  account,
  balance,
  onClose,
  onUpdateValue,
  onEditTerms,
  terms,
}: {
  account: LedgerAccount | null;
  balance: Minor;
  onClose: () => void;
  onUpdateValue: () => void;
  onEditTerms: () => void;
  terms: DebtTermsRow | undefined;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
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
              <p className="text-caption text-ink-2">{describeStanding(account, owed)}</p>
              {account.institution && (
                <p className="text-caption text-ink-3">Held with {account.institution}.</p>
              )}
            </div>
          </Card>

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
              <h3 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">
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

          {/* --- putting it away ---------------------------------------- */}
          <div className="pt-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void archive()}>
              {busy ? 'Putting away…' : 'Put this account away'}
            </Button>
            <p className="pt-1.5 text-caption text-ink-3">
              It stops being offered, and everything it ever recorded stays exactly where it
              is. It has to be empty first.
            </p>
          </div>
        </div>
      )}
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
  return 'A tracking account. It counts towards what you are worth, but never towards what is safe to spend.';
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
              `${format(estimate.projected)} by now — about ${format(minor(Math.abs(estimate.drift)))} ` +
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
