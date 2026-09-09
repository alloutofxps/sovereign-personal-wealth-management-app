/* ===========================================================================
 * RECORDING A LOAN PAYMENT
 * ---------------------------------------------------------------------------
 * The split is computed and shown before anything is saved, because it is the
 * thing somebody is here to find out. It is also editable, because a lender's
 * arithmetic and this app's arithmetic will occasionally differ by a cent or
 * two, and when a statement is on the table the statement is the fact.
 *
 * The sheet says out loud that this will reduce what is safe to spend by the
 * whole payment, not just the interest. That surprises people — the principal
 * "goes to yourself", so it feels like it should not count — but the money is
 * genuinely gone from the account this month, and Safe-to-Spend exists to
 * answer what is left, not what was virtuous.
 * ======================================================================== */

import { useEffect, useMemo, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import { calculateNextLoanSplit, describeSplit } from '@/core/debt/amortization';
import {
  LOAN_TABLES,
  getLoan,
  recordLoanPayment,
  termsOf,
  type Loan,
} from '@/data/repositories/loansRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { useAccounts } from '@/app/ledger/useLedger';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { toIsoDate } from '@/core/liquidity';
import { BottomSheet, Button, Card, Input, Outcome, Select } from '@/design/ui';
import { useCallback } from 'react';

export function RecordLoanPaymentSheet({
  accountId,
  onClose,
}: {
  accountId: AccountId | null;
  onClose: () => void;
}) {
  const money = useMoney();
  const accounts = useAccounts();

  const [fundingId, setFundingId] = useState('');
  const [envelopeId, setEnvelopeId] = useState('');
  const [when, setWhen] = useState(toIsoDate(new Date()));
  const [extraText, setExtraText] = useState('');
  const [principalText, setPrincipalText] = useState('');
  const [interestText, setInterestText] = useState('');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useLiveQuery(
    useCallback(() => (accountId ? getLoan(accountId) : Promise.resolve(null)), [accountId]),
    LOAN_TABLES,
  );
  const loan: Loan | null = query.data ?? null;

  const live = (accounts.data ?? []).filter((a) => !a.archivedAt);
  const fundingOptions = live.filter((a) => a.type === 'ASSET');
  const envelopeOptions = live.filter((a) => a.type === 'ENVELOPE');

  const extra = minor(parseAmount(extraText));

  // What the terms say this payment should be. Recomputed as the extra
  // changes, and used to seed the two editable fields.
  const computed = useMemo(() => {
    if (!loan || !loan.hasTerms || loan.balance <= 0) return null;
    return calculateNextLoanSplit(termsOf(loan), extra);
  }, [loan, extra]);

  // Reset every time the sheet opens on a different loan, so nothing from the
  // last one is carried into this one.
  useEffect(() => {
    if (!accountId) return;
    setEdited(false);
    setExtraText('');
    setPrincipalText('');
    setInterestText('');
    setWhen(toIsoDate(new Date()));
  }, [accountId]);

  useEffect(() => {
    if (!fundingId) {
      setFundingId(fundingOptions.find((a) => a.onBudget && a.liquid)?.id ?? '');
    }
  }, [fundingId, fundingOptions]);

  const funding = live.find((a) => a.id === fundingId);
  const needsEnvelope = Boolean(funding?.onBudget && funding?.liquid);

  // A select with no value shows its first option, so leaving this empty would
  // put a pot on screen that had not actually been chosen — and disable the
  // button with nothing on screen explaining why. What is shown is what is
  // selected.
  useEffect(() => {
    if (needsEnvelope && !envelopeId && envelopeOptions.length > 0) {
      setEnvelopeId(envelopeOptions[0]!.id);
    }
  }, [needsEnvelope, envelopeId, envelopeOptions]);

  const principal = edited ? minor(parseAmount(principalText)) : (computed?.principal ?? minor(0));
  const interest = edited ? minor(parseAmount(interestText)) : (computed?.interest ?? minor(0));
  const escrow = loan?.escrowMonthly ?? minor(0);
  const total = minor(principal + interest + escrow);

  const ready =
    Boolean(loan) &&
    Boolean(funding) &&
    total > 0 &&
    (!needsEnvelope || envelopeId !== '') &&
    (edited || computed !== null);

  async function save() {
    if (!loan || !funding) return;
    setBusy(true);
    try {
      const result = await recordLoanPayment({
        loanId: loan.account.id,
        fundingAccountId: funding.id,
        date: when,
        extraPrincipal: extra,
        ...(needsEnvelope ? { envelopeId: envelopeId as AccountId } : {}),
        ...(edited
          ? {
              override: {
                // The typed principal is the contractual part; anything extra
                // is added on top by the repository, not folded into it.
                principal: minor(Math.max(0, principal - extra)),
                interest,
                escrow,
              },
            }
          : {}),
      });

      toast(
        `${money.format(result.split.totalPayment)} recorded. ` +
          `${money.format(result.remainingBalance)} left owing on ${loan.account.name}.`,
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That payment could not be recorded.', {
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
      title={loan ? `Pay ${loan.account.name}` : 'Record a loan payment'}
      description="Part of this reduces what you owe. The rest is the cost of the money."
      footer={
        <Button variant="primary" block disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Recording…' : ready ? `Record ${money.format(total)}` : 'Record the payment'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {!loan ? (
          <p className="py-2 text-caption text-ink-2">Loading the loan…</p>
        ) : (
          <>
            {/* --- what this payment is made of ------------------------ */}
            <Outcome>
              {computed && !edited ? (
                <p className="text-caption text-ink-2">{describeSplit(computed, money.format)}</p>
              ) : (
                <p className="text-caption text-ink-2">Type what the statement says.</p>
              )}
              <button
                type="button"
                className="self-start text-caption text-ink-3 underline underline-offset-2"
                onClick={() => {
                  setEdited((was) => {
                    if (!was && computed) {
                      setPrincipalText(toText(computed.principal));
                      setInterestText(toText(computed.interest));
                    }
                    return !was;
                  });
                }}
              >
                {edited ? 'Work it out for me instead' : 'My statement says something different'}
              </button>
            </Outcome>

            {edited && (
              <div className="flex gap-3">
                <span className="flex-1">
                  <Input
                    label="Off what you owe"
                    value={principalText}
                    onChange={(e) => setPrincipalText(e.target.value)}
                    inputMode="decimal"
                    placeholder="288.16"
                  />
                </span>
                <span className="flex-1">
                  <Input
                    label="Interest"
                    value={interestText}
                    onChange={(e) => setInterestText(e.target.value)}
                    inputMode="decimal"
                    placeholder="666.67"
                  />
                </span>
              </div>
            )}

            <Select
              label="Paid from"
              value={fundingId}
              onChange={(e) => setFundingId(e.target.value)}
              options={fundingOptions.map((a) => ({ value: a.id, label: a.name }))}
              emptyLabel="No accounts yet"
            />

            {needsEnvelope && (
              <Select
                label="Out of which pot"
                value={envelopeId}
                onChange={(e) => setEnvelopeId(e.target.value)}
                options={envelopeOptions.map((a) => ({ value: a.id, label: a.name }))}
                emptyLabel="No pots yet"
                hint="The whole payment comes out of this, not just the interest."
              />
            )}

            <Input
              type="date"
              label="When"
              value={when}
              onChange={(e) => e.target.value && setWhen(e.target.value)}
            />

            <Input
              label="Anything extra this month"
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              hint="All of it comes off what you owe, which shortens the loan."
            />

            {/* --- what will happen ------------------------------------ */}
            <Card>
              <div className="flex flex-col gap-1.5">
                <p className="text-caption text-ink">
                  {money.format(total)} will leave {funding?.name ?? 'your account'}, and{' '}
                  {money.format(minor(principal))} of it comes off what you owe.
                </p>
                {escrow > 0 && (
                  <p className="text-caption text-ink-3">
                    {money.format(escrow)} of that is held by the lender for your tax and insurance
                    bills.
                  </p>
                )}
                {needsEnvelope && (
                  <p className="text-caption text-ink-3">
                    What is safe to spend goes down by the whole {money.format(total)}. The money
                    has left your account, even the part that made you better off.
                  </p>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

/** '1,204.83' → 120483. Anything unparseable is nothing rather than a guess. */
function parseAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

function toText(amount: Minor): string {
  return (amount / 100).toFixed(2);
}
