/* ===========================================================================
 * A PAYOUT
 * ---------------------------------------------------------------------------
 * The case people leave out is the reinvested one, because nothing appeared in
 * the bank. It is still income, it was still taxable, and skipping it
 * understates a year's earnings by everything a growth portfolio produced. So
 * the sheet asks which it was rather than assuming cash, and says plainly what
 * each choice does to what is safe to spend.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import { formatQuantity, parseQuantity, type Holding } from '@/core/investments';
import { recordDividend } from '@/data/repositories/investmentsRepo';
import { useAccounts } from '@/app/ledger/useLedger';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Input, Select } from '@/design/ui';

export function RecordDividendSheet({
  holding,
  onClose,
}: {
  holding: Holding | null;
  onClose: () => void;
}) {
  const money = useMoney();
  const accounts = useAccounts();

  const [reinvested, setReinvested] = useState(false);
  const [grossText, setGrossText] = useState('');
  const [taxText, setTaxText] = useState('');
  const [sharesText, setSharesText] = useState('');
  const [cashId, setCashId] = useState('');
  const [busy, setBusy] = useState(false);

  const cashAccounts = (accounts.data ?? []).filter(
    (a) => !a.archivedAt && a.type === 'ASSET' && a.onBudget && a.liquid,
  );

  useEffect(() => {
    if (!holding) return;
    setGrossText('');
    setTaxText('');
    setSharesText('');
    setReinvested(false);
  }, [holding]);

  useEffect(() => {
    if (!cashId && cashAccounts[0]) setCashId(cashAccounts[0].id);
  }, [cashId, cashAccounts]);

  if (!holding) {
    return <BottomSheet open={false} onClose={onClose} children={null} />;
  }

  const gross = safeAmount(grossText);
  const tax = safeAmount(taxText);
  const net = Math.max(0, gross - tax);
  const bought = safeQuantity(sharesText);
  const cash = cashAccounts.find((a) => a.id === cashId);

  const tooMuchTax = tax > gross && gross > 0;
  const ready = gross > 0 && !tooMuchTax && Boolean(cash) && (!reinvested || bought > 0);

  async function save() {
    if (!holding || !cash) return;
    setBusy(true);
    try {
      await recordDividend({
        accountId: holding.accountId as AccountId,
        securityId: holding.security.id,
        cashAccountId: cash.id,
        grossAmount: minor(gross),
        ...(tax > 0 ? { taxWithheld: minor(tax) } : {}),
        isReinvested: reinvested,
        ...(reinvested ? { quantityBought1e8: bought } : {}),
      });

      toast(
        reinvested
          ? `${holding.security.symbol} paid ${money.format(minor(gross))}, which bought ` +
              `${formatQuantity(bought)} more shares.`
          : `${holding.security.symbol} paid ${money.format(minor(gross))}. ` +
              `${money.format(minor(net))} is waiting to be given a job.`,
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
      open
      onClose={onClose}
      size="tall"
      title={`${holding.security.symbol} paid out`}
      description="Money a holding pays you is income, whether it reaches your bank or not."
      footer={
        <Button variant="primary" block disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Recording…' : 'Record this payout'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {/* --- cash or more shares -------------------------------------- */}
        <div className="flex gap-2">
          <Choice
            label="Into my bank"
            detail="It arrived as cash."
            chosen={!reinvested}
            onChoose={() => setReinvested(false)}
          />
          <Choice
            label="Bought more shares"
            detail="It never left the account."
            chosen={reinvested}
            onChoose={() => setReinvested(true)}
          />
        </div>

        <Input
          label="How much was paid"
          value={grossText}
          onChange={(e) => setGrossText(e.target.value)}
          placeholder="42.50"
          inputMode="decimal"
          hint="The full amount declared, before any tax was taken off it."
        />

        <Input
          label="Tax taken off"
          value={taxText}
          onChange={(e) => setTaxText(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          hint="Withholding tax, if any was deducted at source."
          {...(tooMuchTax
            ? { error: 'More tax than the dividend was worth — check the two figures.' }
            : {})}
        />

        {reinvested ? (
          <Input
            label="Shares it bought"
            value={sharesText}
            onChange={(e) => setSharesText(e.target.value)}
            placeholder="0.3421"
            inputMode="decimal"
            hint="Usually a fraction. Your statement will say exactly how many."
          />
        ) : (
          <Select
            label="Which account it landed in"
            value={cashId}
            onChange={(e) => setCashId(e.target.value)}
            options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
            emptyLabel="No everyday accounts yet"
          />
        )}

        {/* --- what this will do ---------------------------------------- */}
        <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3.5 py-3">
          <p className="text-caption text-ink-2">
            {gross <= 0
              ? 'Enter how much was paid and this will say what it will record.'
              : reinvested
                ? `${money.format(minor(gross))} counts as income, and ` +
                  `${money.format(minor(net))} of it bought more ${holding.security.symbol}.`
                : `${money.format(minor(gross))} counts as income, and ` +
                  `${money.format(minor(net))} arrives in your ${cash?.name ?? 'account'}.`}
          </p>
          <p className="text-caption text-ink-3">
            {reinvested
              ? 'What is safe to spend will not change, because none of it became cash you ' +
                'could spend. It is income all the same, which is the part most people miss.'
              : `The ${money.format(minor(net))} becomes money waiting to be given a job, so ` +
                `what is safe to spend goes up by that much.`}
            {tax > 0
              ? ` The ${money.format(minor(tax))} of tax is recorded too, so you can see what ` +
                `was taken before it reached you.`
              : ''}
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

function Choice({
  label,
  detail,
  chosen,
  onChoose,
}: {
  label: string;
  detail: string;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={`flex flex-1 flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors ${
        chosen ? 'border-liquid bg-liquid-wash/40' : 'border-line bg-raised hover:border-line-strong'
      }`}
    >
      <span className={`text-body ${chosen ? 'text-liquid' : 'text-ink'}`}>{label}</span>
      <span className="text-micro text-ink-3">{detail}</span>
    </button>
  );
}

function safeAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

function safeQuantity(input: string): number {
  try {
    return parseQuantity(input);
  } catch {
    return 0;
  }
}

export type { Minor };
