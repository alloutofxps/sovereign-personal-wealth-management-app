/* ===========================================================================
 * THE TERMS OF A LOAN
 * ---------------------------------------------------------------------------
 * Everything here is copied off one page of a loan agreement, and the fields
 * are in the order that page tends to put them. Nothing is fetched and nothing
 * is inferred: a rate the app guessed at would produce a split that looked
 * authoritative and was wrong, which is worse than no split at all.
 *
 * Only two of these are needed for the arithmetic — the rate and the monthly
 * payment. The rest make the sentences better: what was borrowed turns "still
 * owed" into progress, and the term turns a payoff date into a comparison.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { basisPoints, bpFromPercent, bpToPercent, minor, type Minor } from '@/core/money';
import { saveLoanTerms, type Loan } from '@/data/repositories/loansRepo';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Input, Select } from '@/design/ui';

export function LoanTermsSheet({
  loan,
  onClose,
}: {
  loan: Loan | null;
  onClose: () => void;
}) {
  const [rateText, setRateText] = useState('');
  const [paymentText, setPaymentText] = useState('');
  const [escrowText, setEscrowText] = useState('');
  const [principalText, setPrincipalText] = useState('');
  const [termText, setTermText] = useState('');
  const [startDate, setStartDate] = useState('');
  const [interestType, setInterestType] = useState<'fixed' | 'variable'>('fixed');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loan) return;
    setRateText(loan.aprBp > 0 ? bpToPercent(loan.aprBp).toFixed(2) : '');
    setPaymentText(loan.monthlyPayment ? toText(loan.monthlyPayment) : '');
    setEscrowText(loan.escrowMonthly > 0 ? toText(loan.escrowMonthly) : '');
    setPrincipalText(loan.originalPrincipal ? toText(loan.originalPrincipal) : '');
    setTermText(loan.termMonths ? String(loan.termMonths) : '');
    setStartDate(loan.startDate ?? '');
    setInterestType(loan.interestType);
  }, [loan]);

  const rate = parseRate(rateText);
  const payment = minor(parseAmount(paymentText));
  const ready = rate.ok && payment > 0;

  async function save() {
    if (!loan || !rate.ok) return;
    setBusy(true);
    try {
      await saveLoanTerms({
        accountId: loan.account.id,
        aprBp: basisPoints(rate.bp),
        monthlyPayment: payment,
        escrowMonthly: minor(parseAmount(escrowText)),
        originalPrincipal: principalText.trim() ? minor(parseAmount(principalText)) : null,
        termMonths: termText.trim() ? Number(termText) : null,
        startDate: startDate.trim() ? startDate : null,
        interestType,
      });
      toast(`Saved. ${loan.account.name} can now be split into what it repays and what it costs.`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Those terms could not be saved.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={loan !== null}
      onClose={onClose}
      size="tall"
      title={loan ? `The terms of ${loan.account.name}` : 'Loan terms'}
      description="Copy these off your loan agreement. Nothing here is looked up or guessed at."
      footer={
        <Button variant="primary" block disabled={busy || !ready} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save these terms'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="Interest rate a year"
          value={rateText}
          onChange={(e) => setRateText(e.target.value)}
          inputMode="decimal"
          placeholder="4.00"
          hint="As a percentage, the way your agreement writes it."
          {...(rate.ok ? {} : { error: rate.why })}
        />

        <Select
          label="Is that rate fixed?"
          value={interestType}
          onChange={(e) => setInterestType(e.target.value as 'fixed' | 'variable')}
          options={[
            { value: 'fixed', label: 'Fixed for the whole term' },
            { value: 'variable', label: 'It can change' },
          ]}
        />

        <Input
          label="Monthly payment"
          value={paymentText}
          onChange={(e) => setPaymentText(e.target.value)}
          inputMode="decimal"
          placeholder="954.83"
          hint="Just the loan part. Anything held for tax and insurance goes below."
        />

        <Input
          label="Held each month for tax and insurance"
          value={escrowText}
          onChange={(e) => setEscrowText(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          hint="Leave this at nothing unless your lender collects it with the payment."
        />

        <Input
          label="What you originally borrowed"
          value={principalText}
          onChange={(e) => setPrincipalText(e.target.value)}
          inputMode="decimal"
          placeholder="200000.00"
          hint="Optional. It is what turns what is left into how far you have come."
        />

        <div className="flex gap-3">
          <span className="flex-1">
            <Input
              label="How many months in total"
              value={termText}
              onChange={(e) => setTermText(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="360"
            />
          </span>
          <span className="flex-1">
            <Input
              type="date"
              label="Next payment due"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </span>
        </div>

        <p className="text-caption text-ink-3">
          {interestType === 'variable'
            ? 'Because the rate can change, the schedule below is what would happen if it stayed where it is. Come back and change it when your lender does.'
            : 'These stay on this device, like everything else here.'}
        </p>
      </div>
    </BottomSheet>
  );
}

function parseRate(input: string): { ok: true; bp: number } | { ok: false; why: string } {
  if (input.trim() === '') return { ok: true, bp: 0 };
  const value = Number(input.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false, why: 'A rate should be somewhere between 0 and 100.' };
  }
  try {
    return { ok: true, bp: bpFromPercent(value) as number };
  } catch {
    return { ok: false, why: 'Rates are kept to two decimal places, like 4.25.' };
  }
}

function parseAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

function toText(amount: Minor): string {
  return (amount / 100).toFixed(2);
}
