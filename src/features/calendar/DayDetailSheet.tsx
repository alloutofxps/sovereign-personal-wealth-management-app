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
 * ======================================================================== */

import { useState } from 'react';
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
import { BottomSheet, Button, Card, Money } from '@/design/ui';

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
        <div className="flex flex-col gap-4 pb-2">
          {day.events.map((event) => (
            <EventRow
              key={`${event.itemId}-${day.date}`}
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
          ))}

          {day.events.length > 1 && (
            <Card label="That day altogether">
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-ink-2">
                  {day.moneyIn > 0 && day.moneyOut > 0
                    ? 'In, less out'
                    : day.moneyIn > 0
                      ? 'Arriving'
                      : 'Going out'}
                </span>
                <Money value={day.net} size="lead" tone={day.net >= 0 ? 'liquid' : 'neutral'} />
              </div>
            </Card>
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
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
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
          <Money
            value={event.amount}
            size="lead"
            tone={outgoing ? 'neutral' : 'liquid'}
          />
        </div>

        <p className="text-caption text-ink-2">
          {outgoing
            ? after !== null
              ? `Paying this leaves ${money.format(after)} safe to spend.`
              : 'This is already held back from what is safe to spend.'
            : 'This is counted as arriving before you spend it.'}
        </p>

        <p className="text-caption text-ink-3">{describeSchedule(event.cadence, date)}</p>

        <div className="flex flex-wrap gap-2">
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
    </Card>
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
