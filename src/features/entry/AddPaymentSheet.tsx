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
import { isoDate, type AccountId } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import { ACCOUNT_IDS } from '@/data/seed';
import { CLAIM_KIND_LABELS, type ClaimKind } from '@/data/repositories/claimsRepo';
import { recordFronted, recordSpend, recordSplitSpend, voidEntry } from '@/app/ledger/actions';
import { useCategoryPicker } from '@/app/taxonomy/useTaxonomy';
import { saveRule } from '@/data/repositories/rulesRepo';
import { AlwaysFileToggle, CategoryPicker } from '@/features/categories/CategoryPicker';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { AmountInput, BottomSheet, Button, Money } from '@/design/ui';
import {
  SplitEditor,
  allocated,
  newDraftLine,
  toSplitLines,
  type DraftLine,
} from './SplitEditor';

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
  const [when, setWhen] = useState(() => toIsoDate(new Date()));
  const [note, setNote] = useState('');
  const [alwaysFile, setAlwaysFile] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitLines, setSplitLines] = useState<DraftLine[]>([]);
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
    setWhen(toIsoDate(new Date()));
    setNote('');
    setAlwaysFile(false);
    setSplitting(false);
    setSplitLines([]);
    setFronted(false);
    setClaimKind('work_expense');
    setOwedBy('');
    setProblem(null);
    setSaving(false);
  }, [open]);

  const picker = useCategoryPicker();
  const category = categoryId ? (picker.byId.get(categoryId) ?? null) : null;
  const canContinue = amount > 0;
  // A split is only saveable when every last unit is accounted for. Letting a
  // remainder through would post a payment whose parts do not add up to it.
  const splitExact = splitting && allocated(splitLines) === amount && amount > 0;
  const splitReady = toSplitLines(splitLines, picker.byId).length >= 2;
  const canSave =
    canContinue &&
    !saving &&
    (fronted
      ? owedBy.trim().length > 0
      : splitting
        ? splitExact && splitReady
        : category !== null);

  async function save() {
    if (amount <= 0) return;
    setSaving(true);
    setProblem(null);

    const method = PAYMENT_METHODS.find((m) => m.key === paidWith)!;
    // How this is funded is not ours to decide any more: it follows from the
    // account, worked out once in the ledger actions. Saying it twice is how
    // imported card spending came to be recorded as cash.
    const date = isoDate(when);

    try {
      if (fronted) {
        await recordFronted({
          amount,
          paidFrom: method.accountId,
          counterparty: owedBy.trim(),
          kind: claimKind,
          date,
          ...(note.trim() ? { memo: note.trim() } : {}),
          ...(payee.trim() ? { note: `Paid ${payee.trim()}` } : {}),
        });
        toast(
          `Saved. ${money.format(amount)} is down as money ${owedBy.trim()} owes you, so it is ` +
            `not counted as your spending.`,
        );
        onClose();
        return;
      }

      if (splitting) {
        const lines = toSplitLines(splitLines, picker.byId);
        const id = await recordSplitSpend({
          lines,
          paidFrom: method.accountId,
          date,
          ...(note.trim() ? { memo: note.trim() } : {}),
          ...(payee.trim() ? { payee: payee.trim() } : {}),
        });
        toast(
          `Saved. ${money.format(amount)} split across ${lines.length} ` +
            `categories${paidWith === 'card' ? ', with the money for your card bill set aside' : ''}.`,
          { action: { label: 'Undo', run: () => void undoJustSaved(id) } },
        );
        onClose();
        return;
      }

      if (!category) return;

      const id = await recordSpend({
        amount,
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
        paidFrom: method.accountId,
        date,
        ...(note.trim() ? { memo: note.trim() } : {}),
        ...(payee.trim() ? { payee: payee.trim() } : {}),
      });

      // Offered at the only moment the person actually knows the answer:
      // just after they have made the decision by hand.
      if (alwaysFile && payee.trim()) {
        await saveRule({
          pattern: payee.trim(),
          categoryId: category.categoryId,
          envelopeId: category.envelopeId,
        });
      }

      toast(
        `Saved. You spent ${money.format(amount)} on ${category.name.toLowerCase()}` +
          `${paidWith === 'card' ? ', and the money for your card bill is set aside' : ''}.`,
        {
          action: {
            label: 'Undo',
            run: () => {
              void undoJustSaved(id);
            },
          },
        },
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
            <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
              {splitting ? 'Split across categories' : 'What was it for?'}
            </span>
            {!fronted && (
              <button
                type="button"
                onClick={() => {
                  setSplitting((was) => !was);
                  setSplitLines((lines) =>
                    lines.length >= 2 ? lines : [newDraftLine(), newDraftLine()],
                  );
                }}
                className="text-caption text-liquid"
              >
                {splitting ? 'It was all one thing' : 'Split across categories'}
              </button>
            )}
          </div>

          {splitting && !fronted && (
            <SplitEditor total={amount} lines={splitLines} onChange={setSplitLines} />
          )}

          {!splitting && (
            <div className="flex flex-col gap-3">
              <CategoryPicker
                value={categoryId}
                onChange={setCategoryId}
                merchant={payee}
                onPrediction={(predicted) => {
                  // Only fills a blank. Overwriting a choice somebody has
                  // already made would be the app arguing with them.
                  setCategoryId((current) => current ?? predicted);
                }}
              />
              {category && (
                <AlwaysFileToggle
                  merchant={payee}
                  categoryName={category.name}
                  checked={alwaysFile}
                  onChange={setAlwaysFile}
                />
              )}
            </div>
          )}
            </>
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

          <Field label="Who did you pay? (optional)">
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="The shop or person you paid"
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
            />
          </Field>

          <Field label="When was it?">
            <input
              type="date"
              value={when}
              max={toIsoDate(new Date())}
              onChange={(e) => setWhen(e.target.value || toIsoDate(new Date()))}
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink"
            />
            {when !== toIsoDate(new Date()) && (
              <p className="text-caption text-ink-3">
                This will be counted on that day rather than today.
              </p>
            )}
          </Field>

          <Field label="Notes (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything you want to remember about it"
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
            />
          </Field>
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * Undo straight after saving.
 *
 * The entry is not deleted — its mirror image is posted, so both stay in the
 * history and every balance goes back exactly where it was.
 */
async function undoJustSaved(id: Parameters<typeof voidEntry>[0]) {
  try {
    await voidEntry(id);
    toast('Undone. Everything is back where it was.');
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'That could not be undone, so nothing has been changed.',
      { tone: 'attention' },
    );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}
