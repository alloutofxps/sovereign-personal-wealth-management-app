/* ===========================================================================
 * WHAT IS COMING, ON A CALENDAR
 * ---------------------------------------------------------------------------
 * The forecast graph answers "how much"; this answers "when". They are
 * different questions and people ask the second one far more often — rent
 * lands on the 1st, the card bill on the 18th, and whether that order works
 * is not something a curve can show you.
 *
 * Colour carries one meaning only: emerald is money arriving, amber is money
 * leaving. Nothing here is red. A bill that is due is not a failure, and an
 * app that treats an ordinary Tuesday as an emergency gets ignored on the day
 * something is actually wrong.
 * ======================================================================== */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { toIsoDate } from '@/core/liquidity';
import {
  monthLabel,
  shiftMonth,
  useCalendarMonth,
  weekdayInitials,
  type CalendarDay,
} from '@/app/calendar/useCalendar';
import { useAppConfig } from '@/app/config/store';
import { Button, Card, Money, Tabs } from '@/design/ui';
import { AddBillSheet } from '@/features/dashboard/AddBillSheet';
import { DayDetailSheet } from './DayDetailSheet';

type Span = 'month' | 'week';

export function CalendarView() {
  const locale = useAppConfig((s) => s.locale);
  const today = toIsoDate(new Date());

  const [anchor, setAnchor] = useState(() => `${today.slice(0, 7)}-01`);
  const [span, setSpan] = useState<Span>('month');
  const [looking, setLooking] = useState<CalendarDay | null>(null);
  const [adding, setAdding] = useState(false);

  const { month, loading } = useCalendarMonth(anchor, locale);
  const initials = useMemo(() => weekdayInitials(locale), [locale]);

  // The week view is the same grid, narrowed to the row holding today — or the
  // first row of the month being looked at, when that is not this month.
  const weeks = useMemo(() => {
    if (span === 'month') return month.weeks;
    const withToday = month.weeks.find((week) => week.some((d) => d.isToday));
    return [withToday ?? month.weeks[1] ?? month.weeks[0] ?? []];
  }, [span, month.weeks]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">What is due, and when</h1>
        <p className="text-caption text-ink-2">
          Everything you have told Sovereign about, laid out on the days it lands.
        </p>
      </header>

      <Tabs
        label="How much of the calendar to show"
        value={span}
        onChange={setSpan}
        tabs={[
          { value: 'month', label: 'Month' },
          { value: 'week', label: 'This week' },
        ]}
      />

      <Card padding="tight">
        <div className="flex items-center justify-between gap-3 pb-3">
          <button
            type="button"
            aria-label="The month before"
            onClick={() => setAnchor((a) => shiftMonth(a, -1))}
            className="flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            <Chevron direction="left" />
          </button>

          <div className="flex flex-col items-center">
            <span className="text-body font-medium text-ink">{monthLabel(anchor, locale)}</span>
            {!loading && (
              <span className="text-caption text-ink-3">
                {month.totalIn === 0 && month.totalOut === 0
                  ? 'Nothing scheduled this month'
                  : 'In and out this month'}
              </span>
            )}
          </div>

          <button
            type="button"
            aria-label="The month after"
            onClick={() => setAnchor((a) => shiftMonth(a, 1))}
            className="flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-raised hover:text-ink"
          >
            <Chevron direction="right" />
          </button>
        </div>

        {(month.totalIn > 0 || month.totalOut > 0) && (
          <div className="flex items-center justify-center gap-4 pb-3">
            <span className="flex items-center gap-1.5 text-caption text-ink-2">
              <Dot tone="in" /> <Money value={month.totalIn} size="caption" tone="liquid" /> in
            </span>
            <span className="flex items-center gap-1.5 text-caption text-ink-2">
              <Dot tone="out" /> <Money value={month.totalOut} size="caption" /> out
            </span>
          </div>
        )}

        <div className="grid grid-cols-7 gap-1 pb-1" aria-hidden="true">
          {initials.map((initial, i) => (
            <span key={i} className="text-center text-micro uppercase text-ink-3">
              {initial}
            </span>
          ))}
        </div>

        <div role="grid" aria-label="Scheduled payments" className="flex flex-col gap-1">
          {weeks.map((week, index) => (
            <div role="row" key={index} className="grid grid-cols-7 gap-1">
              {week.map((day) => (
                <DayCell key={day.date} day={day} onOpen={() => setLooking(day)} />
              ))}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          Add a bill or income
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => setAnchor(`${today.slice(0, 7)}-01`)}
        >
          Back to this month
        </Button>
      </div>

      <DayDetailSheet day={looking} onClose={() => setLooking(null)} />
      <AddBillSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function DayCell({ day, onOpen }: { day: CalendarDay; onOpen: () => void }) {
  const hasEvents = day.events.length > 0;

  return (
    <button
      type="button"
      role="gridcell"
      onClick={hasEvents ? onOpen : undefined}
      aria-label={`${day.date}${hasEvents ? `, ${day.events.length} scheduled` : ', nothing scheduled'}`}
      aria-current={day.isToday ? 'date' : undefined}
      disabled={!hasEvents}
      className={clsx(
        'flex min-h-[3.25rem] flex-col items-center gap-1 rounded-md border px-1 py-1.5',
        'transition-colors',
        day.isToday
          ? 'border-liquid-dim bg-liquid-wash'
          : hasEvents
            ? 'border-line bg-raised hover:border-line-strong'
            : 'border-transparent',
        !day.inMonth && 'opacity-35',
        day.isPast && !day.isToday && 'opacity-60',
      )}
    >
      <span
        className={clsx(
          'tnum text-caption',
          day.isToday ? 'font-medium text-liquid' : 'text-ink-2',
        )}
      >
        {day.day}
      </span>

      {hasEvents && (
        <span className="flex items-center gap-0.5">
          {day.moneyIn > 0 && <Dot tone="in" />}
          {day.moneyOut > 0 && <Dot tone="out" />}
        </span>
      )}

      {/* Only when a day does two things at once is the net figure worth the
          space — otherwise the dot has already said it. */}
      {day.moneyIn > 0 && day.moneyOut > 0 && (
        <Money
          value={day.net}
          size="caption"
          decimals="hide"
          tone={day.net >= 0 ? 'liquid' : 'muted'}
          className="text-[0.62rem]"
        />
      )}
    </button>
  );
}

function Dot({ tone }: { tone: 'in' | 'out' }) {
  return (
    <span
      className={clsx('size-1.5 rounded-full', tone === 'in' ? 'bg-liquid' : 'bg-caution')}
      aria-hidden="true"
    />
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
