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
import {
  recordFronted,
  recordIncome,
  recordSpend,
  recordSplitSpend,
  recordTransfer,
  voidEntry,
} from '@/app/ledger/actions';
import { useAccounts } from '@/app/ledger/useLedger';
import { useCategoryPicker } from '@/app/taxonomy/useTaxonomy';
import { saveRule } from '@/data/repositories/rulesRepo';
import { AlwaysFileToggle, CategoryPicker } from '@/features/categories/CategoryPicker';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import {
  AmountInput,
  BottomSheet,
  Button,
  Explain,
  Input,
  Money,
  Outcome,
  Select,
} from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';
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

/** The three things somebody can record here. */
type EntryFlow = 'payment' | 'income' | 'transfer';

const FLOW_LABELS: Record<EntryFlow, string> = {
  payment: 'Payment',
  income: 'Money in',
  transfer: 'Transfer',
};

export function AddPaymentSheet({ open, onClose }: AddPaymentSheetProps) {
  const money = useMoney();
  const [kind, setKind] = useState<EntryFlow>('payment');
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

  // Income and transfers
  const [sourceId, setSourceId] = useState<AccountId>(ACCOUNT_IDS.salary);
  const [intoId, setIntoId] = useState<AccountId>(ACCOUNT_IDS.everyday);
  const [payer, setPayer] = useState('');
  const [fromId, setFromId] = useState<AccountId>(ACCOUNT_IDS.everyday);
  const [toId, setToId] = useState<AccountId>(ACCOUNT_IDS.savings);

  /*
   * The amount typed so far is the figure both of these explanations want.
   *
   * A transfer between two accounts in one currency arrives whole, so out and
   * in are the same number and the worked example says the honest thing: it
   * moved, nothing was kept. `ConvertCurrencySheet` is where they differ, and
   * that sheet passes its own pair.
   */
  const explain = useExplain(
    amount > 0
      ? kind === 'transfer'
        ? { transferOut: amount, transferIn: amount }
        : fronted
          ? { claimOutstanding: amount }
          : {}
      : {},
  );

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
    setKind('payment');
    setPayer('');
    setSourceId(ACCOUNT_IDS.salary);
    setIntoId(ACCOUNT_IDS.everyday);
    setFromId(ACCOUNT_IDS.everyday);
    setToId(ACCOUNT_IDS.savings);
  }, [open]);

  const accounts = useAccounts();
  const live = (accounts.data ?? []).filter((a) => !a.archivedAt);
  const cashAccounts = live.filter((a) => a.type === 'ASSET');
  const incomeSources = live.filter((a) => a.type === 'INCOME');

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

  const intoAccount = live.find((a) => a.id === intoId) ?? null;

  /**
   * Whether the button is live, for whichever of the three this is.
   *
   * Each kind answers a different question, so one flag cannot cover all
   * three: a payment needs a category, income needs somewhere to land, and a
   * transfer needs two accounts that are not the same one.
   */
  const canSaveNow =
    kind === 'payment'
      ? canSave
      : kind === 'income'
        ? canContinue && !saving && intoAccount !== null
        : canContinue && !saving && fromId !== toId;

  async function saveIncome() {
    setSaving(true);
    setProblem(null);
    try {
      await recordIncome({
        amount,
        sourceId,
        intoAccountId: intoId,
        payer: payer.trim() || 'somewhere',
        date: isoDate(when),
        ...(note.trim() ? { memo: note.trim() } : {}),
      });
      toast(`${money.format(amount)} in from ${payer.trim() || 'somewhere'}.`);
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be recorded.');
    }
    setSaving(false);
  }

  async function saveTransfer() {
    setSaving(true);
    setProblem(null);
    try {
      await recordTransfer({
        amount,
        fromAccountId: fromId,
        toAccountId: toId,
        date: isoDate(when),
        ...(note.trim() ? { memo: note.trim() } : {}),
      });
      toast(`${money.format(amount)} moved.`);
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be recorded.');
    }
    setSaving(false);
  }

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
      title={
        step === 'amount'
          ? kind === 'payment'
            ? 'How much did you spend?'
            : kind === 'income'
              ? 'How much came in?'
              : 'How much are you moving?'
          : kind === 'payment'
            ? 'What was it for?'
            : kind === 'income'
              ? 'Where did it come from?'
              : 'Between which accounts?'
      }
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
              <Button
                variant="primary"
                block
                disabled={!canSaveNow}
                onClick={() =>
                  void (kind === 'income'
                    ? saveIncome()
                    : kind === 'transfer'
                      ? saveTransfer()
                      : save())
                }
              >
                {saving ? 'Saving…' : 'Save it'}
              </Button>
            </div>
          </div>
        )
      }
    >
      {step === 'amount' ? (
        <div className="flex flex-col gap-4">
          {/* Three things happen to money and only one of them was recordable
              here. Money coming in had no path at all, which left the home
              screen asking about income the app could not be told about. */}
          <div
            role="tablist"
            aria-label="What kind of thing is this"
            className="flex gap-1 rounded-md border border-line bg-sunken p-1"
          >
            {(['payment', 'income', 'transfer'] as EntryFlow[]).map((flow) => (
              <button
                key={flow}
                role="tab"
                type="button"
                aria-selected={kind === flow}
                onClick={() => setKind(flow)}
                className={clsx(
                  'flex-1 rounded-sm px-3 py-2 text-caption font-medium transition-colors',
                  kind === flow
                    ? 'bg-raised text-ink'
                    : 'text-ink-3 [@media(hover:hover)]:hover:text-ink-2',
                )}
              >
                {FLOW_LABELS[flow]}
              </button>
            ))}
          </div>

          <AmountInput
            value={amount}
            onChange={setAmount}
            onSubmit={() => canContinue && setStep('details')}
            label="Amount"
            allowMath
            hint="Tap the numbers. They fill in from the right. Split a bill with ÷."
          />
        </div>
      ) : kind === 'income' ? (
        <div className="flex flex-col gap-4 pb-2">
          <Outcome className="flex-row items-baseline justify-between">
            <span className="text-caption text-ink-2">Money in</span>
            <Money value={amount} size="lead" tone="liquid" />
          </Outcome>

          <Input
            label="Who paid you"
            value={payer}
            onChange={(e) => setPayer(e.target.value)}
            placeholder="Work, a client, the tax office"
          />

          <Select
            label="What kind of money"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value as AccountId)}
            options={incomeSources.map((a) => ({ value: a.id, label: a.name }))}
            emptyLabel="No income kinds set up"
          />

          <Select
            label="Where it landed"
            value={intoId}
            onChange={(e) => setIntoId(e.target.value as AccountId)}
            options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
            emptyLabel="No accounts yet"
          />

          <Input
            type="date"
            label="When"
            value={when}
            onChange={(e) => e.target.value && setWhen(e.target.value)}
          />

          <p className="text-caption text-ink-3">
            {intoAccount && intoAccount.onBudget && intoAccount.liquid
              ? 'This arrives without a job. It will sit in what is waiting to be given one, ' +
                'until you decide what it is for.'
              : 'This lands somewhere you do not spend from, so it raises what you are worth ' +
                'without changing what is safe to spend.'}
          </p>
        </div>
      ) : kind === 'transfer' ? (
        <div className="flex flex-col gap-4 pb-2">
          <Outcome className="flex-row items-baseline justify-between">
            <span className="text-caption text-ink-2">Moving</span>
            <Money value={amount} size="lead" />
          </Outcome>

          <Select
            label="Out of"
            value={fromId}
            onChange={(e) => setFromId(e.target.value as AccountId)}
            options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
            emptyLabel="No accounts yet"
          />

          <Select
            label="Into"
            value={toId}
            onChange={(e) => setToId(e.target.value as AccountId)}
            options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
            emptyLabel="No accounts yet"
            {...(fromId === toId
              ? { error: 'Money has to move between two different accounts.' }
              : {})}
          />

          <Input
            type="date"
            label="When"
            value={when}
            onChange={(e) => e.target.value && setWhen(e.target.value)}
          />

          <p className="text-caption text-ink-3">
            Nothing is earned and nothing is spent, so your spending and how fast you are going
            do not move. What you are worth stays exactly the same.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 pb-2">
          <Outcome className="flex-row items-baseline justify-between">
            <span className="text-caption text-ink-2">You spent</span>
            <button
              type="button"
              onClick={() => setStep('amount')}
              className="text-liquid underline-offset-4 [@media(hover:hover)]:hover:underline"
            >
              <Money value={amount} size="lead" tone="neutral" />
            </button>
          </Outcome>

          {/* The toggle that keeps somebody else's costs out of your figures.

              The "i" sits beside the button rather than inside it: nesting one
              tap target in another means the outer one wins the tap on a
              phone, and putting it on its own line below orphaned it in a band
              of empty space with nothing to attach to. */}
          <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setFronted(!fronted)}
            aria-pressed={fronted}
            className={clsx(
              'flex flex-1 items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors',
              fronted
                ? 'border-liquid-dim bg-liquid-wash'
                : 'border-line bg-raised [@media(hover:hover)]:hover:border-line-strong',
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
                A work trip, a dinner you covered, a group booking.
              </span>
            </span>
          </button>
            <span className="pt-3">
              <Explain topic="fronted" label="money you fronted" onOpen={explain.open} />
            </span>
          </div>

          {fronted ? (
            <>
              <Input
                label="Who will pay you back?"
                type="text"
                value={owedBy}
                onChange={(e) => setOwedBy(e.target.value)}
                placeholder="Work, Sam, the group…"
              />

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
                          : 'border-line bg-raised text-ink [@media(hover:hover)]:hover:border-line-strong',
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
          {/* No label on this row.
              Not splitting, it read "What was it for?" — which the sheet's own
              title already asks two inches above. Splitting, it read "Split
              across categories" — the same words as the button beside it. Both
              states duplicated something, so the row is just the toggle. */}
          <div className="flex items-center justify-end gap-3">
            {!fronted && (
              <button
                type="button"
                onClick={() => {
                  setSplitting((was) => !was);
                  setSplitLines((lines) =>
                    lines.length >= 2 ? lines : [newDraftLine(), newDraftLine()],
                  );
                }}
                className="target text-caption text-liquid"
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
                label=""
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
                  onExplain={explain.open}
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
                      : 'border-line bg-raised text-ink [@media(hover:hover)]:hover:border-line-strong',
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

          <Input
            label="Who did you pay? (optional)"
            type="text"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="The shop or person you paid"
          />

          <Input
            label="When was it?"
            type="date"
            value={when}
            max={toIsoDate(new Date())}
            onChange={(e) => setWhen(e.target.value || toIsoDate(new Date()))}
            {...(when !== toIsoDate(new Date())
              ? { hint: 'Counted on that day rather than today.' }
              : {})}
          />

          <Input
            label="Notes (optional)"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything you want to remember about it"
          />
        </div>
      )}
      {explain.sheet}
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
      <span className="text-caption text-ink-2">{label}</span>
      {children}
    </div>
  );
}
