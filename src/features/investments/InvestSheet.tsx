/* ===========================================================================
 * RECORDING MONEY GOING IN
 * ---------------------------------------------------------------------------
 * The sheet exists mostly to say the thing nobody's banking app says: this is
 * not spending. Money moving from a current account into a pension is the same
 * money in a different shape, and the whole reason the ledger has two books is
 * so it can say so and mean it.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import { recordInvestmentBuy } from '@/app/investments/actions';
import { useAccounts } from '@/app/ledger/useLedger';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Explain, Select } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function InvestSheet({
  open,
  onClose,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  accounts: readonly LedgerAccount[];
}) {
  const money = useMoney();
  const explain = useExplain();
  const all = useAccounts();

  const [amount, setAmount] = useState<Minor>(minor(0));
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [busy, setBusy] = useState(false);

  // Only everyday money can be invested from — a pension cannot fund a
  // brokerage purchase, and offering it would produce an entry that says
  // something untrue about where the money came from.
  const cashAccounts = (all.data ?? []).filter(
    (a) => !a.archivedAt && a.type === 'ASSET' && a.onBudget && a.liquid,
  );

  useEffect(() => {
    if (!open) return;
    if (!fromId && cashAccounts[0]) setFromId(cashAccounts[0].id);
    if (!toId && accounts[0]) setToId(accounts[0].id);
  }, [open, fromId, toId, cashAccounts, accounts]);

  const from = cashAccounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);

  async function save() {
    if (!from || !to || amount <= 0) return;
    setBusy(true);
    try {
      await recordInvestmentBuy({
        amount,
        cashAccountId: from.id as AccountId,
        brokerageAccountId: to.id as AccountId,
      });
      toast(
        `${money.format(amount)} moved from ${from.name} into ${to.name}. ` +
          `None of it counts as spending.`,
      );
      setAmount(minor(0));
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
      open={open}
      onClose={onClose}
      size="tall"
      title="Money going into investments"
      description="Cash out of one account and into another. Your net worth does not change."
      footer={
        <Button
          variant="primary"
          block
          disabled={busy || amount <= 0 || !from || !to}
          onClick={() => void save()}
        >
          {busy ? 'Recording…' : 'Record it'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <AmountInput
          value={amount}
          onChange={setAmount}
          onSubmit={() => void save()}
          label="How much"
          hint="What left your account to be invested."
        />

        <Select
          label="From"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
          emptyLabel="No everyday accounts yet"
        />

        <Select
          label="Into"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          emptyLabel="No investment accounts yet"
        />

        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3.5 py-3">
          <p className="text-caption text-ink-2">
            {amount > 0 && from && to
              ? `${money.format(amount)} will leave ${from.name} and arrive in ${to.name}.`
              : 'Pick an amount and the two accounts.'}
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-ink-3">
              Not spending, but no longer safe to spend either.
            </p>
            <Explain topic="transfers" label="moving money about" onOpen={explain.open} />
          </div>
        </div>
      </div>
      {explain.sheet}
    </BottomSheet>
  );
}
