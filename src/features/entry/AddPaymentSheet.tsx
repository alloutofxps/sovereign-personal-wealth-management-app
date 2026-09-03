/* ===========================================================================
 * ADDING A PAYMENT
 * ---------------------------------------------------------------------------
 * Two steps: how much, then what for and how you paid. Nothing here mentions
 * debits, credits, envelopes or postings — the person is recording that they
 * bought something, and the double entry happens underneath.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import type { AccountId, Funding } from '@/core/ledger';
import { ACCOUNT_IDS, CATEGORIES } from '@/data/seed';
import { CLAIM_KIND_LABELS, type ClaimKind } from '@/data/repositories/claimsRepo';
import { recordFronted, recordSpend } from '@/app/ledger/actions';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { AmountInput, BottomSheet, Button, Money } from '@/design/ui';

type PaidWith = 'everyday' | 'savings' | 'card';

const PAYMENT_METHODS: { key: PaidWith; label: string; accountId: AccountId }[] = [
  { key: 'everyday', label: 'Everyday account', accountId: ACCOUNT_IDS.everyday },
  { key: 'card', label: 'Credit card', accountId: ACCOUNT_IDS.card },
  { key: 'savings', label: 'Savings', accountId: ACCOUNT_IDS.savings },
];

export interface AddPaymentSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AddPaymentSheet({ open, onClose }: AddPaymentSheetProps) {
  const money = useMoney();
  const [step, setStep] = useState<'amount' | 'details'>('amount');
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [categoryId, setCategoryId] = useState<AccountId | null>(null);
  const [paidWith, setPaidWith] = useState<PaidWith>('everyday');
  const [payee, setPayee] = useState('');
  /** Money paid out for somebody else never counts as your spending. */
  const [fronted, setFronted] = useState(false);
  const [claimKind, setClaimKind] = useState<ClaimKind>('work_expense');
  const [owedBy, setOwedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Start clean every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStep('amount');
    setAmount(minor(0));
    setCategoryId(null);
    setPaidWith('everyday');
    setPayee('');
    setFronted(false);
    setClaimKind('work_expense');
    setOwedBy('');
    setProblem(null);
    setSaving(false);
  }, [open]);

  const category = CATEGORIES.find((c) => c.categoryId === categoryId) ?? null;
  const canContinue = amount > 0;
  const canSave =
    canContinue && !saving && (fronted ? owedBy.trim().length > 0 : category !== null);

  async function save() {
    if (amount <= 0) return;
    setSaving(true);
    setProblem(null);

    const method = PAYMENT_METHODS.find((m) => m.key === paidWith)!;
    const funding: Funding =
      paidWith === 'card'
        ? { via: 'card', accountId: method.accountId, paymentEnvelopeId: ACCOUNT_IDS.potCardBill }
        : { via: 'cash', accountId: method.accountId };

    try {
      if (fronted) {
        await recordFronted({
          amount,
          funding,
          counterparty: owedBy.trim(),
          kind: claimKind,
          ...(payee.trim() ? { note: `Paid ${payee.trim()}` } : {}),
        });
        toast(
          `Saved. ${money.format(amount)} is down as money ${owedBy.trim()} owes you, so it is ` +
            `not counted as your spending.`,
        );
        onClose();
        return;
      }

      if (!category) return;

      await recordSpend({
        amount,
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
        funding,
        ...(payee.trim() ? { payee: payee.trim() } : {}),
      });

      toast(
        `Saved. You spent ${money.format(amount)} on ${category.name.toLowerCase()}` +
          `${paidWith === 'card' ? ', and the money for your card bill is set aside' : ''}.`,
      );
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has been changed, so you can try again.',
      );
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={step === 'amount' ? 'How much did you spend?' : 'What was it for?'}
      {...(step === 'details' ? { description: 'You can change any of this later.' } : {})}
      footer={
        step === 'amount' ? (
          <Button variant="primary" block disabled={!canContinue} onClick={() => setStep('details')}>
            Next
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            {problem && (
              <p className="text-caption text-caution" role="alert">
                {problem}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" block onClick={() => setStep('amount')}>
                Back
              </Button>
              <Button variant="primary" block disabled={!canSave} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save it'}
              </Button>
            </div>
          </div>
        )
      }
    >
      {step === 'amount' ? (
        <AmountInput
          value={amount}
          onChange={setAmount}
          onSubmit={() => canContinue && setStep('details')}
          label="Amount"
          hint="Tap the numbers — they fill in from the right."
        />
      ) : (
        <div className="flex flex-col gap-6 pb-2">
          <div className="flex items-baseline justify-between gap-3 rounded-md border border-line bg-raised px-3.5 py-3">
            <span className="text-caption text-ink-2">You spent</span>
            <button
              type="button"
              onClick={() => setStep('amount')}
              className="text-liquid underline-offset-4 hover:underline"
            >
              <Money value={amount} size="lead" tone="neutral" />
            </button>
          </div>

          {/* The toggle that keeps somebody else's costs out of your figures. */}
          <button
            type="button"
            onClick={() => setFronted(!fronted)}
            aria-pressed={fronted}
            className={clsx(
              'flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors',
              fronted
                ? 'border-liquid-dim bg-liquid-wash'
                : 'border-line bg-raised hover:border-line-strong',
            )}
          >
            <span
              className={clsx(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border',
                fronted ? 'border-liquid bg-liquid text-base' : 'border-line-strong',
              )}
              aria-hidden="true"
            >
              {fronted && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m4 12.5 5 5L20 6.5"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span className="min-w-0">
              <span className={clsx('block text-body', fronted ? 'text-liquid' : 'text-ink')}>
                I fronted this for someone else
              </span>
              <span className="block pt-0.5 text-caption text-ink-2">
                A work trip, a dinner you covered, a group booking. It will be kept out of your
                own spending until the money comes back.
              </span>
            </span>
          </button>

          {fronted ? (
            <>
              <Field label="Who will pay you back?">
                <input
                  type="text"
                  value={owedBy}
                  onChange={(e) => setOwedBy(e.target.value)}
                  placeholder="Work, Sam, the group…"
                  className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
                />
              </Field>

              <Field label="What kind of thing was it?">
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(CLAIM_KIND_LABELS) as ClaimKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setClaimKind(k)}
                      aria-pressed={claimKind === k}
                      className={clsx(
                        'rounded-md border px-3 py-2.5 text-left text-body transition-colors',
                        claimKind === k
                          ? 'border-liquid-dim bg-liquid-wash text-liquid'
                          : 'border-line bg-raised text-ink hover:border-line-strong',
                      )}
                    >
                      {CLAIM_KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : (
          <Field label="What was it for?">
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.categoryId}
                  type="button"
                  onClick={() => setCategoryId(c.categoryId)}
                  aria-pressed={categoryId === c.categoryId}
                  className={clsx(
                    'rounded-md border px-3 py-2.5 text-left text-body transition-colors',
                    categoryId === c.categoryId
                      ? 'border-liquid-dim bg-liquid-wash text-liquid'
                      : 'border-line bg-raised text-ink hover:border-line-strong',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </Field>
          )}

          <Field label="How did you pay?">
            <div className="flex flex-col gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setPaidWith(m.key)}
                  aria-pressed={paidWith === m.key}
                  className={clsx(
                    'flex items-center justify-between rounded-md border px-3.5 py-3 text-body transition-colors',
                    paidWith === m.key
                      ? 'border-liquid-dim bg-liquid-wash text-liquid'
                      : 'border-line bg-raised text-ink hover:border-line-strong',
                  )}
                >
                  <span>{m.label}</span>
                  {m.key === 'card' && paidWith === 'card' && (
                    <span className="text-caption text-ink-2">
                      We will set the money aside for the bill
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Field>

          <Field label={fronted ? 'Who did you pay? (optional)' : 'Who did you pay? (optional)'}>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="The shop or person you paid"
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
            />
          </Field>
        </div>
      )}
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}
