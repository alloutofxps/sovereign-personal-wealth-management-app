/* ===========================================================================
 * GIVING EVERY UNIT A JOB
 * ---------------------------------------------------------------------------
 * The screen somebody sits down with once a month. Four columns, because there
 * are exactly four things worth knowing about a pot: what it is, what you put
 * in, what went out, and what is left.
 *
 * The pill at the top is the whole point of zero-based budgeting, and its most
 * important state is zero. Every other app treats zero as an empty result; here
 * it is the finish line, and it says so.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { minor, mulDivRound, type Minor } from '@/core/money';
import { describeCycle } from '@/core/liquidity';
import { describeReadyToAssign } from '@/core/budget';
import {
  dateInsideCycle,
  useBudget,
  useBudgetPeriod,
  type BudgetRow,
} from '@/app/budget/useBudget';
import {
  describeEnvelopePace,
  envelopePace,
  paceTone,
  type EnvelopePace,
} from '@/core/budget';
import { assignOnDate } from '@/app/ledger/actions';
import { toIsoDate } from '@/core/liquidity';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Card, Money } from '@/design/ui';
import { BudgetSettingsCard } from './BudgetSettingsCard';
import { QuickAssignSheet } from './QuickAssignSheet';
import { QuickCoverSheet } from './QuickCoverSheet';

export function BudgetGrid() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const period = useBudgetPeriod();
  const budget = useBudget(period.offset);

  const [assigning, setAssigning] = useState<BudgetRow | null>(null);
  const [covering, setCovering] = useState<BudgetRow | null>(null);
  const [quickAssign, setQuickAssign] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  const data = budget.data;

  // How far through the period the calendar has got, in basis points. A past
  // period is wholly gone and a future one has not started, so both sit at the
  // ends rather than being measured against today.
  const periodProgressBp = data
    ? mulDivRound(minor(data.cycle.elapsedDays), 10_000, minor(data.cycle.totalDays))
    : 0;
  const pill = data
    ? describeReadyToAssign(data.plan.readyToAssign, (amount) => money.format(amount))
    : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Give every pound a job</h1>
        <p className="text-caption text-ink-2">
          Decide what your money is for before you spend it, one period at a time.
        </p>
      </header>

      {/* --- which period ------------------------------------------------- */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="The period before"
          onClick={period.previous}
          className="flex size-10 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        >
          <Chevron direction="left" />
        </button>

        <div className="flex flex-col items-center">
          <span className="text-body font-medium text-ink">
            {data ? describeCycle(data.cycle, data.settings.cadence, locale) : '…'}
          </span>
          {!period.isCurrent && (
            <button
              type="button"
              onClick={period.backToNow}
              className="text-caption text-liquid"
            >
              Back to now
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="The period after"
          onClick={period.next}
          className="flex size-10 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink"
        >
          <Chevron direction="right" />
        </button>
      </div>

      {/* --- ready to assign ---------------------------------------------- */}
      {pill && data && (
        <Card accent={pill.tone === 'deficit' ? 'deficit' : 'liquid'}>
          <div className="flex flex-col gap-2">
            <p
              className={clsx(
                'text-lead font-medium',
                pill.tone === 'deficit' ? 'text-deficit' : 'text-liquid',
              )}
            >
              {pill.headline}
            </p>
            <p className="text-caption text-ink-2">{pill.detail}</p>

            {data.plan.futureOverReach > 0 && (
              <p className="text-caption text-caution">
                You have promised {money.format(data.plan.futureOverReach)} to later periods
                than you actually have. Take some back before it catches you out.
              </p>
            )}

            {data.plan.current.absorbedFromLastPeriod > 0 && (
              <p className="text-caption text-ink-3">
                {money.format(data.plan.current.absorbedFromLastPeriod)} of last period&rsquo;s
                overspending has come out of this one.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setQuickAssign(true)}>
                Quick assign
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* --- the grid ------------------------------------------------------ */}
      {data === undefined ? (
        <Card>
          <p className="py-8 text-center text-caption text-ink-3">Adding it up…</p>
        </Card>
      ) : data.rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">No pots to fill yet</p>
            <p className="max-w-[36ch] text-caption text-ink-2">
              Categories become pots you can put money into. Add one and it will appear here.
            </p>
            <Button variant="secondary" onClick={() => navigate('categories')}>
              Manage categories
            </Button>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div
            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-2"
            aria-hidden="true"
          >
            <span className="text-caption text-ink-3">Pot</span>
            <span className="text-right text-caption text-ink-3">
              In
            </span>
            <span className="text-right text-caption text-ink-3">
              Out
            </span>
            <span className="text-right text-caption text-ink-3">
              Left
            </span>
          </div>

          <ul className="divide-y divide-line-faint">
            {data.groups.map((group) => (
              <li key={group.groupId}>
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 bg-sunken/60 px-4 py-2">
                  <span className="truncate text-caption font-medium text-ink-2">
                    {group.groupName}
                  </span>
                  <Money value={group.assigned} size="caption" tone="muted" />
                  <Money value={group.activity} size="caption" tone="muted" />
                  <Money
                    value={group.available}
                    size="caption"
                    tone={group.available < 0 ? 'deficit' : 'muted'}
                  />
                </div>

                <ul>
                  {group.rows.map((row) => (
                    <Row
                      key={row.envelopeId}
                      row={row}
                      onAssign={() => setAssigning(row)}
                      onCover={() => setCovering(row)}
                      onActivity={() => navigate('transactions')}
                      periodProgressBp={periodProgressBp}
                    />
                  ))}
                </ul>
              </li>
            ))}

            {data.ungrouped.map((row) => (
              <Row
                key={row.envelopeId}
                row={row}
                onAssign={() => setAssigning(row)}
                onCover={() => setCovering(row)}
                onActivity={() => navigate('transactions')}
                periodProgressBp={periodProgressBp}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* --- how the budget is shaped -------------------------------------- */}
      {showSetup ? (
        <BudgetSettingsCard />
      ) : (
        <button
          type="button"
          onClick={() => setShowSetup(true)}
          className="self-start text-caption text-liquid"
        >
          Change how your budget is divided up
        </button>
      )}

      {data && (
        <>
          <AssignSheet
            row={assigning}
            onClose={() => setAssigning(null)}
            date={dateInsideCycle(data.cycle, toIsoDate(new Date()))}
            periodLabel={describeCycle(data.cycle, data.settings.cadence, locale)}
          />
          <QuickCoverSheet
            row={covering}
            rows={data.rows}
            readyToAssign={data.plan.readyToAssign}
            date={dateInsideCycle(data.cycle, toIsoDate(new Date()))}
            onClose={() => setCovering(null)}
          />
          <QuickAssignSheet
            open={quickAssign}
            onClose={() => setQuickAssign(false)}
            rows={data.rows}
            readyToAssign={data.plan.readyToAssign}
            date={dateInsideCycle(data.cycle, toIsoDate(new Date()))}
          />
        </>
      )}
    </div>
  );
}

function Row({
  row,
  onAssign,
  onCover,
  onActivity,
  periodProgressBp,
}: {
  row: BudgetRow;
  onAssign: () => void;
  onCover: () => void;
  onActivity: () => void;
  periodProgressBp: number;
}) {
  const pace = envelopePace({
    assignedMinor: row.assigned,
    // Activity is stored as a negative for money going out; the pacing engine
    // asks for what was spent, as a positive.
    activityMinor: minor(Math.abs(row.activity)),
    periodProgressBp,
  });

  return (
    <li className="grid grid-cols-[1fr_auto_auto_auto] items-start gap-x-3 px-4 py-2.5">
      <button
        type="button"
        onClick={row.overspent ? onCover : onAssign}
        className="min-w-0 text-left"
      >
        <span className="block truncate text-body text-ink">{row.name}</span>
        {row.targetAmount !== null && row.targetAmount > 0 && (
          <span className="block truncate text-caption text-ink-3">
            Aiming for <Money value={row.targetAmount} size="caption" tone="muted" />
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onAssign}
        aria-label={`Assign money to ${row.name}`}
        className="rounded-md px-2 py-1 text-right transition-colors hover:bg-raised"
      >
        <Money value={row.assigned} size="caption" tone={row.assigned > 0 ? 'neutral' : 'muted'} />
      </button>

      <button
        type="button"
        onClick={onActivity}
        aria-label={`What went out of ${row.name}`}
        className="rounded-md px-2 py-1 text-right transition-colors hover:bg-raised"
      >
        <Money value={row.activity} size="caption" tone="muted" />
      </button>

      <button
        type="button"
        onClick={row.overspent ? onCover : onAssign}
        className="rounded-md px-2 py-1 text-right transition-colors hover:bg-raised"
      >
        <Money
          value={row.available}
          size="caption"
          // Emerald when there is money to use, clay when it has been
          // overspent, and deliberately quiet at exactly zero — a pot that has
          // done its job is not an alert.
          tone={row.available > 0 ? 'liquid' : row.available < 0 ? 'deficit' : 'muted'}
        />
        <PacingBar pace={pace} name={row.name} />
      </button>
    </li>
  );
}

/**
 * How fast one pot is going, against how fast the period is.
 *
 * Two pixels high and the width of the Available column. It is reference
 * information somebody looks for when they are looking for it — a full-width
 * bar on every row would make the grid about pacing, which is not what the
 * grid is for.
 *
 * The tick is the calendar. When the fill is left of it there is more money
 * than month; when it is right, the pot is going faster than the days are.
 */
function PacingBar({ pace, name }: { pace: EnvelopePace; name: string }) {
  if (pace.status === 'unbudgeted') return null;

  const filled = Math.min(100, pace.spentPercentBp / 100);
  const marker = Math.min(100, pace.periodProgressBp / 100);
  const tone = paceTone(pace);

  return (
    <span
      className="relative mt-1 block h-[2px] w-full overflow-hidden rounded-pill bg-line"
      role="img"
      aria-label={describeEnvelopePace(pace, name)}
      title={describeEnvelopePace(pace, name)}
    >
      <span
        className={clsx(
          'absolute inset-y-0 left-0 rounded-pill',
          tone === 'caution' ? 'bg-caution' : tone === 'liquid' ? 'bg-liquid' : 'bg-ink-4',
        )}
        style={{ width: `${filled}%` }}
      />
      {/* Where the calendar has got to. */}
      <span
        className="absolute inset-y-0 w-px bg-ink-3"
        style={{ left: `${marker}%` }}
      />
    </span>
  );
}

/** Put money into one pot, for the period on screen. */
function AssignSheet({
  row,
  onClose,
  date,
  periodLabel,
}: {
  row: BudgetRow | null;
  onClose: () => void;
  date: string;
  periodLabel: string;
}) {
  const money = useMoney();
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [busy, setBusy] = useState(false);

  // The sheet stays mounted between openings, so without this it would still
  // be holding the last pot's figure — and typing would append to it. Start
  // from what this pot already has, which is also what "make it this" means.
  useEffect(() => {
    if (row) setAmount(row.assigned);
  }, [row]);

  async function save() {
    if (!row) return;
    setBusy(true);
    try {
      // The difference, not the total: the grid shows what has been assigned
      // this period, and typing a new figure means "make it this".
      await assignOnDate(row.envelopeId, row.name, minor(amount - row.assigned), date as never);
      toast(`${row.name} has ${money.format(amount)} for ${periodLabel}.`);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be saved.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={row !== null}
      onClose={onClose}
      title={row ? `How much for ${row.name}?` : 'How much?'}
      description={`This is for ${periodLabel}. You can change it whenever you like.`}
      footer={
        <Button variant="primary" block disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Set it'}
        </Button>
      }
    >
      {row && (
        <div className="flex flex-col gap-4 pb-2">
          <AmountInput
            value={amount}
            onChange={setAmount}
            onSubmit={() => void save()}
            label="Assigned this period"
            hint={
              row.broughtForward !== 0
                ? `${money.format(row.broughtForward)} carried in from last period.`
                : 'What goes into this pot for this period.'
            }
          />
        </div>
      )}
    </BottomSheet>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
