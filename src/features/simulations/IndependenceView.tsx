/* When you could stop, and what it would take. */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { basisPoints, bpToPercent, minor, type Minor } from '@/core/money';
import { describeMilestone, describeWhen, projectFire, type Milestone } from '@/core/simulate';
import { useForecast } from '@/app/forecast/useForecast';
import { useMoney } from '@/app/money/useMoney';
import { useIndependenceAssumptions, type IndependenceAssumptions } from '@/app/config/store';
import { GrowthBand } from '@/charts/GrowthBand';
import { AmountInput, BottomSheet, Button, Card, Money } from '@/design/ui';

/** 3.0% to 4.5%, in quarter-point steps. */
const RATES = [300, 325, 350, 375, 400, 425, 450] as const;

export function IndependenceView() {
  const money = useMoney();
  const forecast = useForecast();
  const assumptions = useIndependenceAssumptions();
  // The store keeps plain numbers because it is persisted as JSON; branding
  // happens here, at the boundary, so nothing downstream sees a bare number.
  const invested = minor(assumptions.invested);
  const monthlyContribution = minor(assumptions.monthlyContribution);
  const storedSpending = minor(assumptions.annualSpending);
  const [editing, setEditing] = useState<'invested' | 'monthly' | 'spending' | null>(null);

  // A first guess from what is actually recorded, until the person says otherwise.
  const suggestedSpending = useMemo(() => {
    const monthly = (forecast.data?.categories ?? []).reduce((total, c) => total + c.monthly, 0);
    const fixed = forecast.data?.fixedMonthly ?? 0;
    return minor((monthly + fixed) * 12);
  }, [forecast.data]);

  const annualSpending =
    storedSpending > 0 ? storedSpending : suggestedSpending;

  const result = useMemo(
    () =>
      projectFire({
        invested,
        monthlyContribution,
        annualSpending,
        realReturn: basisPoints(assumptions.realReturnBp),
        withdrawalRate: basisPoints(assumptions.withdrawalRateBp),
        currentAge: assumptions.currentAge,
        retirementAge: assumptions.retirementAge,
      }),
    [assumptions, annualSpending, invested, monthlyContribution],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">When you could stop</h1>
        <p className="text-caption text-ink-2">
          How much you would need invested to live off it, and roughly how long that takes at
          what you are putting away now.
        </p>
      </header>

      <Card label="What you are working with">
        <div className="flex flex-col gap-1">
          <Row
            label="Invested today"
            value={invested}
            onEdit={() => setEditing('invested')}
          />
          <Row
            label="Going in each month"
            value={monthlyContribution}
            onEdit={() => setEditing('monthly')}
          />
          <Row
            label="A year costs you"
            value={annualSpending}
            onEdit={() => setEditing('spending')}
            {...(storedSpending > 0
              ? {}
              : { detail: 'worked out from what you have recorded' })}
          />
        </div>
      </Card>

      <Card label="How much you draw each year">
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <span className="tnum text-figure font-medium text-ink">
              {bpToPercent(basisPoints(assumptions.withdrawalRateBp)).toFixed(2)}%
            </span>
            <span className="text-caption text-ink-3">
              {result.multiple} times a year&rsquo;s spending
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={RATES.length - 1}
            step={1}
            value={RATES.indexOf(assumptions.withdrawalRateBp as (typeof RATES)[number])}
            onChange={(e) =>
              assumptions.setWithdrawalRate(RATES[Number(e.target.value)] ?? 400)
            }
            aria-label="How much you draw each year"
            className="h-1.5 w-full appearance-none rounded-pill bg-sunken accent-[var(--color-liquid)]"
          />

          <p className="max-w-[46ch] text-caption text-ink-2">
            Drawing less each year means your money has to last less hard, so you need more of
            it. At 3% you need {Math.round(10_000 / 300)} times what you spend in a year; at 4.5%
            you need {Math.round(10_000 / 450)} times. It is the single biggest thing on this
            page.
          </p>
        </div>
      </Card>

      <Card label="How it might grow">
        <div className="flex flex-col gap-3">
          <GrowthBand
            points={result.trajectory}
            milestones={result.milestones}
            years={30}
            format={(amount) => money.format(amount, { compact: true })}
          />
          <p className="max-w-[46ch] text-caption text-ink-2">
            The solid line is what steady returns would give you. The shaded band is the range a
            good or a bad run of markets could put you in. Real markets do not move in a
            straight line, and the width of that band is the honest part of this page.
          </p>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">
          The landmarks
        </h2>
        <div className="flex flex-col gap-2">
          {result.milestones.map((milestone) => (
            <MilestoneCard key={milestone.kind} milestone={milestone} />
          ))}
        </div>
      </section>

      <p className="max-w-[46ch] text-caption text-ink-3">
        These are projections, not promises. They assume a steady return after inflation of{' '}
        {bpToPercent(basisPoints(assumptions.realReturnBp)).toFixed(1)}% and that you keep paying
        in at the same rate. Real markets do neither, so treat the dates as a direction rather
        than a diary entry.
      </p>

      <EditSheet
        editing={editing}
        onClose={() => setEditing(null)}
        assumptions={assumptions}
        suggestedSpending={suggestedSpending}
      />
    </div>
  );
}

