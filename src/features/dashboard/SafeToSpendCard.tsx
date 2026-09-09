/* ===========================================================================
 * THE LIQUIDITY ANCHOR
 * ---------------------------------------------------------------------------
 * The one figure the product is built around, and the one field on this
 * screen. Everything else on Today steps down from it.
 *
 * It takes the housing verdigris because that hue is the app's spine — the
 * same one the everyday accounts carry on the balance sheet, so the colour
 * already means "the money you actually have" before anybody reads a word.
 *
 * ---------------------------------------------------------------------------
 * THE RING ANSWERS "HOW LONG", WHICH USED TO BE A SENTENCE
 *
 * Days until you are paid, drawn as an arc. That question was previously
 * answered by a caption under the figure and a cell in a grid of three. As a
 * dial it is read in a glance and costs no words, which is the whole argument
 * for this redesign in one component.
 *
 * ---------------------------------------------------------------------------
 * TWO QUESTIONS, TWO SHEETS
 *
 * Tapping the figure opens the breakdown — every bill by name, every
 * subtraction itemised — which is what somebody wants when they disagree with
 * the number. The information button opens the explanation, which is what
 * somebody wants the first time they see it. The header sits outside the
 * tappable area because a button inside a button is invalid, and because
 * collapsing the two questions into one sheet would answer neither well.
 * ======================================================================== */

import { minor, type Minor } from '@/core/money';
import type { ExplainTopic } from '@/content/explain';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { Explain, Field, Money, Ring, StatCell, StatStrip } from '@/design/ui';

export function SafeToSpendCard({
  data,
  onExplain,
  onExplainTopic,
}: {
  data: DashboardData;
  /** Opens the itemised breakdown of this household's own figures. */
  onExplain: () => void;
  /** Opens the explanation of what the figure is. */
  onExplainTopic: (topic: ExplainTopic) => void;
}) {
  const { liquidity, cycle } = data;
  const short = liquidity.safeToSpend < 0;
  const days = liquidity.daysUntilIncome;

  /*
   * How much of the wait is behind you.
   *
   * Drawn against the cycle rather than against a fixed month, because
   * somebody paid fortnightly is not living in months. When there is no
   * payday on record there is nothing to draw and the ring does not appear —
   * an empty dial reads as "zero days", which is the opposite of "unknown".
   */
  const elapsed = cycle.totalDays > 0 ? cycle.elapsedDays / cycle.totalDays : 0;

  return (
    <Field family="housing">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-caption opacity-75">Safe to spend</span>
            <Explain
              topic="safe-to-spend"
              label="what is safe to spend"
              onOpen={onExplainTopic}
              className="text-[var(--tile-ink)] opacity-70"
            />
          </div>

          <button
            type="button"
            onClick={onExplain}
            aria-label="See what has been taken off"
            className="press-row -mx-1 mt-1 block rounded-lg px-1 text-left"
          >
            <Money
              value={liquidity.safeToSpend}
              size="anchor"
              tone="neutral"
              className="text-[var(--tile-ink)]"
            />
          </button>
        </div>

        {days !== null && (
          <Ring
            progress={elapsed}
            caption="DAYS"
            aria-label={
              days === 0 ? 'You are paid today' : `${days} days until you are next paid`
            }
          >
            {days}
          </Ring>
        )}
      </div>

      {short && (
        <p className="pt-2 text-caption opacity-80">
          Your bills and cushion come to more than you hold today.
        </p>
      )}

      <StatStrip className="pt-5">
        <StatCell label="A day">
          {liquidity.dailyPace > 0 ? (
            <Money value={liquidity.dailyPace} size="lead" tone="neutral" decimals="hide" />
          ) : (
            <span className="opacity-60">Nothing</span>
          )}
        </StatCell>
        <StatCell label="Cushion">
          <Money value={data.buffer} size="lead" tone="neutral" decimals="hide" />
        </StatCell>
        <StatCell label="Bills left">
          <Money value={billsAhead(data)} size="lead" tone="neutral" decimals="hide" />
        </StatCell>
      </StatStrip>
    </Field>
  );
}

/**
 * What is still to go out before the cycle ends.
 *
 * Bills only, not the card balances that sit in the same breakdown list. A
 * card balance is money already spent waiting to be settled; a bill is money
 * not yet spent. Adding them together under "bills left" would name one thing
 * and show two.
 */
function billsAhead(data: DashboardData): Minor {
  return minor(
    data.liquidity.breakdown
      .filter((line) => line.kind === 'bill')
      .reduce((total, line) => total + line.amount, 0),
  );
}

/** Kept here so the loading state and the real field stay the same shape. */
export function SafeToSpendSkeleton() {
  return (
    <Field family="housing">
      <div className="h-3 w-24 animate-pulse rounded-sm bg-[var(--fill-subtle)]" />
      <div className="mt-4 h-14 w-56 animate-pulse rounded-sm bg-[var(--fill-subtle)]" />
      <div className="mt-6 flex gap-2">
        <div className="h-14 flex-1 animate-pulse rounded-lg bg-[var(--fill-subtle)]" />
        <div className="h-14 flex-1 animate-pulse rounded-lg bg-[var(--fill-subtle)]" />
        <div className="h-14 flex-1 animate-pulse rounded-lg bg-[var(--fill-subtle)]" />
      </div>
    </Field>
  );
}
