/* Paying the card bill, and being paid back for money you fronted.
 *
 * Both are cash-flow neutral: nothing here is spending, and nothing here is
 * income. The sheets say so in as many words, because the whole reason these
 * flows exist is that most apps get them wrong and quietly double-count. */

import { useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { Claim } from '@/data/repositories/claimsRepo';
import { recordCardPayment, recordPayback } from '@/app/ledger/actions';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { AmountInput, BottomSheet, Button, Money } from '@/design/ui';

/* --- paying the card bill ------------------------------------------------ */

export function PayCardSheet({
  open,
  onClose,
  owed,
  reserved,
}: {
  open: boolean;
  onClose: () => void;
  owed: Minor;
  reserved: Minor;
}) {
  const money = useMoney();
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(owed);
    setProblem(null);
    setSaving(false);
  }, [open, owed]);

  async function pay() {
    if (amount <= 0) return;
    setSaving(true);
    setProblem(null);
    try {
      await recordCardPayment(amount);
      toast(
        `Done. ${money.format(amount)} has gone from your everyday account to your card. ` +
          `This is not spending, so nothing about your month has changed.`,
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

  const covered = reserved >= amount;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Pay your card bill"
      description="Moving money to your card is not spending. You spent it when you used the card."
      footer={
        <div className="flex flex-col gap-2">
          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}
          <Button variant="primary" block disabled={amount <= 0 || saving} onClick={() => void pay()}>
            {saving ? 'Recording…' : 'Record the payment'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <AmountInput
          value={amount}
          onChange={setAmount}
          onSubmit={() => void pay()}
          label="How much are you paying?"
          hint={`You owe ${money.format(owed)} at the moment.`}
        />

        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3.5 py-3">
          <Row label="On your card" value={owed} />
          <Row label="Already set aside for it" value={reserved} tone="liquid" />
          <p className="pt-1 text-caption text-ink-2">
            {covered
              ? 'The money for this is already put by, so paying it will not change what is safe to spend.'
              : 'This is a little more than you have put by, so some of it will come out of what is safe to spend.'}
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

/* --- being paid back ----------------------------------------------------- */

export function PaybackSheet({
  open,
  onClose,
  claim,
}: {
  open: boolean;
  onClose: () => void;
  claim: Claim | null;
}) {
  const money = useMoney();
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !claim) return;
    setAmount(claim.outstanding);
    setProblem(null);
    setSaving(false);
  }, [open, claim]);

  async function record() {
    if (!claim || amount <= 0) return;
    setSaving(true);
    setProblem(null);
    try {
      await recordPayback(claim, amount);
      const settled = amount >= claim.outstanding;
      toast(
        settled
          ? `Done. ${claim.counterparty} has paid you back in full, and it has not been counted as income.`
          : `Done. ${money.format(amount)} recorded. ${money.format(minor(claim.outstanding - amount))} still to come.`,
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
      title={claim ? `${claim.counterparty} paid you back` : 'Record a payback'}
      description="Getting your own money returned is not income, so this will not change what you appear to earn."
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
            disabled={amount <= 0 || saving}
            onClick={() => void record()}
          >
            {saving ? 'Recording…' : 'Record it'}
          </Button>
        </div>
      }
    >
      {claim && (
        <div className="flex flex-col gap-4">
          <AmountInput
            value={amount}
            onChange={setAmount}
            onSubmit={() => void record()}
            label="How much came back?"
            hint={`${money.format(claim.outstanding)} is still owed to you.`}
          />

          <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3.5 py-3">
            <Row label="You fronted" value={claim.expected} />
            {claim.settled > 0 && <Row label="Already paid back" value={claim.settled} tone="liquid" />}
            <Row label="Still owed after this" value={minor(Math.max(0, claim.outstanding - amount))} />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: Minor;
  tone?: 'liquid';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-caption text-ink-2">{label}</span>
      <Money value={value} size="body" {...(tone ? { tone } : {})} />
    </div>
  );
}
