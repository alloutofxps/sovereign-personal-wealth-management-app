/* ===========================================================================
 * SELLING SOME OF SOMETHING
 * ---------------------------------------------------------------------------
 * The sheet's job is to say what will happen before it happens, because two
 * things about a sale surprise people and both are irreversible.
 *
 * The first is which shares go. Somebody who bought in January and again in
 * June, and sells half, has realised a gain that depends entirely on which
 * half — and nobody expects to be asked. So it is not asked: the oldest go
 * first, and the preview says so in words rather than leaving it implicit.
 *
 * The second is what it does to the budget. The money comes back as cash that
 * has not been given a job, which means Safe-to-Spend jumps by the whole
 * proceeds. That is correct and it is startling, so it is stated up front
 * rather than discovered on the home screen afterwards.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import {
  describeBudgetEffect,
  describeDisposal,
  formatQuantity,
  marketValue,
  parseQuantity,
  relieveLotsFIFO,
  type Holding,
} from '@/core/investments';
import {
  INVESTMENT_TABLES,
  executeSell,
  listTaxLots,
} from '@/data/repositories/investmentsRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { useAccounts } from '@/app/ledger/useLedger';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Explain, Input, Money, Select } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function SellHoldingSheet({
  holding,
  onClose,
}: {
  holding: Holding | null;
  onClose: () => void;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const accounts = useAccounts();

  const [shares, setShares] = useState('');
  const [priceText, setPriceText] = useState('');
  const [feeText, setFeeText] = useState('');
  const [cashId, setCashId] = useState('');
  const [busy, setBusy] = useState(false);

  const accountId = holding?.accountId ?? null;
  const securityId = holding?.security.id ?? null;

  const lots = useLiveQuery(
    useCallback(
      async () =>
        accountId && securityId
          ? listTaxLots(accountId as AccountId, securityId)
          : [],
      [accountId, securityId],
    ),
    INVESTMENT_TABLES,
  );

  const cashAccounts = (accounts.data ?? []).filter(
    (a) => !a.archivedAt && a.type === 'ASSET' && a.onBudget && a.liquid,
  );

  useEffect(() => {
    if (!holding) return;
    setShares('');
    setFeeText('');
    setPriceText((holding.priceMinor / 100).toFixed(2));
  }, [holding]);

  useEffect(() => {
    if (!cashId && cashAccounts[0]) setCashId(cashAccounts[0].id);
  }, [cashId, cashAccounts]);

  if (!holding) {
    return <BottomSheet open={false} onClose={onClose} children={null} />;
  }

  const quantity = safeQuantity(shares);
  const price = safeAmount(priceText) || holding.priceMinor;
  const fee = safeAmount(feeText);
  const cash = cashAccounts.find((a) => a.id === cashId);

  // Previewed against the real relief engine rather than an approximation of
  // it, so the figure shown is the figure that will be recorded.
  const preview = previewSale({
    lots: lots.data ?? [],
    holding,
    quantity,
    price: minor(price),
    fee: minor(fee),
  });

  const ready = quantity > 0 && preview !== null && !preview.error && Boolean(cash);

  /*
   * The explanation is given the preview, not a second sum.
   *
   * `previewSale` runs the same `relieveLotsFIFO` that records the sale, so
   * "the units come out of your two oldest parcels, which cost 1,000" is the
   * arithmetic that is about to happen rather than a restatement of the rule.
   * Before a quantity is typed there is nothing to relieve and the sheet falls
   * back to the general example, which is the right thing for it to do.
   */
  const sale = preview && !preview.error ? preview.result : null;
  const explain = useExplain(
    sale
      ? {
          saleParcels: sale.relieved.length,
          saleCostRelieved: sale.totalCostBasisRelieved,
          saleProceeds: sale.totalProceeds,
          saleGain: sale.realizedGain,
        }
      : {},
  );

  async function sell() {
    if (!holding || !cash || !preview || preview.error) return;
    setBusy(true);
    try {
      const result = await executeSell({
        accountId: holding.accountId as AccountId,
        securityId: holding.security.id,
        cashAccountId: cash.id,
        quantity1e8: parseQuantity(shares),
        pricePerShare: minor(price),
        ...(fee > 0 ? { feesMinor: minor(fee) } : {}),
      });

      toast(
        result.realizedGain === 0
          ? `Sold ${formatQuantity(quantity)} ${holding.security.symbol}. ` +
              `${money.format(result.proceeds)} is waiting to be given a job.`
          : `Sold ${formatQuantity(quantity)} ${holding.security.symbol} for ` +
              `${money.format(result.proceeds)}, ` +
              `${result.realizedGain > 0 ? 'locking in a gain of' : 'taking a loss of'} ` +
              `${money.format(minor(Math.abs(result.realizedGain)))}.`,
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That sale could not be recorded.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      size="tall"
      title={`Sell ${holding.security.symbol}`}
      description="Nothing is sent anywhere. This records a sale you have already made."
      footer={
        <Button variant="primary" block disabled={busy || !ready} onClick={() => void sell()}>
          {busy ? 'Recording…' : 'Record this sale'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-caption text-ink-2">
              You hold {formatQuantity(holding.quantity1e8)}{' '}
              {holding.quantity1e8 === 100_000_000 ? 'share' : 'shares'}
            </span>
            <Money value={marketValue(holding.priceMinor, holding.quantity1e8)} size="caption" />
          </div>
        </Card>

        <Input
          label="How many shares to sell"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder={formatQuantity(holding.quantity1e8)}
          inputMode="decimal"
          hint="Fractions are fine. The oldest shares you own go first."
          {...(preview?.error ? { error: preview.error } : {})}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Price you sold at"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Dealing fee"
            value={feeText}
            onChange={(e) => setFeeText(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            hint="Leave blank if there was none."
          />
        </div>

        <Select
          label="Where the money goes"
          value={cashId}
          onChange={(e) => setCashId(e.target.value)}
          options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
          emptyLabel="No everyday accounts yet"
        />

        {/* --- what this will do ---------------------------------------- */}
        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3.5 py-3">
          {preview && !preview.error && cash ? (
            <>
              <p className="text-caption text-ink">
                {describeDisposal(preview.result, {
                  symbol: holding.security.symbol,
                  quantity1e8: quantity,
                  cashAccountName: cash.name,
                  format: (a) => money.format(a),
                  formatDate: (iso) => describeDate(iso, locale),
                })}
              </p>
              <p className="text-caption text-ink-3">
                {describeBudgetEffect(preview.result.totalProceeds, (a) => money.format(a))}
              </p>
              {preview.result.relieved.length > 1 && (
                <ul className="flex flex-col gap-1 pt-1">
                  {preview.result.relieved.map((relief) => (
                    <li key={relief.lotId} className="text-micro text-ink-3">
                      {formatQuantity(relief.quantity1e8)} bought{' '}
                      {describeDate(relief.acquiredDate, locale)} · cost{' '}
                      {money.format(relief.costBasisMinor)}
                      {relief.closes ? ' · all of them' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-caption text-ink-2">
              Enter how many shares you sold and this will say exactly what it will record,
              including which of your shares go and what that means for tax.
            </p>
          )}
        </div>
      </div>
    <div className="flex justify-end pb-1">
        <Explain topic="selling" label="which units you sold" onOpen={explain.open} />
      </div>
      {explain.sheet}
      
      </BottomSheet>
  );
}

/* --- preview -------------------------------------------------------------- */

function previewSale(input: {
  lots: ReturnType<typeof relieveLotsFIFO>['updatedLots'];
  holding: Holding;
  quantity: number;
  price: Minor;
  fee: Minor;
}): { result: ReturnType<typeof relieveLotsFIFO>; error?: string } | null {
  if (input.quantity <= 0) return null;

  // A holding recorded before parcels existed has none. The preview stands in
  // a single parcel for it so the figures are still shown, and the repository
  // writes the same one when the sale is actually recorded.
  const lots =
    input.lots.length > 0
      ? input.lots
      : [
          {
            id: 'pending',
            accountId: input.holding.accountId,
            securityId: input.holding.security.id,
            holdingId: input.holding.id,
            acquiredDate: input.holding.pricedOn ?? '1970-01-01',
            quantity1e8: input.holding.quantity1e8,
            remainingQuantity1e8: input.holding.quantity1e8,
            costBasisMinor: input.holding.costBasis,
            isClosed: false,
          },
        ];

  try {
    return {
      result: relieveLotsFIFO({
        lots,
        sellQuantity1e8: input.quantity,
        salePriceMinor: input.price,
        feesMinor: input.fee,
      }),
    };
  } catch (error) {
    return {
      result: {
        updatedLots: [],
        relieved: [],
        totalProceeds: minor(0),
        totalCostBasisRelieved: minor(0),
        realizedGain: minor(0),
        feesMinor: minor(0),
      },
      error: error instanceof Error ? error.message : 'That does not look right.',
    };
  }
}

function safeQuantity(input: string): number {
  try {
    return parseQuantity(input);
  } catch {
    return 0;
  }
}

function safeAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

/** Re-exported so the detail sheet can render the same figures. */
export type { LedgerAccount };
