/* ===========================================================================
 * COVERING AN OVERSPEND
 * ---------------------------------------------------------------------------
 * A pot has gone under. The money is already spent — that cannot be undone
 * here — so the only question left is which other pot gives it up.
 *
 * The tone matters more than the mechanism. Going over on one category is the
 * most ordinary thing in budgeting, and an app that treats it as a failure
 * teaches people to stop opening it. So: no red, no warning triangle, no
 * language of error. A short statement of what happened and a list of ways to
 * settle it.
 *
 * Each source carries its own category hue and a bar showing how much of it
 * this would take. That is the whole decision - "which pot can afford this" -
 * and it is a proportion, so it is drawn as one rather than described twice in
 * a sentence.
 * ======================================================================== */

import { useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import { rankCoverSources } from '@/core/budget';
import type { BudgetRow } from '@/app/budget/useBudget';
import { assignOnDate, moveBetweenEnvelopes } from '@/app/ledger/actions';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { familyClassFor } from '@/design/category';
import { BottomSheet, Explain, MiniBar } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function QuickCoverSheet({
  row,
  rows,
  readyToAssign,
  date,
  onClose,
}: {
  row: BudgetRow | null;
  rows: readonly BudgetRow[];
  readyToAssign: Minor;
  date: string;
  onClose: () => void;
}) {
  const money = useMoney();
  const [busy, setBusy] = useState<string | null>(null);
  const explain = useExplain();

  const needed = row ? minor(-row.available) : minor(0);

  const sources = row
    ? rankCoverSources(
        rows
          .filter((other) => other.envelopeId !== row.envelopeId && other.available > 0)
          .map((other) => ({
            envelopeId: other.envelopeId,
            name: other.name,
            available: other.available,
          })),
        needed,
      )
    : [];

  async function coverFrom(source: { envelopeId: string; name: string; available: Minor } | null) {
    if (!row) return;
    const take = source ? minor(Math.min(source.available, needed)) : needed;
    setBusy(source?.envelopeId ?? 'rta');

    try {
      if (source) {
        await moveBetweenEnvelopes(
          { id: source.envelopeId as never, name: source.name },
          { id: row.envelopeId, name: row.name },
          take,
          date as never,
        );
        toast(
          take === needed
            ? `${row.name} is back to nothing owing, using ${money.format(take)} from ${source.name}.`
            : `Moved ${money.format(take)} from ${source.name}. ${row.name} still needs ` +
              `${money.format(minor(needed - take))}.`,
        );
      } else {
        await assignOnDate(row.envelopeId, row.name, take, date as never);
        toast(`${row.name} is back to nothing owing.`);
      }
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be moved.', {
        tone: 'attention',
      });
    }
    setBusy(null);
  }

  return (
    <BottomSheet
      open={row !== null}
      onClose={onClose}
      size="tall"
      title={row ? `${row.name} has gone over` : 'Cover an overspend'}
    >
      {row && (
        <div className="flex flex-col pb-2">
          <p className="max-w-[46ch] pb-2 text-body text-ink">
            You spent {money.format(needed)} more on {row.name} than was put by for it. Choose
            where that comes from and the pot goes back to nothing owing.
          </p>

          <div className="flex flex-col divide-y divide-line-faint">
            {readyToAssign > 0 && (
              <Choice
                title="From money not yet given a job"
                detail={`${money.format(readyToAssign)} is waiting to be assigned.`}
                fraction={needed / readyToAssign}
                busy={busy === 'rta'}
                onClick={() => void coverFrom(null)}
              />
            )}

            {sources.map(({ source, covers, leaves }) => (
              <Choice
                key={source.envelopeId}
                envelopeId={source.envelopeId}
                title={source.name}
                detail={
                  covers
                    ? `Takes ${money.format(needed)} and leaves ${money.format(leaves)}.`
                    : `Only has ${money.format(source.available)}, so it would cover part of it.`
                }
                fraction={needed / source.available}
                busy={busy === source.envelopeId}
                onClick={() => void coverFrom(source)}
              />
            ))}
          </div>

          {sources.length === 0 && readyToAssign <= 0 && (
            <p className="max-w-[46ch] text-caption text-ink-2">
              Nothing to move across: every other pot is empty too. This one settles itself
              when money next comes in.
            </p>
          )}

          <div className="flex justify-end pt-4">
            <Explain topic="cover" label="covering a pot" onOpen={explain.open} />
          </div>
        </div>
      )}
      {explain.sheet}
    </BottomSheet>
  );
}

function Choice({
  envelopeId,
  title,
  detail,
  fraction,
  busy,
  onClick,
}: {
  /** Absent for ready-to-assign, which is not a category and takes no hue. */
  envelopeId?: string;
  title: string;
  detail: string;
  /** How much of this source the cover would take. Clamped by `MiniBar`. */
  fraction: number;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={clsx(
        envelopeId ? familyClassFor(envelopeId) : '',
        'press flex flex-col gap-1 py-3.5 text-left disabled:opacity-60',
      )}
    >
      <span className="flex items-baseline gap-2">
        {envelopeId && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 translate-y-px rounded-pill bg-[var(--tile-ink)]"
          />
        )}
        <span className="text-body text-ink">{busy ? 'Moving…' : title}</span>
      </span>
      <span className="text-caption text-ink-2">{detail}</span>
      {/* How much of this pot it would use. A full bar means it would empty it. */}
      <MiniBar fraction={fraction} className="w-full" />
    </button>
  );
}
