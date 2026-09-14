/* ===========================================================================
 * WHAT IF
 * ---------------------------------------------------------------------------
 * The two lines side by side: the ninety days that are actually coming, and
 * the ninety days where the sketch happened too.
 *
 * Everything on this screen is labelled as imagined, every time. The database
 * design already makes it impossible for a hypothetical figure to reach a real
 * total — the branch tables are not the ledger — but structure cannot stop
 * somebody misreading a screen, so the words do that half.
 * ======================================================================== */

import { useMemo, useState } from 'react';
import { fromDecimalString, type Minor } from '@/core/money';
import { accountId as toAccountId, isoDate, type AccountId } from '@/core/ledger';
import { branchLabel, describeDifference } from '@/core/ledger/branching';
import { toIsoDate } from '@/core/liquidity';
import { useForecast } from '@/app/forecast/useForecast';
import { useBranches, useWhatIf } from '@/app/forecast/useWhatIf';
import { sketchBranchEntry, sketchMonthly } from '@/app/ledger/actions';
import { useCategoryPicker } from '@/app/taxonomy/useTaxonomy';
import { useAccounts } from '@/app/ledger/useLedger';
import { useMoney } from '@/app/money/useMoney';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { toast } from '@/app/toast';
import { createBranch, deleteBranch } from '@/data/repositories/branchesRepo';
import { BottomSheet, Button, Card, Explain, Input, Money, Select } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

const HORIZON_DAYS = 90;

