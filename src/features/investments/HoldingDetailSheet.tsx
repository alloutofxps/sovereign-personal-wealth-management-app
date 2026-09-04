/* ===========================================================================
 * ONE HOLDING, IN FULL
 * ---------------------------------------------------------------------------
 * What it is worth, what it cost, what it has done, and what it charges. The
 * expense ratio is editable here rather than buried in settings, because it is
 * the number most people have never looked up and the whole fee card is built
 * on it — a portfolio where nobody has filled it in shows a drag of nothing,
 * which is the one wrong answer.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { basisPoints, minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import { rate1e6, type Rate1e6 } from '@/core/money/fx';
// Deep import on purpose: see the note in the money barrel.
import {
  decomposeInvestmentReturn,
  describeDecomposition,
  formatReturnBp,
} from '@/core/money/fxReturns';
import {
  ASSET_CLASS_NAMES,
  formatExpenseRatio,
  formatQuantity,
  formatReturn,
  valueOf,
  type Holding,
} from '@/core/investments';
import {
  INVESTMENT_TABLES,
  priceHistory,
  removeHolding,
  updatePrices,
  updateSecurity,
} from '@/data/repositories/investmentsRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useFx } from '@/app/fx/useFx';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Input, Money } from '@/design/ui';

export function HoldingDetailSheet({
  holding,
  onClose,
  onSell,
  onDividend,
}: {
  holding: Holding | null;
  onClose: () => void;
  onSell: () => void;
  onDividend: () => void;
}) {
  const money = useMoney();
  const fx = useFx();
  const locale = useAppConfig((s) => s.locale);

  const [priceText, setPriceText] = useState('');
  const [feeText, setFeeText] = useState('');
  const [busy, setBusy] = useState(false);

  const securityId = holding?.security.id ?? null;

  const history = useLiveQuery(
    useCallback(async () => (securityId ? priceHistory(securityId, 8) : []), [securityId]),
    INVESTMENT_TABLES,
  );

  useEffect(() => {
    if (!holding) return;
    setPriceText((holding.priceMinor / 100).toFixed(2));
    setFeeText((holding.security.expenseRatioBp / 100).toFixed(2));
  }, [holding]);

  if (!holding) {
    return <BottomSheet open={false} onClose={onClose} children={null} />;
  }

  const value = valueOf(holding);

  // The split only means anything when there is a rate on both ends: what the
  // currency was doing when it was bought, and what it is doing now. Without
  // the first there is nothing to compare against, so nothing is shown rather
  // than a figure resting on an assumed rate.
  const currency = holding.security.currency;
  const foreign = fx.isForeign(currency);
  /** Amounts about this holding, in the currency it is actually quoted in. */
  const show = (amount: Minor) =>
    foreign ? fx.formatIn(amount, currency) : money.format(amount);
  const approx = foreign ? fx.approxInBase(value.marketValue, currency) : null;
  const currentRate = fx.rates.get(currency)?.rateScaled ?? null;
  const purchaseRate = holding.purchaseRateScaled ?? null;

  const split =
    foreign && currentRate !== null && purchaseRate !== null && holding.costBasis > 0
      ? decomposeInvestmentReturn({
          // Per-share cost against the current price, so the split is about
          // the security rather than about how much of it was bought.
          initialNativePrice: perShareCost(holding),
          initialRateScaled: rate1e6(purchaseRate) as Rate1e6,
          currentNativePrice: holding.priceMinor,
          currentRateScaled: currentRate as Rate1e6,
        })
      : null;

  const newPrice = toMinor(priceText);
  const newFeeBp = toBp(feeText);

  const priceChanged = newPrice !== null && newPrice !== holding.priceMinor;
  const feeChanged = newFeeBp !== null && newFeeBp !== holding.security.expenseRatioBp;

  async function save() {
    if (!holding) return;
    setBusy(true);
    try {
      if (feeChanged && newFeeBp !== null) {
        await updateSecurity(holding.security.id, { expenseRatioBp: basisPoints(newFeeBp) });
      }
      if (priceChanged && newPrice !== null) {
        await updatePrices([{ securityId: holding.security.id, priceMinor: newPrice }]);
      }
      toast(
        priceChanged
          ? `${holding.security.symbol} is now recorded at ${money.format(newPrice!)} a share.`
          : `${holding.security.symbol} updated.`,
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be saved.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  async function remove() {
    if (!holding) return;
    setBusy(true);
    try {
      await removeHolding(holding.id, holding.accountId as AccountId);
      toast(
        `${holding.security.symbol} is no longer recorded as held. The prices you entered ` +
          `for it are kept.`,
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be removed.', {
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
      title={holding.security.name}
      description={`${holding.security.symbol} · ${ASSET_CLASS_NAMES[holding.security.assetClass]}`}
      footer={
        <Button
          variant="primary"
          block
          disabled={busy || (!priceChanged && !feeChanged)}
          onClick={() => void save()}
        >
          {busy
            ? 'Saving…'
            : !priceChanged && !feeChanged
              ? 'Nothing has changed yet'
              : 'Save these changes'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {/* --- what it is worth ---------------------------------------- */}
        <Card>
          <div className="flex flex-col gap-2">
            {/* A dollar holding reads in dollars. Its statement says dollars,
                and converting it silently would leave the person unable to
                check this screen against that one. */}
            {foreign ? (
              <span className="tnum text-figure text-ink">{show(value.marketValue)}</span>
            ) : (
              <Money value={value.marketValue} size="figure" />
            )}
            {approx && <p className="tnum text-caption text-ink-3">{approx}</p>}
            <p className="text-caption text-ink-2">
              {formatQuantity(holding.quantity1e8)} shares at {show(holding.priceMinor)}
              {holding.pricedOn ? `, priced ${describeDate(holding.pricedOn, locale)}` : ''}.
            </p>
            <p className="text-caption text-ink-2">
              It cost {show(holding.costBasis)}, so it is{' '}
              {value.gainLoss === 0
                ? 'exactly where it started'
                : `${value.gainLoss > 0 ? 'up' : 'down'} ${show(minor(Math.abs(value.gainLoss)))} (${formatReturn(value.returnBp)})`}
              .
            </p>
          </div>
        </Card>

        {/* --- was it the fund, or was it the currency? ---------------- */}
        {foreign && split && (
          <Card label="Where the return came from">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Split label="The holding" value={formatReturnBp(split.assetReturnBp)} />
                <Split label={holding.security.currency} value={formatReturnBp(split.fxReturnBp)} />
                <Split
                  label={`In ${fx.baseCurrency}`}
                  value={formatReturnBp(split.totalBaseReturnBp)}
                  emphasis
                />
              </div>
              <p className="text-caption text-ink-2">
                {describeDecomposition(split, {
                  quoteCurrency: holding.security.currency,
                  baseCurrency: fx.baseCurrency,
                })}
              </p>
              {split.interactionBp !== 0 && (
                <p className="text-caption text-ink-3">
                  The three do not simply add up, and that is not a rounding error: a currency
                  move applies to the gain as well as to what you originally put in. That
                  overlap comes to {formatReturnBp(split.interactionBp)}.
                </p>
              )}
            </div>
          </Card>
        )}

        {/* --- the two things you can do with a holding ---------------- */}
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onSell}>
            Sell shares
          </Button>
          <Button variant="secondary" block onClick={onDividend}>
            Record a payout
          </Button>
        </div>

        <Input
          label="Price per share"
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          inputMode="decimal"
          hint={
            foreign
              ? `In ${currency}, as your statement quotes it. Recording a new price changes ` +
                `what the account is worth, and nothing else.`
              : 'Recording a new price changes what the account is worth, and nothing else.'
          }
        />

        <Input
          label="Yearly fee"
          value={feeText}
          onChange={(e) => setFeeText(e.target.value)}
          inputMode="decimal"
          hint={
            holding.security.expenseRatioBp === 0
              ? 'Not recorded yet. It is on the fund’s factsheet, usually as "ongoing charge".'
              : `Currently ${formatExpenseRatio(holding.security.expenseRatioBp)} a year. This applies wherever you hold it.`
          }
        />

        {/* --- what it has been priced at ------------------------------ */}
        {(history.data ?? []).length > 1 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">
              What it has been priced at
            </h3>
            <Card padding="none">
              <ul className="divide-y divide-line-faint">
                {(history.data ?? []).map((mark, index) => (
                  <li
                    key={`${mark.date}-${index}`}
                    className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="text-caption text-ink-2">
                      {describeDate(mark.date, locale)}
                      {mark.source === 'csv' ? ' · pasted' : ''}
                    </span>
                    {foreign ? (
                      <span className="tnum text-caption text-ink">
                        {show(mark.priceMinor)}
                      </span>
                    ) : (
                      <Money value={mark.priceMinor} size="caption" />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <div className="pt-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
            {busy ? 'Removing…' : 'I no longer hold this'}
          </Button>
          <p className="pt-1.5 text-caption text-ink-3">
            The account will be brought back into line with what is left in it.
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

/** One share's worth of what the whole position cost. */
function perShareCost(holding: Holding): Minor {
  return minor(
    Math.round((holding.costBasis * 100_000_000) / Math.max(1, holding.quantity1e8)),
  );
}

function Split({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-raised px-3 py-2.5">
      <span className="truncate text-micro uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <span
        className={`tnum text-caption ${emphasis ? 'font-medium text-ink' : 'text-ink-2'}`}
      >
        {value}
      </span>
    </div>
  );
}

function toMinor(input: string): Minor | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '.') return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return minor(Number(`${whole || '0'}${fraction.padEnd(2, '0')}`));
}

function toBp(input: string): number | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '.') return null;
  return Math.round(Number(cleaned) * 100);
}
