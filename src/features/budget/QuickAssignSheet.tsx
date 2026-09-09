/* ===========================================================================
 * THE ONE-TAP HELPERS
 * ---------------------------------------------------------------------------
 * Three shortcuts through the tedious part of budgeting. Each says exactly
 * what it will do before it does it, because an automation whose effect you
 * cannot predict is one you stop trusting after the first surprise.
 *
 * They are rows on the sheet rather than three bordered boxes inside it. The
 * sheet is already a surface; drawing a second edge around each option said
 * "three components" when what is on offer is one choice out of three.
 * ======================================================================== */

import { useState } from 'react';
import { minor, type Minor } from '@/core/money';
import { quickAssignToTargets } from '@/core/budget';
import type { BudgetRow } from '@/app/budget/useBudget';
import { assignOnDate } from '@/app/ledger/actions';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Button } from '@/design/ui';

export function QuickAssignSheet({
  open,
  onClose,
  rows,
  readyToAssign,
  date,
}: {
  open: boolean;
  onClose: () => void;
  rows: readonly BudgetRow[];
  readyToAssign: Minor;
  date: string;
}) {
  const money = useMoney();
  const [busy, setBusy] = useState<string | null>(null);

  // Pots with a target that are not yet full, biggest shortfall last so the
  // small, nearly-finished ones get completed first.
  const targets = rows
    .filter((row) => row.targetAmount !== null && row.targetAmount > 0)
    .map((row) => ({
      envelopeId: row.envelopeId,
      wanted: row.targetAmount!,
      available: row.available,
      name: row.name,
    }))
    .filter((row) => row.available < row.wanted)
    .sort((a, b) => a.wanted - a.available - (b.wanted - b.available));

  const planned = quickAssignToTargets(targets, readyToAssign);
  const plannedTotal = minor(planned.reduce((total, item) => total + item.amount, 0));

  async function run(name: string, work: () => Promise<void>, done: string) {
    setBusy(name);
    try {
      await work();
      toast(done);
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be done.', {
        tone: 'attention',
      });
    }
    setBusy(null);
  }

  const nameOf = (id: string) => rows.find((r) => r.envelopeId === id)?.name ?? 'a pot';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title="Fill things in for me"
      description="Shortcuts through the repetitive part. Nothing happens until you pick one."
    >
      <div className="flex flex-col divide-y divide-line-faint pb-2">
        <Option
          title="Top up everything saving towards something"
          detail={
            planned.length === 0
              ? readyToAssign <= 0
                ? 'There is nothing left to assign at the moment.'
                : 'Everything with a target is already full.'
              : `Puts ${money.format(plannedTotal)} across ${planned.length} ` +
                `${planned.length === 1 ? 'pot' : 'pots'}, starting with ${nameOf(planned[0]!.envelopeId)}.`
          }
          disabled={planned.length === 0}
          busy={busy === 'targets'}
          onClick={() =>
            void run(
              'targets',
              async () => {
                for (const item of planned) {
                  await assignOnDate(
                    item.envelopeId as never,
                    nameOf(item.envelopeId),
                    item.amount,
                    date as never,
                  );
                }
              },
              `Topped up ${planned.length} ${planned.length === 1 ? 'pot' : 'pots'}.`,
            )
          }
        />

        <Option
          title="Do the same as last period"
          detail="Copies what each pot was given last time, on top of anything already assigned."
          disabled={rows.every((row) => row.broughtForward === 0)}
          busy={busy === 'repeat'}
          onClick={() =>
            void run(
              'repeat',
              async () => {
                for (const row of rows) {
                  // What it started with is what last period left it, which is
                  // the closest thing to "the same again" the ledger holds.
                  const again = minor(Math.max(0, row.broughtForward - row.assigned));
                  if (again > 0) {
                    await assignOnDate(row.envelopeId, row.name, again, date as never);
                  }
                }
              },
              'Matched what you did last period.',
            )
          }
        />

        <Option
          title="Start this period from nothing"
          detail="Takes back everything assigned in this period. What was carried in stays put."
          disabled={rows.every((row) => row.assigned === 0)}
          busy={busy === 'reset'}
          onClick={() =>
            void run(
              'reset',
              async () => {
                for (const row of rows) {
                  if (row.assigned !== 0) {
                    await assignOnDate(
                      row.envelopeId,
                      row.name,
                      minor(-row.assigned),
                      date as never,
                    );
                  }
                }
              },
              'Cleared what was assigned this period.',
            )
          }
        />
      </div>
    </BottomSheet>
  );
}

function Option({
  title,
  detail,
  disabled,
  busy,
  onClick,
}: {
  title: string;
  detail: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-1">
      <span className="text-body text-ink">{title}</span>
      <span className="max-w-[46ch] text-caption text-ink-2">{detail}</span>
      <div className="pt-0.5">
        <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={onClick}>
          {busy ? 'Working…' : 'Do this'}
        </Button>
      </div>
    </div>
  );
}
