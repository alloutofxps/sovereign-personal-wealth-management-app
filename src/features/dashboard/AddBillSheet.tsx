/* Telling Sovereign about a regular payment.
 *
 * Without these, "safe to spend" is only ever the account balance. This is the
 * smallest flow that makes the headline figure mean what it says. */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import { toIsoDate } from '@/core/liquidity';
import { CADENCE_LABELS, saveScheduled, type Cadence } from '@/data/repositories/scheduleRepo';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { AmountInput, BottomSheet, Button } from '@/design/ui';

type Kind = 'bill' | 'income';

export function AddBillSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const money = useMoney();
  const [step, setStep] = useState<'amount' | 'details'>('amount');
  const [kind, setKind] = useState<Kind>('bill');
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [nextDue, setNextDue] = useState(toIsoDate(new Date()));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setKind('bill');
    setAmount(minor(0));
    setName('');
    setCadence('monthly');
    setNextDue(toIsoDate(new Date()));
    setProblem(null);
    setSaving(false);
  }, [open]);

  const canSave = amount > 0 && name.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setProblem(null);
    try {
      await saveScheduled({
        id: crypto.randomUUID(),
        kind,
        name: name.trim(),
        amount,
        nextDue,
        cadence,
        accountId: null,
        categoryId: null,
        active: true,
      });
      toast(
        kind === 'bill'
          ? `Saved. ${name.trim()} is now held back from what is safe to spend.`
          : `Saved. Sovereign now knows when your money next arrives.`,
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
      title={step === 'amount' ? 'How much is it?' : 'Tell us about it'}
      {...(step === 'amount'
        ? {
            description:
              'Regular payments are held back so you never spend money that is already promised.',
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
                Back
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
          label={kind === 'bill' ? 'Amount of the bill' : 'Amount you are paid'}
          hint={`Each time it goes ${kind === 'bill' ? 'out' : 'in'}.`}
        />
      ) : (
        <div className="flex flex-col gap-5 pb-2">
          <Field label="Is this money going out, or coming in?">
            <div className="grid grid-cols-2 gap-2">
              {(['bill', 'income'] as Kind[]).map((k) => (
                <Choice key={k} selected={kind === k} onClick={() => setKind(k)}>
                  {k === 'bill' ? 'A bill I pay' : 'Money I am paid'}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="What is it called?">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'bill' ? 'Rent, phone, energy…' : 'Pay from work'}
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
            />
          </Field>

          <Field label="How often?">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CADENCE_LABELS) as Cadence[]).map((c) => (
                <Choice key={c} selected={cadence === c} onClick={() => setCadence(c)}>
                  {CADENCE_LABELS[c]}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label={kind === 'bill' ? 'When is it next due?' : 'When are you next paid?'}>
            <input
              type="date"
              value={nextDue}
              onChange={(e) => e.target.value && setNextDue(e.target.value)}
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink [color-scheme:dark]"
            />
          </Field>

          <p className="text-caption text-ink-3">
            {amount > 0 && name.trim()
              ? `${money.format(amount)} for ${name.trim()}, ${CADENCE_LABELS[cadence].toLowerCase()}.`
              : 'Fill in the name above and we will hold this back for you.'}
          </p>
        </div>
      )}
    </BottomSheet>
  );
}

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
