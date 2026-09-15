/* ===========================================================================
 * WHAT'S IN IT
 * ---------------------------------------------------------------------------
 * The one screen that makes a brokerage account a brokerage account: what you
 * hold, and how much of it is still cash.
 *
 * It exists because of a walk from a wiped database. Picking "Investments"
 * asked for a single figure with a placeholder reading "Family home", never
 * mentioned holdings or cash, and the only route to either was a secondary
 * button on a section header two screens away. Recording the first holding
 * then replaced the figure and reported the difference as a loss.
 *
 * Three rules come out of that, and they are the whole design:
 *
 *   Nothing is written until Done.  A portfolio entered one holding at a time
 *   used to re-value the account after each one, so net worth was wrong for as
 *   long as it took to type — and every intermediate figure was dated, which
 *   made it history. Holdings are held in local state and written in one go.
 *
 *   Cash is a field.  It was a concept the engine had and no screen showed. It
 *   cannot be inferred on a first reconciliation: the gap between a typed
 *   figure and an incomplete register is either cash or a holding not entered
 *   yet, and both guesses destroy money. So it is asked for.
 *
 *   The total is shown before it is committed.  Somebody who typed EUR 3,458
 *   should see that figure again here, or find out why it differs, rather than
 *   discovering it changed afterwards.
 * ======================================================================== */

import { useEffect, useMemo, useState } from 'react';
import { basisPoints, minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import {
  ASSET_CLASS_MEANINGS,
  ASSET_CLASS_NAMES,
  HOLDABLE_ASSET_CLASSES,
  describePortfolioSetup,
  marketValue,
  parseQuantity,
  formatQuantity,
  type AssetClass,
} from '@/core/investments';
import { addHolding, reconcileWithStatedCash } from '@/data/repositories/investmentsRepo';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Input, Outcome, Select } from '@/design/ui';

/** A holding typed in but not yet written. */
interface Pending {
  key: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity1e8: number;
  priceMinor: Minor;
  costBasis: Minor;
  expenseRatioBp: number;
}

const safeQuantity = (text: string): number => {
  try {
    return parseQuantity(text);
  } catch {
    return 0;
  }
};

