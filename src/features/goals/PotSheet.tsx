/* Setting up something to save for, and putting money into it. */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import { accountId, type AccountId } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import type { PotPlan } from '@/core/goals';
import { savePot } from '@/data/repositories/potsRepo';
import { putIntoPot } from '@/app/ledger/actions';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { AmountInput, BottomSheet, Button, Money } from '@/design/ui';

/* --- creating or editing a pot ------------------------------------------- */

export function PotSheet({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: PotPlan | null;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const [step, setStep] = useState<'amount' | 'details'>('amount');
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [name, setName] = useState('');
  const [hasDate, setHasDate] = useState(true);
  const [date, setDate] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const inAYear = new Date();
    inAYear.setFullYear(inAYear.getFullYear() + 1);

    setStep(editing ? 'details' : 'amount');
    setAmount(editing?.targetAmount ?? minor(0));
    setName(editing?.name ?? '');
    setHasDate(editing ? editing.targetDate !== null : true);
    setDate(editing?.targetDate ?? toIsoDate(inAYear));
    setRecurring(editing?.recurring ?? false);
    setProblem(null);
    setSaving(false);
  }, [open, editing]);

  const canSave = amount > 0 && name.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setProblem(null);
    try {
      await savePot({
        id: editing?.envelopeId
          ? (editing.envelopeId as AccountId)
          : accountId(`pot-${crypto.randomUUID()}`),
        name: name.trim(),
        role: recurring ? 'sinking_fund' : 'goal',
        targetAmount: amount,
        targetDate: hasDate ? date : null,
        recurring,
      });
      toast(
        editing
          ? `Saved. ${name.trim()} is updated.`
          : `Saved. Sovereign will hold back a little each month for ${name.trim().toLowerCase()}.`,
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
      title={
        editing
          ? `Change ${editing.name.toLowerCase()}`
          : step === 'amount'
            ? 'How much do you need?'
            : 'What are you saving for?'
      }
      {...(step === 'amount' && !editing
        ? {
            description:
              'Sovereign works out what to put by each month and holds it back for you.',
          }
        : {})}
      footer={
        step === 'amount' ? (
          <Button variant="primary" block disabled={amount <= 0} onClick={() => setStep('details')}>
            Next
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {problem && (
              <p className="text-caption text-caution" role="alert">
                {problem}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" block onClick={() => setStep('amount')}>
                Change amount
              </Button>
              <Button variant="primary" block disabled={!canSave} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save it'}
              </Button>
            </div>
          </div>
        )
      }
    >
      {step === 'amount' ? (
        <AmountInput
          value={amount}
          onChange={setAmount}
          onSubmit={() => amount > 0 && setStep('details')}
          label="Amount you need"
          hint="The full amount you want to have saved."
        />
      ) : (
        <div className="flex flex-col gap-5 pb-2">
          <Field label="What is it for?">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Car insurance, holiday, new laptop…"
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
            />
          </Field>

          <Field label="When do you need it by?">
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Choice selected={hasDate} onClick={() => setHasDate(true)}>
                  By a certain date
                </Choice>
                <Choice selected={!hasDate} onClick={() => setHasDate(false)}>
                  No rush
                </Choice>
              </div>
              {hasDate && (
                <input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink [color-scheme:dark]"
                />
              )}
            </div>
          </Field>

          <Field label="Does it come round again?">
            <div className="grid grid-cols-2 gap-2">
              <Choice selected={recurring} onClick={() => setRecurring(true)}>
                Yes, every year
              </Choice>
              <Choice selected={!recurring} onClick={() => setRecurring(false)}>
                No, just once
              </Choice>
            </div>
          </Field>

          <p className="text-caption text-ink-3">
            {amount > 0 && name.trim()
              ? hasDate
                ? `${money.format(amount)} for ${name.trim()} by ${describeDate(date, locale)}. Sovereign will hold back a share of it every month.`
                : `${money.format(amount)} for ${name.trim()}, with no deadline. Nothing will be held back automatically — put in what you can.`
              : 'Give it a name and we can work out the monthly share.'}
          </p>
        </div>
      )}
    </BottomSheet>
  );
}

/* --- putting money in ---------------------------------------------------- */

export function TopUpSheet({
  open,
  onClose,
  pot,
}: {
  open: boolean;
  onClose: () => void;
  pot: PotPlan | null;
}) {
  const money = useMoney();
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !pot) return;
    // Default to whatever would put this month right.
    setAmount(pot.stillNeededThisCycle > 0 ? pot.stillNeededThisCycle : minor(0));
    setProblem(null);
    setSaving(false);
  }, [open, pot]);

  async function save() {
    if (!pot || amount <= 0) return;
    setSaving(true);
    setProblem(null);
    try {
      await putIntoPot(pot.envelopeId as AccountId, pot.name, amount);
      toast(
        `Done. ${money.format(amount)} is set aside for ${pot.name.toLowerCase()} and taken out ` +
          `of what is safe to spend.`,
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
      title={pot ? `Put money into ${pot.name.toLowerCase()}` : 'Put money in'}
      description="This money stays in your account. It is just no longer counted as spare."
      footer={
        <div className="flex flex-col gap-2">
          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}
          <Button variant="primary" block disabled={amount <= 0 || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Set it aside'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <AmountInput
          value={amount}
          onChange={setAmount}
          onSubmit={() => void save()}
          label="Amount to set aside"
          hint={
            pot && pot.stillNeededThisCycle > 0
              ? `${money.format(pot.stillNeededThisCycle)} would keep this month on track.`
              : 'Put in whatever you like.'
          }
        />
        {pot && (
          <div className="flex items-baseline justify-between gap-3 rounded-md border border-line bg-raised px-3.5 py-3">
            <span className="text-caption text-ink-2">In the pot after this</span>
            <Money value={minor(pot.currentBalance + amount)} size="lead" tone="liquid" />
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/* --- shared bits --------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'rounded-md border px-3 py-2.5 text-left text-body transition-colors',
        selected
          ? 'border-liquid-dim bg-liquid-wash text-liquid'
          : 'border-line bg-raised text-ink hover:border-line-strong',
      )}
    >
      {children}
    </button>
  );
}
