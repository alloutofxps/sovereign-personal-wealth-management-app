/* ===========================================================================
 * WHERE THE NEXT DEPOSIT SHOULD GO
 * ---------------------------------------------------------------------------
 * Two tabs, and the order is the argument. First: what you want the portfolio
 * to look like — a decision, made once, calmly. Second: what to do about the
 * gap, with new money offered before selling is, because directing a deposit
 * costs nothing and rebalancing by selling means paying tax on every gain
 * realised on the way.
 *
 * Nothing here tells anybody to trade. It states the gap and what would close
 * it; whether closing it is worth doing depends on a tax position, a horizon
 * and a temperament that this app knows nothing about.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { basisPoints, minor, type BasisPoints, type Minor } from '@/core/money';
import {
  ASSET_CLASS_NAMES,
  describeDepositStep,
  describeRebalance,
  type AssetClass,
  type TargetAllocation,
} from '@/core/investments';
import {
  INVESTMENT_TABLES,
  getRebalancePlan,
  listTargetAllocations,
  saveTargetAllocations,
} from '@/data/repositories/investmentsRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Input, Explain } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

/** The classes worth offering a target for. The rest are rarely deliberate. */
const OFFERED: AssetClass[] = [
  'equity',
  'fixed_income',
  'real_estate',
  'commodity',
  'crypto',
  'cash_equivalent',
];

