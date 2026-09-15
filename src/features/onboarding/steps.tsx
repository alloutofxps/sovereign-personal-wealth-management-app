/* ===========================================================================
 * FIRST FLIGHT: THE SIX STEPS
 * ---------------------------------------------------------------------------
 * Every step writes to the ledger the moment something is added, through the
 * same functions the rest of the app uses — `createAccount`, `saveScheduled`,
 * `savePot`. Nothing is held in a draft and committed at the end.
 *
 * That is a deliberate choice and it is the one that makes the whole thing
 * safe to abandon. Somebody who gets three steps in and puts the phone down
 * has three steps' worth of their money set up, not nothing; there is no
 * "finish or lose it" bargain, and so no reason for the wizard to argue with
 * anybody about leaving. Every step can be skipped, and everything a step does
 * is reachable afterwards from the balance sheet, the pots screen or Settings.
 *
 * The last step is the only one that does not write anything. It reads — from
 * `useDashboard`, the same live query the home screen runs — so the figure it
 * explains is not a worked example resembling theirs. It is theirs.
 * ======================================================================== */

import { useState } from 'react';
import { COMMON_CURRENCIES, currencyDisplayName, minor, type Minor } from '@/core/money';
import type { AccountClass } from '@/core/ledger';
import { accountId } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import type { PotTargetKind } from '@/core/goals';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useDashboard } from '@/app/dashboard/useDashboard';
import { createAccount } from '@/data/repositories/accountsRepo';
import { saveScheduled, type Cadence } from '@/data/repositories/scheduleRepo';
import { savePot } from '@/data/repositories/potsRepo';
import { Button, Explain, Input } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';
import {
  AddedList,
  Aside,
  Choice,
  Labelled,
  MoneyBox,
  StepFrame,
  Term,
  TextBox,
  readAmount,
} from './parts';

/** What a step has put into the ledger, for the list under its form. */
export interface Added {
  id: string;
  name: string;
  detail: string;
}

interface StepProps {
  added: Added[];
  onAdded: (item: Added) => void;
}

/* ===========================================================================
 * 1. WHAT THIS IS
 * ======================================================================== */

export function StepPromise() {
  const explain = useExplain();
  const currency = useAppConfig((s) => s.currencyCode);
  const setCurrency = useAppConfig((s) => s.setCurrency);
  const locale = useAppConfig((s) => s.locale);

  return (
    <StepFrame
      title="Your money, on your phone, and nowhere else."
      lede="Your data stays on this device. No servers, no accounts, no tracking."
    >
      <div className="flex items-center justify-between gap-2">
        <Aside>Which also means nobody can get it back for you.</Aside>
        <Explain topic="recovery-phrase" label="your recovery phrase" onOpen={explain.open} />
      </div>

      <Labelled label="What do you count in?">
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink"
        >
          {COMMON_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code} · {currencyDisplayName(code, locale)}
            </option>
          ))}
        </select>
      </Labelled>

      <p className="text-caption text-ink-3">
        Changeable later, but easier to get right now than after a year of records.
      </p>
      {explain.sheet}
    </StepFrame>
  );
}

/* ===========================================================================
 * 2. WHERE THE MONEY IS
 * ======================================================================== */

const CASH_KINDS: { value: AccountClass; title: string; detail: string }[] = [
  { value: 'checking', title: 'Current account', detail: 'Where your pay lands and your card takes from.' },
  { value: 'savings', title: 'Savings', detail: 'Money you could move today if you wanted to.' },
  { value: 'cash', title: 'Cash', detail: 'Notes in a drawer or a wallet.' },
];

export function StepWhereItIs({ added, onAdded }: StepProps) {
  const explain = useExplain();
  return (
    <StepFrame
      title="Where is your money right now?"
      lede="The accounts you actually spend from, at today's balance."
    >
      <AccountAdder
        kinds={CASH_KINDS}
        nameHint="Bank of Ireland current"
        amountLabel="What is in it today"
        onAdded={onAdded}
      />
      <AddedList items={added} empty="Nothing added yet. One account is enough to begin with." />
      <div className="flex items-center justify-between gap-2">
        <Aside>A rough figure here gives a rough answer.</Aside>
        <Explain topic="safe-to-spend" label="what is safe to spend" onOpen={explain.open} />
      </div>
      {explain.sheet}
    </StepFrame>
  );
}

