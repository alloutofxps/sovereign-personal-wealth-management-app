/* ===========================================================================
 * ONE DAY, IN FULL
 * ---------------------------------------------------------------------------
 * What lands on this day, where it comes from, and — the part that actually
 * answers the question people opened the calendar to ask — what is left
 * afterwards.
 *
 * "Rent is due on the 1st" is a fact. "Paying this leaves €1,450 safe to
 * spend" is the same fact in the form somebody can act on, and it is the only
 * version worth putting on a screen.
 *
 * ---------------------------------------------------------------------------
 * NO CARDS IN HERE
 *
 * Each event used to be a `Card` inside the sheet, so a day with three bills
 * on it presented as three bordered boxes stacked in a tray that already has
 * its own edges. A sheet is a surface; things on it are rows. The hairline
 * between rows does the separating, and the category square does the
 * identifying, which is the same pattern every other list in the app uses.
 * ======================================================================== */

import { useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import { describeSchedule } from '@/core/recurring';
import type { CalendarDay, DayEvent } from '@/app/calendar/useCalendar';
import { useDashboard } from '@/app/dashboard/useDashboard';
import { useAccounts } from '@/app/ledger/useLedger';
import { useCategoryPicker } from '@/app/taxonomy/useTaxonomy';
import { recordSpend } from '@/app/ledger/actions';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { listScheduled, saveScheduled } from '@/data/repositories/scheduleRepo';
import { occurrencesWithin } from '@/core/recurring';
import { familyClassFor } from '@/design/category';
import { BottomSheet, Button, Money } from '@/design/ui';

export function DayDetailSheet({
  day,
  onClose,
}: {
  day: CalendarDay | null;
  onClose: () => void;
}) {
  const locale = useAppConfig((s) => s.locale);
  const money = useMoney();
  const dashboard = useDashboard();
  const accounts = useAccounts();
  const picker = useCategoryPicker();
  const [busy, setBusy] = useState<string | null>(null);

  const safeToSpend = dashboard.data?.liquidity.safeToSpend ?? null;
  const nameOf = (id: string | null) =>
    id ? (accounts.data?.find((a) => a.id === id)?.name ?? 'an account') : null;

  return (
    <BottomSheet
      open={day !== null}
      onClose={onClose}
      size="tall"
      title={day ? describeDate(day.date, locale) : 'That day'}
      {...(day && day.events.length > 0
        ? {
            description:
              day.moneyIn > 0 && day.moneyOut > 0
                ? 'Money coming in and going out on the same day.'
                : day.moneyIn > 0
                  ? 'Money arriving.'
                  : 'Money going out.',
          }
        : {})}
    >
      {day && (
        <div className="flex flex-col pb-2">
          <ul className="flex flex-col divide-y divide-line-faint">
            {day.events.map((event) => (
              <li key={`${event.itemId}-${day.date}`}>
                <EventRow
                  event={event}
                  date={day.date}
                  accountName={nameOf(event.accountId)}
                  categoryName={
                    event.categoryId ? (picker.byId.get(event.categoryId)?.name ?? null) : null
                  }
                  safeToSpend={safeToSpend}
                  busy={busy === event.itemId}
                  onBusy={setBusy}
                  onDone={onClose}
                  money={money}
                />
              </li>
            ))}
          </ul>

          {/* Only worth stating where there is more than one thing to add up. */}
          {day.events.length > 1 && (
            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-4">
              <span className="text-caption text-ink-2">
                {day.moneyIn > 0 && day.moneyOut > 0
                  ? 'That day, in less out'
                  : day.moneyIn > 0
                    ? 'That day, arriving'
                    : 'That day, going out'}
              </span>
              <Money value={day.net} size="lead" tone={day.net >= 0 ? 'liquid' : 'neutral'} />
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function EventRow({
  event,
  date,
  accountName,
  categoryName,
  safeToSpend,
  busy,
  onBusy,
  onDone,
  money,
}: {
  event: DayEvent;
  date: string;
  accountName: string | null;
  categoryName: string | null;
  safeToSpend: number | null;
  busy: boolean;
  onBusy: (id: string | null) => void;
  onDone: () => void;
  money: ReturnType<typeof useMoney>;
}) {
  const picker = useCategoryPicker();
  const outgoing = event.kind === 'bill';

  /**
   * Record it now rather than waiting for it to arrive.
   *
   * The bill is already held back from safe-to-spend, so paying it early does
   * not change that figure — it moves the money from "promised" to "gone",
   * which is exactly what the person just did in their bank.
   */
  async function payEarly() {
    const category = event.categoryId ? picker.byId.get(event.categoryId) : null;
    if (!category || !event.accountId) {
      toast(
        'This one has no account or category set yet, so there is nothing to record it ' +
          'against. Edit the bill first and it will be one tap after that.',
        { tone: 'attention' },
      );
      return;
    }

    onBusy(event.itemId);
    try {
      await recordSpend({
        amount: event.amount,
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
        paidFrom: event.accountId as never,
        payee: event.name,
        date: date as never,
      });
      await advanceSchedule(event.itemId, date);
      toast(`Recorded ${money.format(event.amount)} for ${event.name}.`);
      onDone();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'That could not be recorded.',
        { tone: 'attention' },
      );
    }
    onBusy(null);
  }

  async function skipOnce() {
    onBusy(event.itemId);
    try {
      await advanceSchedule(event.itemId, date);
      toast(`Skipped this one. ${event.name} is still on for next time.`);
      onDone();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be skipped.', {
        tone: 'attention',
      });
    }
    onBusy(null);
  }

  const after =
    safeToSpend !== null && outgoing ? minor(safeToSpend - event.amount) : null;

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-start gap-3">
        {/* The category's own hue, so a bill looks the same here as it does in
            the donut, the envelope tile and the transaction row. */}
        <span
          aria-hidden="true"
          className={clsx(
            familyClassFor(event.categoryId ?? event.itemId),
            'mt-0.5 size-2.5 shrink-0 rounded-pill bg-[var(--tile-ink)]',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-ink">{event.name}</p>
          <p className="truncate pt-0.5 text-caption text-ink-3">
            {[
              outgoing ? 'Due from' : 'Into',
              accountName ?? 'an account you have not said yet',
              categoryName ? `· ${categoryName}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        </div>
        <Money value={event.amount} size="lead" tone={outgoing ? 'neutral' : 'liquid'} />
      </div>

      <p className="pl-[1.375rem] text-caption text-ink-2">
        {outgoing
          ? after !== null
            ? `Paying this leaves ${money.format(after)} safe to spend.`
            : 'This is already held back from what is safe to spend.'
          : 'This is counted as arriving before you spend it.'}{' '}
        <span className="text-ink-3">{describeSchedule(event.cadence, date)}</span>
      </p>

      <div className="flex flex-wrap gap-2 pl-[1.375rem]">
        {outgoing && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void payEarly()}>
            {busy ? 'Recording…' : 'Mark as paid'}
          </Button>
        )}
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => void skipOnce()}>
          Skip this one
        </Button>
      </div>
    </div>
  );
}

/**
 * Move a schedule past the occurrence just dealt with.
 *
 * Worked out by asking the engine for the next date after this one rather than
 * by adding a month, so semi-monthly and month-end bills advance the same way
 * they were generated.
 */
async function advanceSchedule(itemId: string, dealtWith: string): Promise<void> {
  const items = await listScheduled();
  const item = items.find((i) => i.id === itemId);
  if (!item) return;

  const horizon = `${Number(dealtWith.slice(0, 4)) + 2}${dealtWith.slice(4)}`;
  const next = occurrencesWithin(item, dealtWith, horizon).find((o) => o.date > dealtWith);
  if (!next) return;

  await saveScheduled({ ...item, nextDue: next.date });
}
