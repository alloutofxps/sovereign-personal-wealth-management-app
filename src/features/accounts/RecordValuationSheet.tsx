/* ===========================================================================
 * SAYING WHAT SOMETHING IS WORTH NOW
 * ---------------------------------------------------------------------------
 * The sheet says plainly what will happen before it happens, because this is
 * the one action in the app that changes what somebody is worth without any
 * money moving — and if that is a surprise, it reads like a bug.
 *
 * So it names the change, and it names the two things that will not move.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import { isoDate, type LedgerAccount } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import { recordValuation } from '@/data/repositories/accountsRepo';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Explain, Input, Outcome } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function RecordValuationSheet({
  account,
  currentValue,
  onClose,
}: {
  account: LedgerAccount | null;
  currentValue: Minor;
  onClose: () => void;
}) {
  const money = useMoney();
  const [value, setValue] = useState<Minor>(minor(0));
  const [when, setWhen] = useState(toIsoDate(new Date()));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Start from what it is currently recorded at, so somebody adjusting a
  // figure is editing rather than retyping — and so the sheet never carries
  // the last account's number into this one.
  useEffect(() => {
    if (account) {
      setValue(currentValue);
      setWhen(toIsoDate(new Date()));
      setNotes('');
    }
  }, [account, currentValue]);

  const delta = minor(value - currentValue);
  const unchanged = delta === 0;

  // Both figures, so the worked example can state the move and then say what
  // it leaves alone — which is the half of this sheet that surprises people.
  const explain = useExplain({ valuationWas: currentValue, valuationNow: value });

  async function save() {
    if (!account) return;
    setBusy(true);
    try {
      await recordValuation(account.id, {
        value,
        date: isoDate(when),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast(
        delta > 0
          ? `${account.name} is now recorded at ${money.format(value)}, ${money.format(minor(delta))} more than before.`
          : `${account.name} is now recorded at ${money.format(value)}, ${money.format(minor(-delta))} less than before.`,
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be recorded.', {
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
      title={account ? `What is ${account.name} worth now?` : 'Update the value'}
      description="Your best estimate is enough. Nothing here moves any money."
      footer={
        <Button
          variant="primary"
          block
          disabled={busy || unchanged}
          onClick={() => void save()}
        >
          {busy ? 'Recording…' : unchanged ? 'Change the figure to save it' : 'Record this value'}
        </Button>
      }
    >
      {account && (
        <div className="flex flex-col gap-4 pb-2">
          <AmountInput
            value={value}
            onChange={setValue}
            label="New estimated value"
            hint={`Currently recorded at ${money.format(currentValue)}.`}
          />

          <Input
            type="date"
            label="As at"
            value={when}
            onChange={(e) => e.target.value && setWhen(e.target.value)}
            hint="The day this estimate applies to."
          />

          <Input
            label="Why (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Local market reassessment"
            hint="A line to remind you where the figure came from."
          />

          {/* What this will and will not do. The second half matters more. */}
          <Outcome>
            <p className="text-caption text-ink-2">
              {unchanged
                ? `${account.name} is already recorded at this value, so there is nothing to change yet.`
                : delta > 0
                  ? `What you are worth will go up by ${money.format(minor(delta))}.`
                  : `What you are worth will come down by ${money.format(minor(-delta))}.`}
            </p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption text-ink-3">Nothing else moves.</p>
              <Explain
                topic="valuations"
                label="what a thing is worth now"
                onOpen={explain.open}
              />
            </div>
          </Outcome>
        </div>
      )}
      {explain.sheet}
    </BottomSheet>
  );
}
