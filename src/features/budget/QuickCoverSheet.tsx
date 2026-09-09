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
 * ======================================================================== */

import { useState } from 'react';
import { minor, type Minor } from '@/core/money';
import { rankCoverSources } from '@/core/budget';
import type { BudgetRow } from '@/app/budget/useBudget';
import { assignOnDate, moveBetweenEnvelopes } from '@/app/ledger/actions';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { BottomSheet, Explain } from '@/design/ui';
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
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink">
            You spent {money.format(needed)} more on {row.name} than was put by for
            it. Choose where that comes from and the pot goes back to nothing owing.
          </p>

          {readyToAssign > 0 && (
            <Choice
              title="From money not yet given a job"
              detail={`${money.format(readyToAssign)} is waiting to be assigned.`}
              busy={busy === 'rta'}
              onClick={() => void coverFrom(null)}
            />
          )}

          {sources.length === 0 && readyToAssign <= 0 ? (
            <p className="text-caption text-ink-2">
              Every other pot is empty too, so there is nothing to move across. This one will
              settle itself when money next comes in.
            </p>
          ) : (
            sources.map(({ source, covers, leaves }) => (
              <Choice
                key={source.envelopeId}
                title={`From ${source.name}`}
                detail={
                  covers
                    ? `Takes ${money.format(needed)} and leaves ${money.format(leaves)}.`
                    : `Only has ${money.format(source.available)}, so it would cover part of it.`
                }
                busy={busy === source.envelopeId}
                onClick={() => void coverFrom(source)}
              />
            ))
          )}
        </div>
      )}
    <div className="flex justify-end pb-2">
        <Explain topic="cover" label="covering a pot" onOpen={explain.open} />
      </div>
      {explain.sheet}
      
      </BottomSheet>
  );
}

function Choice({
  title,
  detail,
  busy,
  onClick,
}: {
  title: string;
  detail: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex flex-col gap-1 rounded-md border border-line bg-raised px-3.5 py-3 text-left transition-colors hover:border-line-strong disabled:opacity-60"
    >
      <span className="text-body text-ink">{busy ? 'Moving…' : title}</span>
      <span className="text-caption text-ink-3">{detail}</span>
    </button>
  );
}
