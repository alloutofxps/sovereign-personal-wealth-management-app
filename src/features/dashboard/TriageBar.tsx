/* ===========================================================================
 * ANYTHING NEEDING YOU
 * ---------------------------------------------------------------------------
 * Two tiles, side by side, in the grid the reference sheet uses for exactly
 * this: a pair of peers where each is a number and a way in.
 *
 * ---------------------------------------------------------------------------
 * COLOUR HERE IS A CATEGORY, NOT A VERDICT
 *
 * Both tiles are `obligation` clay whether or not anything is waiting, because
 * clay is what a thing-you-owe-attention-to looks like in this app, and a tile
 * that changed hue with its state would be using colour to mean good or bad —
 * which is the one thing the palette is not allowed to do.
 *
 * What does change is the hot dot. It appears on at most one of these, on the
 * single thing that genuinely needs a decision, and it is the only hot mark on
 * the screen apart from the record button. Two dots would be two decisions,
 * and the point of the mark is that there is one.
 * ======================================================================== */

import { ZERO, minor, type Minor } from '@/core/money';
import type { DashboardData, UpcomingBill } from '@/app/dashboard/useDashboard';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { Money, Tile } from '@/design/ui';

export function TriageBar({
  data,
  unreviewed,
  onOpenReview,
  onAddBill,
  onOpenCalendar,
}: {
  data: DashboardData;
  unreviewed: number;
  onOpenReview: () => void;
  onAddBill: () => void;
  onOpenCalendar: () => void;
}) {
  const locale = useAppConfig((s) => s.locale);
  const soon = data.dueSoon;

  /*
   * The one dot.
   *
   * Unreviewed payments win it when there are any, because that is a queue
   * somebody has to clear; a bill falling due is information they can act on
   * whenever they like. If neither applies there is no dot at all, which is
   * the state the screen should be in most days.
   */
  const dotOn: 'review' | 'bills' | null =
    unreviewed > 0 ? 'review' : soon.length > 0 ? 'bills' : null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title text-ink">Anything needing you</h2>

      <div className="grid grid-cols-2 gap-3">
        <Tile
          family="obligation"
          onClick={onOpenReview}
          aria-label={
            unreviewed === 0
              ? 'Nothing to review'
              : `${unreviewed} payments waiting to be reviewed`
          }
        >
          <Mark on={dotOn === 'review'} />
          <div className="text-caption opacity-75">To review</div>
          <div className="pt-2 text-figure font-medium figure">
            {unreviewed === 0 ? 'All done' : unreviewed}
          </div>
          <div className="pt-1.5 text-caption opacity-70">
            {unreviewed === 0
              ? 'You are caught up'
              : unreviewed === 1
                ? 'one waiting for a look'
                : 'waiting for a look'}
          </div>
        </Tile>

        <Tile
          family="obligation"
          onClick={soon.length === 0 ? onAddBill : onOpenCalendar}
          aria-label={
            soon.length === 0 ? 'No bills due in the next three days' : 'Bills due in the next three days'
          }
        >
          <Mark on={dotOn === 'bills'} />
          <div className="text-caption opacity-75">Due this week</div>
          <div className="pt-2">
            {soon.length === 0 ? (
              <span className="text-figure font-medium figure">
                {data.hasSchedule ? 'Nothing' : 'Add yours'}
              </span>
            ) : (
              <Money value={sum(soon)} size="figure" tone="neutral" decimals="hide" />
            )}
          </div>
          <div className="truncate pt-1.5 text-caption opacity-70">
            {soon.length === 0
              ? data.hasSchedule
                ? 'in the next three days'
                : 'so they can be held back'
              : soon.length === 1
                ? `${soon[0]!.name} · ${describeDate(soon[0]!.date, locale).toLowerCase()}`
                : `${soon.length} payments`}
          </div>
        </Tile>
      </div>
    </section>
  );
}

/** The single hot dot. Absent rather than dimmed when there is nothing. */
function Mark({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute right-4 top-4 size-2 rounded-full bg-hot"
    />
  );
}

function sum(bills: readonly UpcomingBill[]): Minor {
  return bills.length === 0 ? ZERO : minor(bills.reduce((total, bill) => total + bill.amount, 0));
}