function MilestoneCard({ milestone }: { milestone: Milestone }) {
  const money = useMoney();

  return (
    <Card padding="normal" accent={milestone.reached ? 'liquid' : 'none'}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-body font-medium text-ink">{milestone.label}</h3>
          <span
            className={clsx(
              'shrink-0 rounded-pill px-2 py-0.5 text-micro font-medium',
              milestone.reached ? 'bg-liquid-wash text-liquid' : 'bg-raised text-ink-2',
            )}
          >
            {milestone.reached ? 'Reached' : describeWhen(milestone.months)}
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-pill bg-sunken">
          <div
            className={clsx(
              'h-full rounded-pill transition-[width] duration-500',
              milestone.reached ? 'bg-liquid' : 'bg-liquid-dim',
            )}
            style={{ width: `${milestone.percent}%` }}
          />
        </div>

        <p className="max-w-[44ch] text-caption text-ink-2">
          {describeMilestone(milestone, (amount) => money.format(amount, { decimals: 'hide' }))}
        </p>
      </div>
    </Card>
  );
}

function Row({
  label,
  value,
  detail,
  onEdit,
}: {
  label: string;
  value: Minor;
  detail?: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex items-center justify-between gap-3 border-b border-line-faint py-3 text-left last:border-b-0"
    >
      <span className="min-w-0">
        <span className="block text-body text-ink">{label}</span>
        {detail && <span className="block pt-0.5 text-caption text-ink-3">{detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-liquid">
        <Money value={value} size="lead" tone="neutral" />
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m9 6 6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

function EditSheet({
  editing,
  onClose,
  assumptions,
  suggestedSpending,
}: {
  editing: 'invested' | 'monthly' | 'spending' | null;
  onClose: () => void;
  assumptions: IndependenceAssumptions;
  suggestedSpending: Minor;
}) {
  const money = useMoney();
  const current =
    editing === 'invested'
      ? minor(assumptions.invested)
      : editing === 'monthly'
        ? minor(assumptions.monthlyContribution)
        : assumptions.annualSpending > 0
          ? minor(assumptions.annualSpending)
          : suggestedSpending;

  const [draft, setDraft] = useState<Minor>(current);

  const titles = {
    invested: 'How much do you have invested?',
    monthly: 'How much goes in each month?',
    spending: 'What does a year cost you?',
  } as const;

  const hints = {
    invested: 'Pensions, shares, anything you are not planning to spend soon.',
    monthly: 'What you actually put away, on average.',
    spending: `Sovereign guesses ${money.format(suggestedSpending)} from what you have recorded.`,
  } as const;

  function save() {
    if (editing === 'invested') assumptions.setInvested(draft);
    if (editing === 'monthly') assumptions.setMonthlyContribution(draft);
    if (editing === 'spending') assumptions.setAnnualSpending(draft);
    onClose();
  }

  return (
    <BottomSheet
      open={editing !== null}
      onClose={onClose}
      title={editing ? titles[editing] : ''}
      footer={
        <Button variant="primary" block onClick={save}>
          Use this
        </Button>
      }
    >
      {editing && (
        <AmountInput
          value={draft}
          onChange={setDraft}
          onSubmit={save}
          label="Amount"
          hint={hints[editing]}
          maxDigits={11}
        />
      )}
    </BottomSheet>
  );
}