const safeAmount = (text: string): number => {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

export function PortfolioSetupSheet({
  open,
  onClose,
  accountId,
  accountName,
  /**
   * What the account is currently recorded as being worth, when that is a
   * figure somebody typed rather than one the register produced.
   *
   * Present for an account being set up after the fact; absent for one created
   * through this flow, which has no figure yet. It is what lets the footer
   * count down to zero instead of counting up from nothing.
   */
  typedValue,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: AccountId;
  accountName: string;
  typedValue?: Minor;
  onDone?: () => void;
}) {
  const money = useMoney();

  const [pending, setPending] = useState<Pending[]>([]);
  const [cash, setCash] = useState<Minor>(minor(0));
  const [cashTouched, setCashTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState<AssetClass>('equity');
  const [shares, setShares] = useState('');
  const [priceText, setPriceText] = useState('');
  const [costText, setCostText] = useState('');
  const [feeText, setFeeText] = useState('');

  useEffect(() => {
    if (!open) {
      setPending([]);
      setCash(minor(0));
      setCashTouched(false);
      setAdding(false);
      setSymbol('');
      setName('');
      setShares('');
      setPriceText('');
      setCostText('');
      setFeeText('');
    }
  }, [open]);

  const holdingsValue = useMemo(
    () => minor(pending.reduce((sum, p) => sum + marketValue(p.priceMinor, p.quantity1e8), 0)),
    [pending],
  );

  /*
   * The leftover, offered rather than assumed.
   *
   * For an account with a figure already on it, whatever the holdings do not
   * account for is the obvious candidate for the cash — so it is filled in and
   * shown, not silently applied. Once somebody edits the field themselves the
   * suggestion stops moving under them.
   */
  const suggestedCash = useMemo(
    () =>
      typedValue === undefined || pending.length === 0
        ? minor(0)
        : minor(typedValue - holdingsValue),
    [typedValue, holdingsValue, pending.length],
  );

  /*
   * `pending.length === 0` is the important half.
   *
   * A walk of this screen found it announcing "Legacy ISA will be worth
   * EUR 3,458.00 — EUR 3,458.00 in cash" before anything had been typed,
   * because with no holdings the whole figure is left over. Nobody had said
   * that, and it is precisely the assumption the engine refuses to make: with
   * an empty register the difference is unexplained, not cash. The leftover
   * only becomes a sensible suggestion once something has been taken off it.
   */
  useEffect(() => {
    if (!cashTouched && suggestedCash > 0) setCash(suggestedCash);
  }, [cashTouched, suggestedCash]);

  const total = minor(holdingsValue + cash);
  const quantity = safeQuantity(shares);
  const price = safeAmount(priceText);
  const rowReady = Boolean(symbol.trim() && name.trim() && quantity > 0 && price > 0);

  function addRow(): void {
    if (!rowReady) return;
    setPending((rows) => [
      ...rows,
      {
        key: `${symbol}-${rows.length}`,
        symbol: symbol.trim().toUpperCase(),
        name: name.trim(),
        assetClass,
        quantity1e8: quantity,
        priceMinor: minor(price),
        costBasis: minor(safeAmount(costText)),
        expenseRatioBp: Math.round(Number(feeText.replace(/[^0-9.]/g, '') || '0') * 100),
      },
    ]);
    setSymbol('');
    setName('');
    setShares('');
    setPriceText('');
    setCostText('');
    setFeeText('');
    setAssetClass('equity');
    setAdding(false);
  }

  async function save(): Promise<void> {
    setBusy(true);
    try {
      // Every holding first, with the reconciliation held back, so the
      // account's worth moves exactly once and only at the end.
      for (const row of pending) {
        await addHolding({
          accountId,
          symbol: row.symbol,
          name: row.name,
          assetClass: row.assetClass,
          expenseRatioBp: basisPoints(row.expenseRatioBp),
          quantity1e8: row.quantity1e8,
          costBasis: row.costBasis,
          priceMinor: row.priceMinor,
          deferSync: true,
        });
      }
      await reconcileWithStatedCash(accountId, cash);
      toast(
        pending.length === 0
          ? `${accountName} is set up.`
          : `${accountName}: ${pending.length} ${pending.length === 1 ? 'holding' : 'holdings'} recorded.`,
      );
      onDone?.();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title="What's in it?"
      description="Add each fund or share. Nothing is recorded until you finish."
      footer={
        <Button variant="primary" block disabled={busy} onClick={() => void save()}>
          {busy ? 'Recording…' : 'Done'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {pending.length > 0 && (
          <ul className="flex flex-col gap-2">
            {pending.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-body text-ink">{row.symbol}</p>
                  <p className="truncate text-caption text-ink-3">
                    {formatQuantity(row.quantity1e8)}{' '}
                    {row.quantity1e8 === 100_000_000 ? 'share' : 'shares'} · {row.name}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-body text-ink">
                    {money.format(marketValue(row.priceMinor, row.quantity1e8))}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${row.symbol}`}
                    className="target rounded-md px-1 text-caption text-ink-3"
                    onClick={() => setPending((rows) => rows.filter((r) => r.key !== row.key))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line px-3 py-3">
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Input
                label="Symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="VWCE"
                autoCapitalize="characters"
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
              options={HOLDABLE_ASSET_CLASSES.map((value) => ({
                value,
                label: ASSET_CLASS_NAMES[value],
              }))}
              hint={ASSET_CLASS_MEANINGS[assetClass]}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="How many shares"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="15.5"
                inputMode="decimal"
              />
              <Input
                label="Price per share"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder="118.50"
                inputMode="decimal"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="What it all cost"
                value={costText}
                onChange={(e) => setCostText(e.target.value)}
                placeholder="5500.00"
                inputMode="decimal"
                hint="On your statement. Leave it blank if you cannot find it."
              />
              <Input
                label="Yearly fee"
                value={feeText}
                onChange={(e) => setFeeText(e.target.value)}
                placeholder="0.22"
                inputMode="decimal"
                hint="A percentage. Blank if you do not know."
              />
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={!rowReady} onClick={addRow}>
                Add it
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" block onClick={() => setAdding(true)}>
            {pending.length === 0 ? '+ Add a fund or share' : '+ Add another'}
          </Button>
        )}

        <AmountInput
          label="Cash not invested"
          value={cash}
          onChange={(next) => {
            setCashTouched(true);
            setCash(next);
          }}
          hint="Money sitting in the account waiting to be used. Leave it at zero if there is none."
        />

        {/* What this will do, before it does it. */}
        <Outcome>
          <p className="text-caption text-ink-2">
            {describePortfolioSetup(
              {
                accountName,
                holdingCount: pending.length,
                holdingsValue,
                cash,
                total,
                typedValue: typedValue ?? null,
              },
              money.format,
            )}
          </p>
        </Outcome>
      </div>
    </BottomSheet>
  );
}
