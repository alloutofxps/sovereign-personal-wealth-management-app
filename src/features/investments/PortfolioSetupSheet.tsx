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
import { minor, type BasisPoints, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import {
  describePortfolioSetup,
  marketValue,
  formatQuantity,
  type AssetClass,
} from '@/core/investments';
import { addHolding, reconcileWithStatedCash } from '@/data/repositories/investmentsRepo';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Outcome } from '@/design/ui';
import {
  EMPTY_HOLDING_DRAFT,
  HoldingFields,
  readHoldingDraft,
  type HoldingDraft,
} from './HoldingFields';

/** A holding typed in but not yet written. */
interface Pending {
  key: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity1e8: number;
  priceMinor: Minor;
  costBasis: Minor;
  expenseRatioBp: BasisPoints;
}


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

  const [draft, setDraft] = useState<HoldingDraft>(EMPTY_HOLDING_DRAFT);

  useEffect(() => {
    if (!open) {
      setPending([]);
      setCash(minor(0));
      setCashTouched(false);
      setAdding(false);
      setDraft(EMPTY_HOLDING_DRAFT);
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
  /*
   * Clamped, not skipped, and that distinction was a defect.
   *
   * This read `if (!cashTouched && suggestedCash > 0)`, so once the holdings
   * grew past the typed figure the leftover went negative, the update was
   * skipped, and a cash figure suggested at an earlier total stayed on screen.
   * Walked with prices that had risen since the figure was typed: one holding
   * suggested EUR 810 of cash, a second pushed the holdings EUR 470 over the
   * figure, and the EUR 810 remained — inflating the account by cash the
   * arithmetic no longer supported and reporting the overshoot as EUR 1,280
   * instead of EUR 470.
   *
   * A suggestion that stops being true has to go to zero, not stand still.
   */
  useEffect(() => {
    if (!cashTouched) setCash(suggestedCash > 0 ? suggestedCash : minor(0));
  }, [cashTouched, suggestedCash]);

  const total = minor(holdingsValue + cash);
  const read = readHoldingDraft(draft);

  function addRow(): void {
    if (!read.ready) return;
    setPending((rows) => [
      ...rows,
      {
        key: `${read.symbol}-${rows.length}`,
        symbol: read.symbol,
        name: read.name,
        assetClass: read.assetClass,
        quantity1e8: read.quantity1e8,
        priceMinor: read.priceMinor,
        costBasis: read.costBasis,
        expenseRatioBp: read.expenseRatioBp,
      },
    ]);
    setDraft(EMPTY_HOLDING_DRAFT);
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
          expenseRatioBp: row.expenseRatioBp,
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
            <HoldingFields value={draft} onChange={setDraft} />

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={!read.ready} onClick={addRow}>
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
