/* ===========================================================================
 * ACCOUNT DETAILS AND BORROWING TERMS
 * ---------------------------------------------------------------------------
 * The rate, the limit and the day the bill is due. Three facts that turn the
 * payoff planner from a demonstration into an answer, and put the card bill on
 * the right day of the forecast instead of the end of the month.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { bpFromPercent, bpToPercent, basisPoints, minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import { saveDebtTerms, type DebtTermsRow } from '@/data/repositories/ledgerRepo';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { AmountInput, BottomSheet, Button, Input, Money, Outcome } from '@/design/ui';

export interface DebtTermsSheetProps {
  open: boolean;
  onClose: () => void;
  account: DebtTermsRow | null;
  balance: Minor;
}

export function DebtTermsSheet({ open, onClose, account, balance }: DebtTermsSheetProps) {
  const money = useMoney();
  const [aprText, setAprText] = useState('');
  const [minPayment, setMinPayment] = useState<Minor>(minor(0));
  const [creditLimit, setCreditLimit] = useState<Minor>(minor(0));
  const [dueDay, setDueDay] = useState<number>(1);
  const [editingAmount, setEditingAmount] = useState<'minimum' | 'limit' | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !account) return;
    setAprText(
      account.aprBp === null ? '' : bpToPercent(basisPoints(account.aprBp)).toFixed(2),
    );
    setMinPayment(minor(account.minPayment ?? 0));
    setCreditLimit(minor(account.creditLimit ?? 0));
    setDueDay(account.dueDay ?? 1);
    setProblem(null);
    setSaving(false);
  }, [open, account]);

  /** Parsed here so a bad rate is caught before it reaches the ledger. */
  const parsedApr = (() => {
    if (aprText.trim() === '') return { ok: true as const, bp: 0 };
    const value = Number(aprText.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { ok: false as const, why: 'A rate should be somewhere between 0 and 100.' };
    }
    try {
      return { ok: true as const, bp: bpFromPercent(value) as number };
    } catch {
      return { ok: false as const, why: 'Rates are kept to two decimal places, like 19.99.' };
    }
  })();

  const overLimit = creditLimit > 0 && balance > creditLimit;

  async function save() {
    if (!account || !parsedApr.ok) return;
    setSaving(true);
    setProblem(null);
    try {
      await saveDebtTerms(account.id as AccountId, {
        aprBp: parsedApr.bp,
        minPayment,
        creditLimit,
        dueDay,
      });
      toast(
        `Saved. Sovereign will use ${aprText || '0'}% when working out how to clear your ` +
          `${account.name.toLowerCase()}.`,
      );
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has changed, so you can try again.',
      );
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={account ? account.name : 'Account details'}
      description="These make the payoff plan and the forecast tell you something real."
      footer={
        <div className="flex flex-col gap-2">
          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}
          <Button
            variant="primary"
            block
            disabled={!parsedApr.ok || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save these details'}
          </Button>
        </div>
      }
    >
      {account && (
        <div className="flex flex-col gap-5 pb-2">
          <Outcome className="flex-row items-baseline justify-between">
            <span className="text-caption text-ink-2">On it at the moment</span>
            <Money value={balance} size="lead" />
          </Outcome>

          {/* The unit sits in the trailing slot rather than beside the box:
              a "%" outside the field is a word next to a control, and inside
              it is part of the same object. */}
          <Input
            label="Interest rate"
            type="text"
            inputMode="decimal"
            value={aprText}
            onChange={(e) => setAprText(e.target.value)}
            placeholder="19.99"
            trailingIcon={<span className="text-body text-ink-2">%</span>}
            {...(parsedApr.ok
              ? { hint: 'The yearly rate, as your statement gives it. Blank if there is none.' }
              : { error: parsedApr.why })}
          />

          <Labelled
            label="Smallest payment they accept"
            hint="Paying only this is what keeps a card alive for a decade, so the planner needs to know it."
          >
            <TapToEdit value={minPayment} onEdit={() => setEditingAmount('minimum')} />
          </Labelled>

          <Labelled label="Credit limit" hint="Optional. Only used to tell you how close you are.">
            <TapToEdit value={creditLimit} onEdit={() => setEditingAmount('limit')} />
            {creditLimit > 0 && (
              <p className={clsx('text-caption', overLimit ? 'text-caution' : 'text-ink-3')}>
                {overLimit
                  ? 'You are over the limit on this one at the moment.'
                  : `${money.format(minor(creditLimit - balance))} of room left.`}
              </p>
            )}
          </Labelled>

          <Labelled
            label="Day of the month it is due"
            hint="So the forecast puts the bill on the right day rather than guessing at the month end."
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={28}
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                aria-label="Day of the month the bill is due"
                className="h-1.5 w-full appearance-none rounded-pill bg-sunken accent-[var(--color-liquid)]"
              />
              <span className="tnum w-16 shrink-0 text-right text-body text-ink">
                {ordinal(dueDay)}
              </span>
            </div>
          </Labelled>

          <BottomSheet
            open={editingAmount !== null}
            onClose={() => setEditingAmount(null)}
            title={
              editingAmount === 'minimum' ? 'Smallest payment they accept' : 'What is the limit?'
            }
            footer={
              <Button variant="primary" block onClick={() => setEditingAmount(null)}>
                Use this
              </Button>
            }
          >
            <AmountInput
              value={editingAmount === 'minimum' ? minPayment : creditLimit}
              onChange={editingAmount === 'minimum' ? setMinPayment : setCreditLimit}
              onSubmit={() => setEditingAmount(null)}
              label="Amount"
              hint={
                editingAmount === 'minimum'
                  ? 'Usually a small percentage of the balance, or a flat floor.'
                  : 'The most you are allowed to borrow on this account.'
              }
            />
          </BottomSheet>
        </div>
      )}
    </BottomSheet>
  );
}

/* A label above a control. Renamed off `Field`, which is the surface in
 * `src/design/ui`; eight components in six files were called that. */
function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption text-ink-2">{label}</span>
      {hint && <p className="-mt-1 max-w-[44ch] text-caption text-ink-3">{hint}</p>}
      {children}
    </div>
  );
}

function TapToEdit({ value, onEdit }: { value: Minor; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex items-center justify-between rounded-md border border-line bg-raised px-3.5 py-3 text-left"
    >
      <Money value={value} size="lead" tone={value === 0 ? 'muted' : 'neutral'} />
      <span className="text-caption text-liquid">Change</span>
    </button>
  );
}

function ordinal(day: number): string {
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${day}${suffix}`;
}
