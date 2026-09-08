/* Everything you are saving up for, and what each one needs this month. */

import { useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import { describePot, potStatusLabel, type PotPlan, type PotStatus } from '@/core/goals';
import { useDashboard } from '@/app/dashboard/useDashboard';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { Button, Card, Money } from '@/design/ui';
import { PotSheet, TopUpSheet } from './PotSheet';
import { ManualLink } from '@/features/manual/ManualLink';

const CHIP: Record<PotStatus, string> = {
  funded: 'bg-liquid-wash text-liquid',
  on_track: 'bg-liquid-wash text-liquid',
  behind: 'bg-caution-wash text-caution',
  overdue: 'bg-caution-wash text-caution',
  open_ended: 'bg-raised text-ink-2',
};

const BAR: Record<PotStatus, string> = {
  funded: 'bg-liquid',
  on_track: 'bg-liquid',
  behind: 'bg-caution',
  overdue: 'bg-caution',
  open_ended: 'bg-ink-4',
};

export function PotsView() {
  const dashboard = useDashboard();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PotPlan | null>(null);
  const [toppingUp, setToppingUp] = useState<PotPlan | null>(null);

  const pots = dashboard.data?.pots ?? [];
  const monthlyTotal = minor(pots.reduce((total, pot) => total + pot.monthlyAllocation, 0));
  const needThisMonth = minor(pots.reduce((total, pot) => total + pot.stillNeededThisCycle, 0));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Your pots</h1>
        <p className="text-caption text-ink-2">
          Things that only come round now and then, saved for a bit at a time.
        </p>
        <ManualLink chapter="pots">How a pot decides what this month owes it</ManualLink>
      </header>

      {pots.length > 0 && (
        <Card accent={needThisMonth > 0 ? 'caution' : 'liquid'}>
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-caption text-ink-2">
                  To put by each month
                </span>
                <Money value={monthlyTotal} size="figure" tone="neutral" />
              </div>
              {needThisMonth > 0 && (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-caption text-ink-3">
                    Still to go this month
                  </span>
                  <Money value={needThisMonth} size="lead" tone="caution" />
                </div>
              )}
            </div>
            <p className="text-caption text-ink-2">
              {needThisMonth > 0
                ? 'This is already held back from what is safe to spend, so you will not spend it by accident.'
                : 'Everything for this month is put by. Nothing else needs doing.'}
            </p>
          </div>
        </Card>
      )}

      {pots.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-lead text-ink">Nothing set up yet</p>
            <p className="max-w-[36ch] text-caption text-ink-2">
              Car insurance, a holiday, Christmas. The costs that only come round now and then
              are the ones that catch people out. Tell Sovereign about one and it will put a bit
              by each month so it is there when you need it.
            </p>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Start saving for something
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {pots.map((pot) => (
              <PotCard
                key={pot.envelopeId}
                pot={pot}
                onTopUp={() => setToppingUp(pot)}
                onEdit={() => setEditing(pot)}
              />
            ))}
          </div>
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Add another pot
          </Button>
        </>
      )}

      <PotSheet open={creating} onClose={() => setCreating(false)} />
      <PotSheet open={editing !== null} onClose={() => setEditing(null)} editing={editing} />
      <TopUpSheet open={toppingUp !== null} onClose={() => setToppingUp(null)} pot={toppingUp} />
    </div>
  );
}

function PotCard({
  pot,
  onTopUp,
  onEdit,
}: {
  pot: PotPlan;
  onTopUp: () => void;
  onEdit: () => void;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);

  return (
    <Card padding="normal">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={onEdit} className="text-left">
              <h3 className="truncate text-body font-medium text-ink">{pot.name}</h3>
            </button>
            <p className="pt-0.5 text-caption text-ink-3">
              {pot.kind === 'monthly'
                ? 'Topped up every month'
                : pot.targetDate
                  ? `Needed by ${describeDate(pot.targetDate, locale)}`
                  : 'No deadline'}
              {pot.recurring ? ' · comes round every year' : ''}
            </p>
          </div>
          <span
            className={clsx(
              'shrink-0 rounded-pill px-2 py-0.5 text-micro font-medium',
              CHIP[pot.status],
            )}
          >
            {potStatusLabel(pot.status)}
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <Money value={pot.currentBalance} size="figure" tone="liquid" />
          <span className="tnum text-caption text-ink-3">
            of {money.format(pot.targetAmount)}
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-pill bg-sunken">
          <div
            className={clsx('h-full rounded-pill transition-[width] duration-500', BAR[pot.status])}
            style={{ width: `${pot.percentFunded}%` }}
          />
        </div>

        <p className="max-w-[46ch] text-caption text-ink-2">
          {describePot(pot, (amount) => money.format(amount))}
        </p>

        <div className="flex gap-2">
          <Button variant={pot.status === 'behind' || pot.status === 'overdue' ? 'primary' : 'secondary'} size="sm" onClick={onTopUp}>
            {pot.status === 'behind' || pot.status === 'overdue' ? 'Catch up' : 'Put money in'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Change it
          </Button>
        </div>
      </div>
    </Card>
  );
}