/* ===========================================================================
 * 2b. ANYTHING INVESTED?
 * ---------------------------------------------------------------------------
 * Added after a walk from a wiped database found that onboarding never
 * mentions investments or pensions at all, so somebody whose main asset is a
 * broker is never asked about it.
 *
 * No amount, for the reason `CreateAccountSheet` also stopped asking: an
 * account that holds positions is worth what is in it, and what is in it is
 * the next question. Skippable like every other step.
 * ======================================================================== */

const INVESTMENT_KINDS: { value: AccountClass; title: string; detail: string }[] = [
  {
    value: 'brokerage',
    title: 'Investments',
    detail: 'A broker, a stocks ISA, a share dealing account.',
  },
  {
    value: 'retirement',
    title: 'Pension',
    detail: 'Yours, and not money you could spend this week.',
  },
];

export function StepInvested({ added, onAdded }: StepProps) {
  return (
    <StepFrame
      title="Anything invested?"
      lede="A broker, a stocks ISA, a pension. Yours, but not money you would spend this week."
    >
      <AccountAdder
        kinds={INVESTMENT_KINDS}
        nameHint="Trading 212"
        amountLabel=""
        hideAmount
        onAdded={onAdded}
      />
      <AddedList items={added} empty="Nothing added yet. Skip this if you hold nothing." />
    </StepFrame>
  );
}

/* ===========================================================================
 * 3. WHAT YOU OWE
 * ======================================================================== */

const DEBT_KINDS: { value: AccountClass; title: string; detail: string }[] = [
  { value: 'credit_card', title: 'Credit card', detail: 'Sovereign sets money aside for the bill as you spend.' },
  { value: 'loan', title: 'Loan', detail: 'A car loan, a personal loan, anything with a term.' },
  { value: 'mortgage', title: 'Mortgage', detail: 'The payment is budgeted; the balance is not taken off your spending.' },
];

export function StepWhatYouOwe({ added, onAdded }: StepProps) {
  const explain = useExplain();
  return (
    <StepFrame
      title="Anything you owe?"
      lede="Type what is outstanding as a positive number. Sovereign knows which direction it goes."
    >
      <AccountAdder
        kinds={DEBT_KINDS}
        nameHint="Visa"
        amountLabel="What is owed on it"
        onAdded={onAdded}
      />
      <AddedList items={added} empty="Nothing owed, or nothing added yet. Both are fine." />
      <div className="flex items-center justify-between gap-2">
        <Aside>A card comes off what is safe to spend. A mortgage does not.</Aside>
        <Explain topic="cards" label="cards and mortgages" onOpen={explain.open} />
      </div>
      {explain.sheet}
    </StepFrame>
  );
}

/* ===========================================================================
 * 4. WHAT COMES IN, AND WHAT GOES OUT
 * ======================================================================== */

const CADENCES: { value: Cadence; label: string }[] = [
  { value: 'monthly', label: 'Every month' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'annual', label: 'Once a year' },
];

