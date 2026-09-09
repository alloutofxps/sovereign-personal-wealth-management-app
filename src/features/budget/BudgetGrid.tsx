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
// No `paceTone` here on purpose: a tile's colour is its category, never its
// status. The pace is drawn — the arc against the tick — rather than tinted.
import { describeEnvelopePace, envelopePace } from '@/core/budget';
import { assignOnDate } from '@/app/ledger/actions';
import { toIsoDate } from '@/core/liquidity';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Card, Explain, Money, Ring, Tile } from '@/design/ui';
import { familyFor } from '@/design/category';
import { useExplain } from '@/features/explain/useExplain';
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

  const explain = useExplain(
    data
      ? {
          assignedThisPeriod: data.plan.current.totalAssigned,
          readyToAssign: data.plan.readyToAssign,
        }
      : {},
  );

  // How far through the period the calendar has got, in basis points. A past
  // period is wholly gone and a future one has not started, so both sit at the
  // ends rather than being measured against today.
  const periodProgressBp = data
    ? mulDivRound(minor(data.cycle.elapsedDays), 10_000, minor(data.cycle.totalDays))
    : 0;
  const pill = data
    ? describeReadyToAssign(data.plan.readyToAssign, (amount) => money.format(amount))
    : null;

  /*
   * The one worth naming, and how many are behind it.
   *
   * Worst by how far over rather than by size, because a small envelope 40
   * over is a more urgent hole than a large one 5 over, and the strip is
   * offering to fix one thing.
   */
  const overspent = (data?.rows ?? []).filter((row) => row.available < 0);
  const overspentCount = overspent.length;
  const worstOverspent =
    overspentCount === 0
      ? null
      : overspent.reduce((worst, row) => (row.available < worst.available ? row : worst));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-1">
        <h1 className="headline text-ink">Envelopes</h1>
        <Explain topic="envelopes" label="giving money a job" onOpen={explain.open} />
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
        <>
          {data.groups.map((group) => (
            <section key={group.groupId} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="section-title text-ink">{group.groupName}</h2>
                <span className="text-caption text-ink-3">
                  <Money value={group.available} size="caption" tone="muted" decimals="hide" />{' '}
                  left
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {group.rows.map((row) => (
                  <EnvelopeTile
                    key={row.envelopeId}
                    row={row}
                    onOpen={() => setAssigning(row)}
                    periodProgressBp={periodProgressBp}
                  />
                ))}
              </div>
            </section>
          ))}

          {data.ungrouped.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="section-title text-ink">Everything else</h2>
              <div className="grid grid-cols-2 gap-3">
                {data.ungrouped.map((row) => (
                  <EnvelopeTile
                    key={row.envelopeId}
                    row={row}
                    onOpen={() => setAssigning(row)}
                    periodProgressBp={periodProgressBp}
                  />
                ))}
              </div>
            </section>
          )}

          {/*
            * THE ONE HOT MARK ON THIS SCREEN.
            *
            * Being over budget is described on the tile itself — the ring
            * completes and the wording turns from "left of" to "over of", both
            * in the envelope's own hue — because that is a fact about a number
            * and every envelope may carry one. Four over means four completed
            * rings, and nothing is hidden.
            *
            * What does not scale is the mark that says LOOK HERE. So there is
            * one, on the action, naming the worst of them. Cover it and the
            * next-worst takes its place, which is how every over-budget
            * envelope stays reachable without five dots on one screen.
            *
            * See "describe every instance; name only the one that needs a
            * decision" in CLAUDE.md.
            */}
          {worstOverspent && (
            <button
              type="button"
              onClick={() => setCovering(worstOverspent)}
              className="press flex items-center gap-3.5 rounded-card bg-ink p-4 text-left text-base"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-hot text-[1.1rem] leading-none"
              >
                ↑
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">
                  {worstOverspent.name} is{' '}
                  <Money
                    value={minor(Math.abs(worstOverspent.available))}
                    size="body"
                    tone="neutral"
                    className="text-inherit"
                  />{' '}
                  over
                </span>
                <span className="block pt-0.5 text-caption opacity-65">
                  {overspentCount > 1
                    ? `${overspentCount - 1} more after this one`
                    : 'Move money across to square it'}
                </span>
              </span>
              <span className="shrink-0 rounded-pill bg-[var(--fill-subtle)] px-3 py-1.5 text-caption font-medium">
                Cover
              </span>
            </button>
          )}
        </>
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
          {explain.sheet}
    </div>
  );
}

/**
 * One envelope, as a tile in its own category's colour.
 *
 * The hue comes from the semantic seed mapping, so an envelope funding rent is
 * verdigris because rent is housing — not because a hash landed there and not
 * because the grid needed a fourth colour in that slot.
 *
 * The ring is the pacing engine's own comparison: how much of the money has
 * gone against how much of the period has. Over budget completes it and the
 * wording turns from "left of" to "over of". Both are descriptions and both
 * scale — see the note on the cover strip above, and the rule in CLAUDE.md.
 */
function EnvelopeTile({
  row,
  onOpen,
  periodProgressBp,
}: {
  row: BudgetRow;
  onOpen: () => void;
  periodProgressBp: number;
}) {
  const money = useMoney();

  /*
   * What this envelope actually had to spend this period.
   *
   * `assigned` alone is the wrong denominator and reads as a bug on screen:
   * an envelope carrying 66 forward and assigned 520 has 586 available, and
   * "586 left of 520" is a sentence nobody can make sense of. What was left is
   * left of everything that was in it, which is what was put in plus what came
   * over from last period.
   */
  const pot = minor(row.assigned + row.broughtForward);
  const pace = envelopePace({
    assignedMinor: row.assigned,
    // Activity is stored as a negative for money going out; the pacing engine
    // asks for what was spent, as a positive.
    activityMinor: minor(Math.abs(row.activity)),
    periodProgressBp,
  });

  const over = row.available < 0;
  const spentFraction = pot > 0 ? Math.abs(row.activity) / pot : 0;
  // No symbol: this sits inside a sentence fragment under an amount that
  // already carries one, and two symbols on one tile reads as two figures.
  const total = money.format(pot, { display: 'none', decimals: 'hide' });

  return (
    <Tile
      family={familyFor(row.envelopeId)}
      onClick={onOpen}
      aria-label={`${row.name}, ${over ? 'over budget' : 'within budget'}`}
    >
      <Ring
        progress={spentFraction}
        mark={periodProgressBp / 10_000}
        size={58}
        weight={6}
        aria-label={describeEnvelopePace(pace, row.name)}
      >
        {Math.round(pace.spentPercentBp / 100)}
      </Ring>

      <div className="truncate pt-3 text-body font-medium">{row.name}</div>
      <div className="pt-1.5">
        <Money
          value={minor(Math.abs(row.available))}
          size="lead"
          tone="neutral"
          decimals="hide"
        />
      </div>
      <div className="truncate pt-0.5 text-caption opacity-70">
        {pot === 0 ? 'nothing assigned yet' : `${over ? 'over of' : 'left of'} ${total}`}
      </div>
    </Tile>
  );
}

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
