/* ===========================================================================
 * MOVING MONEY INTO ANOTHER CURRENCY
 * ---------------------------------------------------------------------------
 * Both amounts are typed, not one and a calculated other. That is deliberate:
 * the bank's rate is never the published one, and a screen that computes what
 * "should" have arrived would be arguing with somebody's statement. What they
 * were actually given is the fact; the difference against the rate on record
 * is the interesting part, and it is shown rather than hidden.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import { recordCrossCurrencyTransfer } from '@/app/investments/actions';
import { useAccounts } from '@/app/ledger/useLedger';
import { useFx } from '@/app/fx/useFx';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Explain, Input, Outcome, Select } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function ConvertCurrencySheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const fx = useFx();
  const accounts = useAccounts();

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [busy, setBusy] = useState(false);

  const live = (accounts.data ?? []).filter(
    (a) => !a.archivedAt && (a.type === 'ASSET' || a.type === 'LIABILITY'),
  );

  useEffect(() => {
    if (!open) return;
    if (!fromId) setFromId(live.find((a) => !fx.isForeign(a.currency))?.id ?? '');
    if (!toId) setToId(live.find((a) => fx.isForeign(a.currency))?.id ?? '');
  }, [open, fromId, toId, live, fx]);

  const from = live.find((a) => a.id === fromId);
  const to = live.find((a) => a.id === toId);

  const fromAmount = safeAmount(fromText);
  const toAmount = safeAmount(toText);

  const fromCurrency = from?.currency ?? fx.baseCurrency;
  const toCurrency = to?.currency ?? fx.baseCurrency;

  // What the rates on record say each side is worth. The gap between them is
  // the bank's spread, which is the figure worth seeing.
  const fromBase = from && fromAmount > 0 ? fx.toBase(minor(fromAmount), fromCurrency) : null;
  const toBase = to && toAmount > 0 ? fx.toBase(minor(toAmount), toCurrency) : null;
  const spread = fromBase !== null && toBase !== null ? fromBase - toBase : null;

  const sameCurrency = Boolean(from && to && fromCurrency === toCurrency);
  const ready = Boolean(from && to && fromAmount > 0 && toAmount > 0 && !sameCurrency);

  /*
   * The two sides in the reporting currency, so the example can name the
   * spread as an amount rather than as "whatever the bank kept".
   *
   * Both have to convert for the pair to mean anything: comparing dollars
   * against euros would print a difference that is only the exchange rate
   * wearing a disguise.
   */
  const explain = useExplain(
    fromBase !== null && toBase !== null
      ? { transferOut: minor(fromBase), transferIn: minor(toBase) }
      : {},
  );

  async function save() {
    if (!from || !to) return;
    setBusy(true);
    try {
      await recordCrossCurrencyTransfer({
        fromAccountId: from.id as AccountId,
        toAccountId: to.id as AccountId,
        fromAmount: minor(fromAmount),
        toAmount: minor(toAmount),
      });
      toast(
        `${fx.formatIn(minor(fromAmount), fromCurrency)} from ${from.name} became ` +
          `${fx.formatIn(minor(toAmount), toCurrency)} in ${to.name}.`,
      );
      setFromText('');
      setToText('');
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
      title="Convert between currencies"
      description="Both amounts, as your statements say them."
      footer={
        <Button variant="primary" block disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Recording…' : 'Record it'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Select
          label="From"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          options={live.map((a) => ({
            value: a.id,
            label: `${a.name} · ${a.currency ?? fx.baseCurrency}`,
          }))}
          emptyLabel="No accounts yet"
        />

        <Input
          label={`How much left, in ${fromCurrency}`}
          value={fromText}
          onChange={(e) => setFromText(e.target.value)}
          placeholder="1000.00"
          inputMode="decimal"
        />

        <Select
          label="Into"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          options={live.map((a) => ({
            value: a.id,
            label: `${a.name} · ${a.currency ?? fx.baseCurrency}`,
          }))}
          emptyLabel="No accounts yet"
          {...(sameCurrency
            ? { error: 'Both accounts are in the same currency, so nothing is being converted.' }
            : {})}
        />

        <Input
          label={`How much arrived, in ${toCurrency}`}
          value={toText}
          onChange={(e) => setToText(e.target.value)}
          placeholder="1080.00"
          inputMode="decimal"
          hint="Exactly what your statement says, not what the rate suggests it should have been."
        />

        {/* --- what this will do --------------------------------------- */}
        <Outcome>
          <p className="text-caption text-ink-2">
            {ready && from && to
              ? `${fx.formatIn(minor(fromAmount), fromCurrency)} will leave ${from.name} and ` +
                `${fx.formatIn(minor(toAmount), toCurrency)} will arrive in ${to.name}.`
              : 'Pick both accounts and type both amounts.'}
          </p>

          {spread !== null && spread !== 0 && (
            <p className="text-caption text-ink-2">
              {spread > 0
                ? `About ${fx.formatIn(minor(spread), fx.baseCurrency)} less arrived than the ` +
                  `rates on record would suggest: the bank's spread. It is recorded as a cost, ` +
                  `not as spending.`
                : `About ${fx.formatIn(minor(-spread), fx.baseCurrency)} more arrived than the ` +
                  `rates on record would suggest, which usually means a rate here is out of date.`}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <p className="text-caption text-ink-3">Neither earned nor spent.</p>
            <Explain topic="transfers" label="moving money about" onOpen={explain.open} />
          </div>
        </Outcome>
      </div>
      {explain.sheet}
    </BottomSheet>
  );
}

function safeAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

export type { LedgerAccount, Minor };