export function StepRegulars({ added, onAdded }: StepProps) {
  const explain = useExplain();
  const money = useMoney();
  const [kind, setKind] = useState<'income' | 'bill'>('income');
  const [name, setName] = useState('');
  const [typed, setTyped] = useState('');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [due, setDue] = useState(toIsoDate(new Date()));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount = readAmount(typed, money.exponent);
  const ready = amount !== null && name.trim().length > 0 && !busy;

  async function add() {
    if (!ready || amount === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const id = crypto.randomUUID();
      await saveScheduled({
        id,
        kind,
        name: name.trim(),
        amount,
        nextDue: due,
        cadence,
        accountId: null,
        categoryId: null,
        active: true,
        expectedAmount: amount,
        lastAmount: null,
        lastBilledDate: null,
        dormantAlertDismissedAt: null,
      });
      onAdded({
        id,
        name: `${name.trim()}${kind === 'income' ? ' (in)' : ''}`,
        detail: money.format(amount),
      });
      setName('');
      setTyped('');
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has changed, so you can try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepFrame
      title="What lands, and what leaves?"
      lede="Your pay, your rent, the phone bill. The things that arrive anyway."
    >
      <div className="grid grid-cols-2 gap-2">
        <Choice selected={kind === 'income'} onClick={() => setKind('income')} title="Money in" />
        <Choice selected={kind === 'bill'} onClick={() => setKind('bill')} title="Money out" />
      </div>

      <TextBox
        label="What is it called?"
        value={name}
        onChange={setName}
        placeholder={kind === 'income' ? 'Pay from work' : 'Rent'}
      />

      <MoneyBox label="How much" value={typed} onChange={setTyped} exponent={money.exponent} />

      <Labelled label="How often">
        <select
          value={cadence}
          onChange={(event) => setCadence(event.target.value as Cadence)}
          className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink"
        >
          {CADENCES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Labelled>

      <Input
        label="Next one due"
        type="date"
        value={due}
        onChange={(event) => event.target.value && setDue(event.target.value)}
      />

      {problem && (
        <p className="text-caption text-caution" role="alert">
          {problem}
        </p>
      )}

      <Button variant="secondary" block disabled={!ready} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add it'}
      </Button>

      <AddedList items={added} empty="Nothing added yet. Rent and pay are the two worth having." />
      <div className="flex items-center justify-between gap-2">
        <Aside>Anything due next month is held back, so a bill cannot sneak up.</Aside>
        <Explain topic="safe-to-spend" label="what is safe to spend" onOpen={explain.open} />
      </div>
      {explain.sheet}
    </StepFrame>
  );
}

/* ===========================================================================
 * 5. SOMETHING TO SAVE FOR
 * ======================================================================== */

const POT_KINDS: { value: PotTargetKind; title: string; detail: string }[] = [
  {
    value: 'by_date',
    title: 'I need it all by a certain date',
    detail: 'Sovereign divides what is left by the months left and asks for that each month.',
  },
  {
    value: 'monthly',
    title: 'I put the same in every month',
    detail: 'The same amount, every month, for as long as you like. It never finishes.',
  },
  {
    value: 'open',
    title: 'No rush. I put in what I can',
    detail: 'Nothing is held back automatically. The pot just keeps what you give it.',
  },
];

export function StepSaving({ added, onAdded }: StepProps) {
  const money = useMoney();
  const [name, setName] = useState('');
  const [typed, setTyped] = useState('');
  const [kind, setKind] = useState<PotTargetKind>('by_date');
  const [date, setDate] = useState(() => {
    const inAYear = new Date();
    inAYear.setFullYear(inAYear.getFullYear() + 1);
    return toIsoDate(inAYear);
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount = readAmount(typed, money.exponent);
  const ready = amount !== null && name.trim().length > 0 && !busy;

  async function add() {
    if (!ready || amount === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const id = accountId(`pot-${crypto.randomUUID()}`);
      await savePot({
        id,
        name: name.trim(),
        role: 'goal',
        targetAmount: amount,
        kind,
        targetDate: kind === 'by_date' ? date : null,
        recurring: false,
      });
      onAdded({
        id,
        name: name.trim(),
        detail: kind === 'monthly' ? `${money.format(amount)} a month` : money.format(amount),
      });
      setName('');
      setTyped('');
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has changed, so you can try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepFrame
      title="What are you putting money by for?"
      lede="Money that stays in your account but stops counting as spare."
    >
      <TextBox label="What is it for?" value={name} onChange={setName} placeholder="Car insurance" />

      <Labelled label={kind === 'monthly' ? 'How much each month' : 'How much you need'}>
        <MoneyBox value={typed} onChange={setTyped} exponent={money.exponent} />
      </Labelled>

      <div className="flex flex-col gap-2">
        <span className="text-caption text-ink-2">
          How does this one work?
        </span>
        {POT_KINDS.map((option) => (
          <Choice
            key={option.value}
            selected={kind === option.value}
            onClick={() => setKind(option.value)}
            title={option.title}
            detail={option.detail}
          />
        ))}
        {kind === 'by_date' && (
          <Input
            aria-label="The date you need it by"
            type="date"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
          />
        )}
      </div>

      {problem && (
        <p className="text-caption text-caution" role="alert">
          {problem}
        </p>
      )}

      <Button variant="secondary" block disabled={!ready} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add this pot'}
      </Button>

      <AddedList items={added} empty="No pots yet. Most people start with the one bill that hurts." />
    </StepFrame>
  );
}

/* ===========================================================================
 * 6. WHAT THE NUMBER MEANS
 * ---------------------------------------------------------------------------
 * The only step that reads instead of writes. Every figure here comes from
 * `useDashboard`, so this is not an illustration of the home screen — it is
 * the home screen's arithmetic, shown a line at a time.
 * ======================================================================== */

export function StepTheNumber() {
  const money = useMoney();
  const { data, error } = useDashboard();

  if (error) {
    return (
      <StepFrame
        title="One number, and where it comes from"
        lede="Nothing you have entered is lost. The home screen will show it shortly."
      >
        <Aside>You can finish here and go straight to it.</Aside>
      </StepFrame>
    );
  }

  if (!data) {
    return (
      <StepFrame
        title="One number, and where it comes from"
        lede="Working out where you stand…"
      >
        <div className="min-h-[12rem]" aria-hidden="true" />
      </StepFrame>
    );
  }

  const { liquidity } = data;
  const promised = minor(liquidity.committed);

  return (
    <StepFrame
      title="One number, and where it comes from"
      lede="Not your balance. What is left once everything spoken for is out of the way."
    >
      <div className="rounded-lg border border-line bg-surface px-4 py-2">
        <Term label="What you have" value={money.format(liquidity.liquidCash)} tone="plain" />
        <Term
          label="Already promised"
          value={`− ${money.format(promised)}`}
          tone="taken"
          note="Bills due in the next month, and anything owed on a card."
        />
        <Term
          label="Your cushion"
          value={`− ${money.format(liquidity.buffer)}`}
          tone="taken"
          note="Never counted as spare, so a forgotten payment cannot overdraw you."
        />
        <Term
          label="Put by in pots"
          value={`− ${money.format(liquidity.goalFunding)}`}
          tone="taken"
          note="What is already in them, and what still has to go in this month."
        />
        <Term label="Safe to spend" value={money.format(liquidity.safeToSpend)} tone="answer" />
      </div>

      {liquidity.safeToSpend > 0 ? (
        <Aside>
          That is {money.format(liquidity.dailyPace)} a day for the next{' '}
          {liquidity.paceDays === 1 ? 'day' : `${liquidity.paceDays} days`}
          {liquidity.paceDays < liquidity.daysRemaining
            ? ', which is when more money comes in'
            : ', to the end of this period'}
          . Spend it. That is what it is for.
        </Aside>
      ) : (
        <Aside>
          There is nothing spare at the moment. That is a fact about this week rather than a
          verdict on you, and it moves as soon as money arrives or a bill clears.
        </Aside>
      )}

      <p className="text-caption text-ink-3">
        Nothing here was stored. Sovereign works this out again every time you open it, from what
        is actually in your ledger, so it can never drift from the truth.
      </p>
    </StepFrame>
  );
}

/* ===========================================================================
 * THE ACCOUNT FORM, USED BY BOTH ACCOUNT STEPS
 * ======================================================================== */

function AccountAdder({
  kinds,
  nameHint,
  amountLabel,
  onAdded,
  hideAmount = false,
}: {
  kinds: { value: AccountClass; title: string; detail: string }[];
  nameHint: string;
  amountLabel: string;
  onAdded: (item: Added) => void;
  /**
   * For an account whose worth is not a figure anybody types.
   *
   * A brokerage is worth what it holds plus its cash, both asked for on the
   * composition screen, so asking for an estimate here would be asking for a
   * number with nothing to do. An empty amount already reads as zero, which
   * is what this leaves it at.
   */
  hideAmount?: boolean;
}) {
  const money = useMoney();
  const [chosen, setChosen] = useState<AccountClass>(kinds[0]!.value);
  const [name, setName] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const amount: Minor | null = readAmount(typed, money.exponent);
  // A brand-new savings account can genuinely hold nothing, and a paid-off
  // card genuinely owes nothing, so an empty amount is allowed and read as
  // zero. A *mistyped* amount is not — that is what `problem` catches.
  const usable = amount ?? minor(0);
  const mistyped = amount === null && typed.trim() !== '';
  const ready = name.trim().length > 0 && !mistyped && !busy;

  async function add() {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const created = await createAccount({
        name: name.trim(),
        accountClass: chosen,
        startingBalance: usable,
      });
      onAdded({
        id: created.account.id,
        name: created.account.name,
        detail: money.format(usable),
      });
      setName('');
      setTyped('');
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : 'That could not be added. Nothing has changed, so you can try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {kinds.map((kind) => (
          <Choice
            key={kind.value}
            selected={chosen === kind.value}
            onClick={() => setChosen(kind.value)}
            title={kind.title}
            detail={kind.detail}
          />
        ))}
      </div>

      <Labelled label="What do you call it?">
        <TextBox value={name} onChange={setName} placeholder={nameHint} />
      </Labelled>

      {!hideAmount && (
        <Labelled label={amountLabel}>
          <MoneyBox value={typed} onChange={setTyped} exponent={money.exponent} />
        </Labelled>
      )}

      {problem && (
        <p className="text-caption text-caution" role="alert">
          {problem}
        </p>
      )}

      <Button variant="secondary" block disabled={!ready} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add it'}
      </Button>
    </div>
  );
}
