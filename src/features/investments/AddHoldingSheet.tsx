/* ===========================================================================
 * RECORDING SOMETHING YOU HOLD
 * ---------------------------------------------------------------------------
 * Seven fields is a lot to ask for, so the sheet earns each one by saying, in
 * a sentence, exactly what it is about to record before it records it. A form
 * whose effect you cannot predict is one people fill in wrong and then stop
 * trusting.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import { describeHoldingEntry, formatQuantity } from '@/core/investments';
import { addHolding } from '@/data/repositories/investmentsRepo';
import { useMoney } from '@/app/money/useMoney';
import { useFx } from '@/app/fx/useFx';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Select } from '@/design/ui';
import {
  EMPTY_HOLDING_DRAFT,
  HoldingFields,
  readHoldingDraft,
  type HoldingDraft,
} from './HoldingFields';

export function AddHoldingSheet({
  open,
  onClose,
  accounts,
  accountsHoldingSomething,
}: {
  open: boolean;
  onClose: () => void;
  accounts: readonly LedgerAccount[];
  /**
   * Which accounts already hold something.
   *
   * An account holding nothing yet is one whose worth is still a figure
   * somebody typed, so the first holding recorded in it replaces that figure
   * rather than adding to it. The sentence above the button says which.
   */
  accountsHoldingSomething: ReadonlySet<string>;
}) {
  const money = useMoney();
  const fx = useFx();

  const [accountId, setAccountId] = useState('');
  const [draft, setDraft] = useState<HoldingDraft>(EMPTY_HOLDING_DRAFT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [open, accountId, accounts]);

  function reset() {
    setDraft(EMPTY_HOLDING_DRAFT);
  }

  function close() {
    reset();
    onClose();
  }

  // One reading of the draft, shared with the set-up screen so the two cannot
  // disagree about what a complete holding is. See `HoldingFields`.
  const read = readHoldingDraft(draft);

  const account = accounts.find((a) => a.id === accountId);
  const firstInAccount = accountId !== '' && !accountsHoldingSomething.has(accountId);
  const ready = Boolean(accountId) && read.ready;

  async function save() {
    setBusy(true);
    try {
      await addHolding({
        accountId: accountId as AccountId,
        symbol: read.symbol,
        name: read.name,
        assetClass: read.assetClass,
        expenseRatioBp: read.expenseRatioBp,
        // A holding in a foreign account is priced in that account's currency
        // — which is what the statement quotes, and the only figure a person
        // could type without doing the conversion in their head first.
        ...(account?.currency ? { currency: account.currency } : {}),
        quantity1e8: read.quantity1e8,
        costBasis: read.costBasis,
        priceMinor: read.priceMinor,
      });
      toast(
        `${formatQuantity(read.quantity1e8)} ${read.symbol} recorded in ` +
          `${account?.name ?? 'your account'}.`,
      );
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be recorded.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      size="tall"
      title="What do you hold?"
      description="Recording it here does not move any money. It says what is already in the account."
      footer={
        <Button variant="primary" block disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Recording…' : 'Add this holding'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Select
          label="Which account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          emptyLabel="No investment accounts yet"
          {...(accounts.length === 0
            ? { hint: 'Add a brokerage or pension account first, and it will appear here.' }
            : {})}
        />

        <HoldingFields
          value={draft}
          onChange={setDraft}
          {...(account?.currency && fx.isForeign(account.currency)
            ? { priceCurrency: account.currency }
            : {})}
        />

        {/* What this will do, before it does it. */}
        <div className="rounded-md border border-line bg-raised px-3.5 py-3">
          <p className="text-caption text-ink-2">
            {ready
              ? describeHoldingEntry(
                  {
                    quantity1e8: read.quantity1e8,
                    symbol: read.symbol,
                    marketValue: read.value,
                    costBasis: read.costBasis,
                    accountName: account?.name ?? 'this account',
                    // The first holding in an account whose worth was typed by
                    // hand replaces that figure rather than adding to it, and
                    // the sentence has to say so before the button is pressed.
                    replacesTypedValue: firstInAccount,
                  },
                  money.format,
                )
              : 'Fill the fields above in.'}
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

