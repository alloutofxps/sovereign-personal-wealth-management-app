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
import { AmountInput, BottomSheet, Button, Explain, Outcome, OutcomeRow } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

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
  // What is on the card, so the explanation can say how much of what somebody
  // holds is already spoken for rather than talking about cards in general.
  const explain = useExplain({ cardsOwed: owed });
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

        <Outcome>
          <OutcomeRow label="On your card" value={owed} />
          <OutcomeRow label="Already set aside for it" value={reserved} tone="liquid" />
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-caption text-ink-2">
              {covered
                ? 'Already put by, so nothing else moves.'
                : 'More than is put by, so some comes off what is safe to spend.'}
            </p>
            <Explain topic="cards" label="what is put by for cards" onOpen={explain.open} />
          </div>
        </Outcome>
      </div>
      {explain.sheet}
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
  /*
   * What is still out, and what this settlement returns.
   *
   * With both, the example can say what is left afterwards -- which is the
   * question somebody typing a partial payback is actually asking, and the one
   * the rows above answer for this claim only.
   */
  const explain = useExplain(
    claim ? { claimOutstanding: claim.outstanding, claimSettling: amount } : {},
  );
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
      description="Your own money coming back, not income."
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

          <Outcome>
            <OutcomeRow label="You fronted" value={claim.expected} />
            {claim.settled > 0 && (
              <OutcomeRow label="Already paid back" value={claim.settled} tone="liquid" />
            )}
            <OutcomeRow
              label="Still owed after this"
              value={minor(Math.max(0, claim.outstanding - amount))}
            />
          </Outcome>

          <div className="flex justify-end">
            <Explain topic="fronted" label="money you fronted" onOpen={explain.open} />
          </div>
        </div>
      )}
      {explain.sheet}
    </BottomSheet>
  );
}