export function RebalanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const money = useMoney();
  const [tab, setTab] = useState<'targets' | 'plan'>('targets');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [depositText, setDepositText] = useState('');
  const [busy, setBusy] = useState(false);

  const saved = useLiveQuery(
    useCallback(() => listTargetAllocations(), []),
    INVESTMENT_TABLES,
  );

  const deposit = safeAmount(depositText);

  const plan = useLiveQuery(
    useCallback(() => getRebalancePlan(minor(deposit)), [deposit]),
    INVESTMENT_TABLES,
  );

  /*
   * The class furthest from where it was meant to be, for the worked example.
   *
   * Taken from the same plan the sheet renders, so the sentence in the
   * explanation and the rows below it are reading one calculation. Nothing is
   * passed while the plan is still loading or while no targets exist, and the
   * sheet then shows the general example instead of a made-up one.
   */
  const worstLine = (plan.data?.lines ?? []).reduce<
    NonNullable<typeof plan.data>['lines'][number] | null
  >(
    (worst, line) =>
      worst === null || Math.abs(line.driftBp) > Math.abs(worst.driftBp) ? line : worst,
    null,
  );
  const explain = useExplain(
    worstLine
      ? {
          mixCurrentBp: worstLine.currentBp,
          mixTargetBp: worstLine.targetBp,
          mixDepositToFix: minor(Math.max(0, -worstLine.difference)),
        }
      : {},
  );

  // Start from what is saved, so this is editing rather than starting over.
  useEffect(() => {
    if (!open || !saved.data) return;
    const start: Record<string, string> = {};
    for (const target of saved.data) {
      start[target.assetClass] = (target.targetBp / 100).toFixed(2);
    }
    setDraft(start);
  }, [open, saved.data]);

  const drafted: TargetAllocation[] = OFFERED.map((cls) => ({
    assetClass: cls,
    targetBp: basisPoints(safePercentBp(draft[cls] ?? '')),
  })).filter((t) => t.targetBp > 0);

  const total = drafted.reduce((sum, t) => sum + t.targetBp, 0);
  const remaining = 10_000 - total;

  async function saveTargets() {
    setBusy(true);
    try {
      await saveTargetAllocations(drafted);
      toast('Saved what you want your portfolio to look like.');
      setTab('plan');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Those targets could not be saved.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title="Where the next deposit should go"
      description="Decide what you want to hold, then see what would move you towards it."
      footer={
        tab === 'targets' ? (
          <Button
            variant="primary"
            block
            disabled={busy || remaining !== 0}
            onClick={() => void saveTargets()}
          >
            {busy
              ? 'Saving…'
              : remaining === 0
                ? 'Save these targets'
                : remaining > 0
                  ? `${(remaining / 100).toFixed(2)}% still to place`
                  : `${(-remaining / 100).toFixed(2)}% too much`}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex justify-end">
          <Explain topic="rebalance" label="getting back to your mix" onOpen={explain.open} />
        </div>
        {/* --- tabs ------------------------------------------------------ */}
        <div className="flex gap-2">
          <Tab label="What you want" chosen={tab === 'targets'} onChoose={() => setTab('targets')} />
          <Tab label="What to do" chosen={tab === 'plan'} onChoose={() => setTab('plan')} />
        </div>

        {tab === 'targets' ? (
          <>
            <p className="text-caption text-ink-2">
              They have to add up to 100%.
            </p>

            <ul className="flex flex-col gap-2.5">
              {OFFERED.map((cls) => (
                <li key={cls} className="flex items-center justify-between gap-3">
                  <span className="text-body text-ink">{ASSET_CLASS_NAMES[cls]}</span>
                  <span className="flex w-28 shrink-0 items-baseline gap-1">
                    <Input
                      aria-label={`Target for ${ASSET_CLASS_NAMES[cls]}`}
                      value={draft[cls] ?? ''}
                      onChange={(e) =>
                        setDraft((current) => ({ ...current, [cls]: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="0"
                    />
                    <span className="text-caption text-ink-3">%</span>
                  </span>
                </li>
              ))}
            </ul>

            <div
              className={clsx(
                'rounded-md border px-3.5 py-3',
                remaining === 0 ? 'border-liquid/40 bg-liquid-wash/40' : 'border-line bg-raised',
              )}
            >
              <p className="tnum text-caption text-ink-2">
                {remaining === 0
                  ? 'That comes to 100.00%. Every part of your portfolio has a home.'
                  : remaining > 0
                    ? `That comes to ${(total / 100).toFixed(2)}%. There is ${(remaining / 100).toFixed(2)}% still to place.`
                    : `That comes to ${(total / 100).toFixed(2)}%, which is ${(-remaining / 100).toFixed(2)}% more than you have.`}
              </p>
            </div>
          </>
        ) : (
          <PlanTab
            plan={plan.data ?? null}
            depositText={depositText}
            onDeposit={setDepositText}
            format={(a) => money.format(a)}
          />
        )}
      </div>
    {explain.sheet}
    </BottomSheet>
  );
}

function PlanTab({
  plan,
  depositText,
  onDeposit,
  format,
}: {
  plan: Awaited<ReturnType<typeof getRebalancePlan>>;
  depositText: string;
  onDeposit: (value: string) => void;
  format: (amount: Minor) => string;
}) {
  if (!plan) {
    return (
      <p className="py-2 text-caption text-ink-2">
        Set your targets first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="New money to invest"
        value={depositText}
        onChange={(e) => onDeposit(e.target.value)}
        placeholder="500.00"
        inputMode="decimal"
        hint="Leave it blank to see the gap without a deposit against it."
      />

      <p className="text-body text-ink">{describeRebalance(plan, format)}</p>

      {/* --- where the deposit goes ------------------------------------ */}
      {plan.depositPlan.length > 0 && (
        <Card label="Where to put it">
          <ul className="flex flex-col gap-2">
            {plan.depositPlan.map((step) => {
              const line = plan.lines.find((l) => l.assetClass === step.assetClass);
              return (
                <li key={step.assetClass} className="text-caption text-ink-2">
                  {describeDepositStep(step, line?.targetBp ?? basisPoints(0), format)}
                </li>
              );
            })}
          </ul>
          {plan.depositRemainder > 0 && (
            <p className="pt-2 text-caption text-ink-3">
              {format(plan.depositRemainder)} is left over. Everything else is already at or
              above its target, so there is nowhere it needs to go.
            </p>
          )}
        </Card>
      )}

      {/* --- the full picture ------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h3 className="section-title text-ink">
          How each part stands
        </h3>
        <Card padding="none">
          <ul className="divide-y divide-line-faint">
            {plan.lines.map((line) => (
              <li
                key={line.assetClass}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-caption text-ink">{line.name}</span>
                  <span className="tnum text-micro text-ink-3">
                    {(line.currentBp / 100).toFixed(2)}% against {(line.targetBp / 100).toFixed(2)}%
                  </span>
                </span>
                <span
                  className={clsx(
                    'tnum shrink-0 rounded-pill px-2 py-0.5 text-micro font-medium',
                    line.difference === 0
                      ? 'bg-raised text-ink-3'
                      : line.difference > 0
                        ? 'bg-liquid-wash text-liquid'
                        : 'bg-caution-wash text-caution',
                  )}
                >
                  {line.difference > 0 ? '+' : line.difference < 0 ? '−' : ''}
                  {format(minor(Math.abs(line.difference)))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-caption text-ink-3">
          A plus means that part is short of your target and a minus means it is over. Closing a
          gap by selling means paying tax on the gains; directing new money at it does not.
        </p>
      </section>
    </div>
  );
}

function Tab({
  label,
  chosen,
  onChoose,
}: {
  label: string;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={clsx(
        'flex-1 rounded-md border px-3 py-2 text-caption transition-colors',
        chosen
          ? 'border-liquid bg-liquid-wash/40 text-liquid'
          : 'border-line bg-raised text-ink-2 hover:border-line-strong',
      )}
    >
      {label}
    </button>
  );
}

function safeAmount(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

/** `"20"` → 2,000 basis points. */
function safePercentBp(input: string): number {
  const cleaned = input.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  return Math.round(Number(cleaned) * 100);
}

export type { BasisPoints };