export function WhatIfView() {
  const money = useMoney();
  // No figures: a what-if is about a future that has not happened, so there is
  // nothing of the person's own for the example to be worked in.
  const explain = useExplain();
  const locale = useAppConfig((s) => s.locale);
  const forecast = useForecast();
  const branches = useBranches();
  const [chosen, setChosen] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [adding, setAdding] = useState(false);

  const list = branches.data ?? [];
  const active = chosen ?? list[0]?.id ?? null;

  // The real events, taken from the forecast rather than worked out again, so
  // the two lines cannot disagree about what is genuinely coming.
  const base = useMemo(
    () =>
      forecast.data
        ? {
            today: forecast.data.today,
            days: HORIZON_DAYS,
            startingCash: forecast.data.startingCash,
            buffer: forecast.data.buffer,
          }
        : null,
    [forecast.data],
  );

  const actualEvents = useMemo(
    () => (forecast.data?.projection.points ?? []).flatMap((point) => point.events),
    [forecast.data],
  );

  const result = useWhatIf(active, base, actualEvents);
  const data = result.data;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="headline text-ink">What if</h1>
        <Explain topic="what-if" label="sketching a change" onOpen={explain.open} />
      </header>

      {list.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">No what-ifs yet</p>
            <p className="max-w-[40ch] text-caption text-ink-2">
              A raise, a move, a car. Nothing you sketch here is recorded.
            </p>
            <Button variant="primary" onClick={() => setNaming(true)}>
              Start one
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {list.map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => setChosen(branch.id)}
                aria-pressed={branch.id === active}
                className={
                  'rounded-pill border px-3 py-1.5 text-caption transition-colors ' +
                  (branch.id === active
                    ? 'border-liquid-dim bg-liquid-wash text-liquid'
                    : 'border-line bg-raised text-ink-2 [@media(hover:hover)]:hover:border-line-strong')
                }
              >
                {branchLabel(branch)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="rounded-pill border border-line px-3 py-1.5 text-caption text-ink-3 [@media(hover:hover)]:hover:border-line-strong"
            >
              + Another
            </button>
          </div>

          {data && (
            <>
              <Card label="Where the ninety days end" accent="liquid">
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Figure label="As things are" value={data.actual.endBalance} />
                    <Figure label="With this what-if" value={data.branched.endBalance} imagined />
                  </div>

                  <p className="text-caption leading-relaxed text-ink-2">
                    {describeDifference(data.ending, data.branch.name, (amount) =>
                      money.format(amount),
                    )}
                  </p>

                  <p className="text-caption text-ink-3">
                    {data.counted === 0
                      ? 'Nothing sketched yet, so both lines are the same.'
                      : `${data.counted} sketched ${data.counted === 1 ? 'change' : 'changes'}, from ${describeDate(data.branch.divergesOn, locale)}.`}
                  </p>

                  {data.branched.firstBelowZero && (
                    <p className="text-caption text-caution">
                      In this what-if the balance would go under on{' '}
                      {describeDate(data.branched.firstBelowZero.date, locale)}.
                    </p>
                  )}
                </div>
              </Card>

              {data.refused.length > 0 && (
                <Card accent="caution">
                  <p className="text-caption text-ink-2">
                    {data.refused.length}{' '}
                    {data.refused.length === 1 ? 'sketch is' : 'sketches are'} not being counted.
                  </p>
                  <ul className="flex flex-col gap-1 pt-2">
                    {data.refused.map((problem) => (
                      <li key={problem.entryId} className="text-caption text-ink-3">
                        {problem.message}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card label="What changes in this one" padding="none">
                {data.events.length === 0 ? (
                  <p className="px-4 py-6 text-caption text-ink-2">
                    Nothing yet. Add a change and both lines will move apart.
                  </p>
                ) : (
                  <ul className="divide-y divide-line-faint">
                    {data.events.map((event, index) => (
                      <li
                        key={`${event.date}-${index}`}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-body text-ink">{event.name}</p>
                          <p className="text-caption text-ink-3">
                            {describeDate(event.date, locale)}
                          </p>
                        </div>
                        <Money
                          value={event.amount}
                          size="lead"
                          tone={event.amount > 0 ? 'liquid' : 'neutral'}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add a change
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void deleteBranch(data.branch.id)
                      .then(() => {
                        setChosen(null);
                        toast(`${data.branch.name} is gone. Nothing you have recorded changed.`);
                      })
                      .catch(() => toast('That could not be removed just now.', { tone: 'attention' }));
                  }}
                >
                  Throw this one away
                </Button>
              </div>
            </>
          )}
        </>
      )}

      <NameSheet open={naming} onClose={() => setNaming(false)} onMade={(id) => setChosen(id)} />
      {active && (
        <ChangeSheet
          open={adding}
          onClose={() => setAdding(false)}
          branchId={active}
          from={data?.branch.divergesOn ?? isoDate(toIsoDate(new Date()))}
        />
      )}
      {explain.sheet}
    </div>
  );
}

function Figure({ label, value, imagined }: { label: string; value: Minor; imagined?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro font-medium text-ink-3">{label}</span>
      <Money value={value} size="figure" tone={imagined ? 'liquid' : 'neutral'} />
    </div>
  );
}

/* --- starting one --------------------------------------------------------- */

function NameSheet({
  open,
  onClose,
  onMade,
}: {
  open: boolean;
  onClose: () => void;
  onMade: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(() => toIsoDate(new Date()));
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    try {
      const id = await createBranch({ name, divergesOn: isoDate(from) });
      onMade(id);
      setName('');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be started just now.', {
        tone: 'attention',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Start a what-if"
      description="Give it a name you would recognise in a month, and say when it starts."
      footer={
        <Button variant="primary" block disabled={busy || name.trim() === ''} onClick={() => void make()}>
          {busy ? 'Starting…' : 'Start it'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <Input
          label="What are you wondering about?"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="If I took the Rotterdam job"
        />
        <Input
          label="Starting from"
          type="date"
          value={from}
          onChange={(event) => event.target.value && setFrom(event.target.value)}
        />
        <p className="text-caption text-ink-3">
          Nothing before that date changes. A what-if is a different future, never a different
          past. Everything up to then is what actually happened.
        </p>
      </div>
    </BottomSheet>
  );
}

/* --- adding a change ------------------------------------------------------ */

function ChangeSheet({
  open,
  onClose,
  branchId,
  from,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  from: string;
}) {
  const money = useMoney();
  const accounts = useAccounts();
  const picker = useCategoryPicker();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [typed, setTyped] = useState('');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(from);
  const [repeats, setRepeats] = useState(true);
  const [category, setCategory] = useState<AccountId | null>(null);
  const [busy, setBusy] = useState(false);

  const cash = (accounts.data ?? []).filter(
    (account) => account.type === 'ASSET' && account.liquid && account.onBudget,
  );
  const [account, setAccount] = useState<string>('');
  const target = account || cash[0]?.id || '';

  const amount = readAmount(typed, money.exponent);
  const ready =
    amount !== null &&
    label.trim() !== '' &&
    target !== '' &&
    (direction === 'in' || category !== null) &&
    !busy;

  async function add() {
    if (!ready || amount === null) return;
    setBusy(true);
    try {
      const pair = category ? picker.byId.get(category) : null;
      const input = {
        branchId,
        date: isoDate(date),
        amount,
        direction,
        accountId: toAccountId(target),
        label: label.trim(),
        ...(pair
          ? { categoryId: pair.categoryId, envelopeId: pair.envelopeId }
          : {}),
      };

      // Three months, because the line only runs ninety days. Sketching a
      // year of them would write nine entries nothing on this screen reads.
      if (repeats) await sketchMonthly(input, 4);
      else await sketchBranchEntry(input);

      setTyped('');
      setLabel('');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be sketched just now.', {
        tone: 'attention',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add a change"
      description="Money arriving or leaving that is not happening today."
      footer={
        <Button variant="primary" block disabled={!ready} onClick={() => void add()}>
          {busy ? 'Sketching…' : 'Add it to the what-if'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-2 gap-2">
          <Choice selected={direction === 'in'} onClick={() => setDirection('in')}>
            More money in
          </Choice>
          <Choice selected={direction === 'out'} onClick={() => setDirection('out')}>
            More money out
          </Choice>
        </div>

        <Input
          label="What is it?"
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={direction === 'in' ? 'The new salary' : 'Rent on the new place'}
        />

        <Input
          label="How much"
          type="text"
          inputMode="decimal"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="0.00"
          className="tnum"
        />

        {direction === 'out' && (
          <Labelled label="What kind of spending">
            <select
              value={category ?? ''}
              onChange={(event) => setCategory((event.target.value || null) as AccountId | null)}
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink"
            >
              <option value="">Pick a category</option>
              {picker.all.map((option) => (
                <option key={option.categoryId} value={option.categoryId}>
                  {option.name}
                </option>
              ))}
            </select>
          </Labelled>
        )}

        <Select
          label={direction === 'in' ? 'Landing in' : 'Paid from'}
          value={target}
          onChange={(event) => setAccount(event.target.value)}
          options={cash.map((option) => ({ value: option.id, label: option.name }))}
        />

        <Input
          label="Starting"
          type="date"
          value={date}
          min={from}
          onChange={(event) => event.target.value && setDate(event.target.value)}
        />

        <div className="grid grid-cols-2 gap-2">
          <Choice selected={repeats} onClick={() => setRepeats(true)}>
            Every month
          </Choice>
          <Choice selected={!repeats} onClick={() => setRepeats(false)}>
            Just the once
          </Choice>
        </div>
      </div>
    </BottomSheet>
  );
}

/* --- shared bits ---------------------------------------------------------- */

/* A label above a control. Renamed off `Field`, which is the surface in
 * `src/design/ui`; eight components in six files were called that. */
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-caption text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        'rounded-md border px-3 py-2.5 text-left text-body transition-colors ' +
        (selected
          ? 'border-liquid-dim bg-liquid-wash text-liquid'
          : 'border-line bg-raised text-ink [@media(hover:hover)]:hover:border-line-strong')
      }
    >
      {children}
    </button>
  );
}

/**
 * What was typed, in minor units, or null while it is not yet an amount.
 *
 * `fromDecimalString` rather than anything local: it is the same parser the
 * importer and the first-flight wizard use, it takes grouping and either
 * separator, and it refuses rather than rounds. A second one here would be a
 * second answer to "what is 12.345".
 */
function readAmount(typed: string, exponent: number): Minor | null {
  if (typed.trim() === '') return null;
  try {
    const parsed = fromDecimalString(typed, exponent);
    return parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}
