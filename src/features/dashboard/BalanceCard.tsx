/* ===========================================================================
 * WHAT YOU ARE WORTH, ON TODAY
 * ---------------------------------------------------------------------------
 * The same arithmetic as the Net worth screen, at a glance and one tap from
 * the whole thing. It is a card rather than a field because Today already has
 * its field, and a screen with two is a screen with none.
 *
 * ---------------------------------------------------------------------------
 * THE PAIRED BAR SAYS THE SUM
 *
 * Two segments in the two families — housing for what is held, obligation for
 * what is owed — sized against each other. That is the subtraction shown
 * rather than narrated, and it is why the sentence that used to sit under it
 * could go.
 *
 * The card-cover line stays, because it is not a description of the bar. It
 * answers a different question: whether the money set aside actually covers
 * the card, which is a fact about two numbers neither of which is on screen.
 * ======================================================================== */

import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import type { ExplainTopic } from '@/content/explain';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { Card, Explain, Money } from '@/design/ui';

export function BalanceCard({
  data,
  onExplainTopic,
  onOpen,
}: {
  data: DashboardData;
  onExplainTopic: (topic: ExplainTopic) => void;
  /** Through to the balance sheet, where the same figure is the field. */
  onOpen: () => void;
}) {
  const have = Math.max(0, data.liquidCash);
  const owe = Math.max(0, data.totalDebt);

  return (
    <Card
      label="What you are worth"
      action={<Explain topic="net-worth" label="what you are worth" onOpen={onExplainTopic} />}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="See the whole balance sheet"
        className="press-row -mx-2 w-full rounded-lg px-2 py-1 text-left"
      >
        <div className="flex items-end justify-between gap-4">
          <Money
            value={data.netWorth}
            size="figure"
            tone={data.netWorth < 0 ? 'deficit' : 'neutral'}
          />
          {data.netWorthChange !== 0 && (
            <span
              className={clsx(
                'rounded-pill px-2.5 py-1 text-micro font-medium',
                data.netWorthChange > 0
                  ? 'bg-liquid-wash text-liquid'
                  : 'bg-sunken text-ink-2',
              )}
            >
              {data.netWorthChange > 0 ? '↑ ' : '↓ '}
              <Money
                value={absolute(data.netWorthChange)}
                size="caption"
                tone="neutral"
                decimals="hide"
                className="text-inherit"
              />
              <span className="pl-1">this month</span>
            </span>
          )}
        </div>

        {/* The subtraction, shown. Two families held against each other. */}
        <div className="flex items-center gap-1.5 pt-4" aria-hidden="true">
          <div
            className="h-2.5 rounded-pill bg-[var(--color-housing)]"
            style={{ flex: Math.max(1, have) }}
          />
          <div
            className="h-2.5 rounded-pill bg-[var(--color-obligation)]"
            style={{ flex: Math.max(1, owe) }}
          />
        </div>

        <div className="flex justify-between pt-2 text-caption text-ink-2">
          <span className="flex items-center gap-1.5">
            <Swatch className="bg-[var(--color-housing)]" />
            <Money value={data.liquidCash} size="caption" tone="neutral" decimals="hide" /> held
          </span>
          <span className="flex items-center gap-1.5">
            <Swatch className="bg-[var(--color-obligation)]" />
            <Money value={data.totalDebt} size="caption" tone="neutral" decimals="hide" /> owed
          </span>
        </div>
      </button>

      {data.totalDebt > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-caption text-ink-2">
          {data.billsCovered
            ? 'Your cards already have the money waiting for them.'
            : 'Part of your card bill is not covered yet.'}
        </p>
      )}
    </Card>
  );
}

function Swatch({ className }: { className: string }) {
  return <span aria-hidden="true" className={clsx('size-2 shrink-0 rounded-full', className)} />;
}

/** The change, as a magnitude — the arrow beside it carries the direction. */
function absolute(amount: Minor): Minor {
  return minor(Math.abs(amount));
}
