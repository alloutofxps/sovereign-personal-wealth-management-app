/* Two ways of paying off what you owe, side by side. */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import {
  comparePayoff,
  describeComparison,
  strategyLabel,
  totalMinimum,
  type PayoffPlan,
  type Strategy,
} from '@/core/simulate';
import { useForecast } from '@/app/forecast/useForecast';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { AmountInput, BottomSheet, Button, Card, Money } from '@/design/ui';

export function DebtPayoffView() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const forecast = useForecast();
  const debts = useMemo(() => forecast.data?.debts ?? [], [forecast.data]);

  const minimum = useMemo(() => totalMinimum(debts), [debts]);
  const [budget, setBudget] = useState<Minor | null>(null);
  const [editing, setEditing] = useState(false);

  // Start somewhere that actually makes headway: enough to clear the lot in
  // around two years, or double the minimum, whichever is more. Paying the
  // bare minimum is what keeps people on a card for a decade.
  const totalOwed = debts.reduce((total, d) => total + d.balance, 0);
  const monthly =
    budget ?? minor(Math.max(Math.round(minimum * 2), Math.ceil(totalOwed / 24)));
  const comparison = useMemo(() => comparePayoff(debts, monthly), [debts, monthly]);

  const [preferred, setPreferred] = useState<Strategy>('costliest_first');
  const plan = preferred === 'costliest_first' ? comparison.costliestFirst : comparison.smallestFirst;

  if (debts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-lead text-ink">You do not owe anything</p>
            <p className="max-w-[34ch] text-caption text-ink-2">
              Nothing on a card, nothing on a loan. There is nothing to plan here, which is the
              best possible version of this screen.
            </p>
            <Button variant="secondary" onClick={() => navigate('accounts')}>
              Back to your accounts
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Header />

      <Card label="What you put towards it each month" accent="liquid">
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => setEditing(true)} className="target text-left">
            <Money value={monthly} size="figure" tone="liquid" />
          </button>
          <p className="text-caption text-ink-2">
            The least you can pay across everything is {money.format(minimum)} a month. Anything
            above that is what actually clears the debt. Tap the figure to change it.
          </p>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">
          Two ways of going about it
        </h2>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <PlanCard
            plan={comparison.costliestFirst}
            selected={preferred === 'costliest_first'}
            onSelect={() => setPreferred('costliest_first')}
            note="Costs the least overall"
          />
          <PlanCard
            plan={comparison.smallestFirst}
            selected={preferred === 'smallest_first'}
            onSelect={() => setPreferred('smallest_first')}
            note="First one gone soonest"
          />
        </div>

        <Card>
          <p className="max-w-[48ch] text-caption text-ink-2">
            {describeComparison(comparison, (amount) => money.format(amount))}
          </p>
        </Card>
      </section>

      {plan.clearedOrder.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="section-title text-ink">
            The order things disappear
          </h2>
          <Card padding="none">
            <ol className="divide-y divide-line-faint">
              {plan.clearedOrder.map((cleared, index) => (
                <li
                  key={cleared.id}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-micro text-ink-3">
                      {index + 1}
                    </span>
                    <span className="truncate text-body text-ink">{cleared.name}</span>
                  </span>
                  <span className="shrink-0 text-caption text-ink-3">
                    {describeMonths(cleared.monthIndex + 1)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      <p className="max-w-[46ch] text-caption text-ink-3">
        Assumes the same payment each month and nothing new added.
      </p>

      <BottomSheet
        open={editing}
        onClose={() => setEditing(false)}
        title="How much can you put towards it?"
        description="Every pound above the minimum comes straight off the balance."
        footer={
          <Button variant="primary" block onClick={() => setEditing(false)}>
            Use this amount
          </Button>
        }
      >
        <AmountInput
          value={monthly}
          onChange={setBudget}
          onSubmit={() => setEditing(false)}
          label="Each month"
          hint={`The minimum across everything is ${money.format(minimum)}.`}
        />
      </BottomSheet>
    </div>
  );
}

/** "this month", "in 8 months", "in about 5 years" — how people say it. */
function describeMonths(months: number): string {
  if (months <= 1) return 'this month';
  if (months < 24) return `in ${months} months`;
  const years = Math.round(months / 12);
  return `in about ${years} years`;
}

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="headline text-ink">Paying it off</h1>
      <p className="text-caption text-ink-2">
        Same money, two orders. One costs less; the other feels faster.
      </p>
    </header>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect,
  note,
}: {
  plan: PayoffPlan;
  selected: boolean;
  onSelect: () => void;
  note: string;
}) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="target text-left">
      <div
        className={clsx(
          'flex h-full flex-col gap-2 rounded-lg border p-4 transition-colors',
          selected ? 'border-liquid-dim bg-liquid-wash' : 'border-line bg-surface',
        )}
      >
        <span
          className={clsx(
            'text-caption font-medium',
            selected ? 'text-liquid' : 'text-ink-3',
          )}
        >
          {strategyLabel(plan.strategy)}
        </span>

        <span className="text-figure font-medium text-ink">
          {plan.months === null ? 'Never clears' : describeMonths(plan.months)}
        </span>

        <span className="flex items-baseline gap-1.5 text-caption text-ink-2">
          <Money value={plan.totalInterest} size="caption" tone="muted" />
          in interest
        </span>

        <span className={clsx('text-micro', selected ? 'text-liquid' : 'text-ink-3')}>{note}</span>
      </div>
    </button>
  );
}
