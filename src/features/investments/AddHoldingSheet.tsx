/* ===========================================================================
 * RECORDING SOMETHING YOU HOLD
 * ---------------------------------------------------------------------------
 * Seven fields is a lot to ask for, so the sheet earns each one by saying, in
 * a sentence, exactly what it is about to record before it records it. A form
 * whose effect you cannot predict is one people fill in wrong and then stop
 * trusting.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { basisPoints, minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import {
  ASSET_CLASS_MEANINGS,
  ASSET_CLASS_NAMES,
  ASSET_CLASS_ORDER,
  formatQuantity,
  marketValue,
  parseQuantity,
  type AssetClass,
} from '@/core/investments';
import { addHolding } from '@/data/repositories/investmentsRepo';
import { useMoney } from '@/app/money/useMoney';
import { useFx } from '@/app/fx/useFx';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Input, Select } from '@/design/ui';

export function AddHoldingSheet({
  open,
  onClose,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  accounts: readonly LedgerAccount[];
}) {
  const money = useMoney();
  const fx = useFx();

  const [accountId, setAccountId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState<AssetClass>('equity');
  const [shares, setShares] = useState('');
  const [costText, setCostText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [feeText, setFeeText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [open, accountId, accounts]);

  function reset() {
    setSymbol('');
    setName('');
    setAssetClass('equity');
    setShares('');
    setCostText('');
    setPriceText('');
    setFeeText('');
  }

  function close() {
    reset();
    onClose();
  }

  // Everything is parsed leniently for the preview and strictly on save, so
  // typing half a number never throws an error at somebody mid-keystroke.
  const quantity = safeQuantity(shares);
  const price = safeAmount(priceText);
  const cost = safeAmount(costText);
  const feeBp = safePercent(feeText);
  const value = quantity > 0 && price > 0 ? marketValue(minor(price), quantity) : minor(0);

  const account = accounts.find((a) => a.id === accountId);
  const ready = Boolean(accountId && symbol.trim() && name.trim() && quantity > 0);

  async function save() {
    setBusy(true);
    try {
      await addHolding({
        accountId: accountId as AccountId,
        symbol,
        name,
        assetClass,
        expenseRatioBp: basisPoints(feeBp),
        // A holding in a foreign account is priced in that account's currency
        // — which is what the statement quotes, and the only figure a person
        // could type without doing the conversion in their head first.
        ...(account?.currency ? { currency: account.currency } : {}),
        quantity1e8: parseQuantity(shares),
        costBasis: minor(cost),
        priceMinor: minor(price),
      });
      toast(
        `${formatQuantity(quantity)} ${symbol.trim().toUpperCase()} recorded in ` +
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

        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Input
            label="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="VWCE"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <Input
            label="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vanguard FTSE All-World"
          />
        </div>

        <Select
          label="What kind of thing is it"
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          options={ASSET_CLASS_ORDER.map((cls) => ({
            value: cls,
            label: ASSET_CLASS_NAMES[cls],
          }))}
          hint={ASSET_CLASS_MEANINGS[assetClass]}
        />

        <Input
          label="How many shares"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder="15.5"
          inputMode="decimal"
          hint="Fractions are fine — up to eight decimal places."
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Price per share"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            placeholder="118.50"
            inputMode="decimal"
            {...(account?.currency && fx.isForeign(account.currency)
              ? { hint: `In ${account.currency}, as your statement quotes it.` }
              : {})}
          />
          <Input
            label="What it all cost"
            value={costText}
            onChange={(e) => setCostText(e.target.value)}
            placeholder="5500.00"
            inputMode="decimal"
            hint="The whole position, not per share."
          />
        </div>

        <Input
          label="Yearly fee"
          value={feeText}
          onChange={(e) => setFeeText(e.target.value)}
          placeholder="0.22"
          inputMode="decimal"
          hint="The fund's ongoing charge, as a percentage. Leave it blank if you do not know."
        />

        {/* What this will do, before it does it. */}
        <div className="rounded-md border border-line bg-raised px-3.5 py-3">
          <p className="text-caption text-ink-2">
            {ready
              ? `This will add ${formatQuantity(quantity)} shares of ` +
                `${symbol.trim().toUpperCase()} valued at ${money.format(value)} to your ` +
                `${account?.name ?? 'account'}.` +
                (cost > 0
                  ? ` It cost ${money.format(minor(cost))}, so it is currently ` +
                    `${value >= cost ? 'up' : 'down'} ${money.format(minor(Math.abs(value - cost)))}.`
                  : '')
              : 'Fill in the account, the symbol, the name and the number of shares, and this will say exactly what it is about to record.'}
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

/* --- lenient parsing, for the preview only -------------------------------- */

function safeQuantity(input: string): number {
  try {
    return parseQuantity(input);
  } catch {
    return 0;
  }
}

/** A plain decimal to minor units. Returns 0 rather than throwing mid-type. */
function safeAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

/** A percentage to basis points: `0.22` → 22. */
function safePercent(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  return Math.round(Number(cleaned) * 100);
}
