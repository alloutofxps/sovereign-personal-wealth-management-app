/* Chapter 6 — checking the books against the bank, and what locking means. */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import {
  describeDifference,
  describeLock,
  reconciliationState,
  type ReconcilableLine,
} from '@/core/reconciliation/reconciliationMath';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { Aside, Dial, EngineSays, Heading, Lab, Passage, Points, Readout, Standfirst } from '../parts';

export function ReconcilingChapter() {
  return (
    <>
      <Standfirst slug="checking" />

      <Passage>
        Every figure in Sovereign is worked out from something you typed or imported. That is a
        good design and it has exactly one hole in it: nothing has ever confirmed that the total
        agrees with what your bank thinks.
      </Passage>

      <Passage>
        A ledger nobody has checked is a ledger nobody should completely trust, and the person
        using it usually knows that even if they could not say why. It shows up as a small
        reluctance to rely on the number.
      </Passage>

      <Heading>What a check actually is</Heading>

      <Passage>
        You take the statement, tick off everything the bank has settled, and type in the closing
        figure. Either the two come to exactly the same amount or they do not. There is no
        approximately.
      </Passage>

      <Passage>
        Anything you have recorded that the bank has not settled yet is left out of the
        comparison, not counted against you. A card payment made on Saturday that clears on
        Tuesday is a real payment and it is genuinely not on Saturday's statement.
      </Passage>

      <ReconcilingLab />

      <Heading>Which way the gap runs</Heading>

      <Passage>
        When it does not balance, the difference has a direction, and the direction narrows down
        where to look. Sovereign says which way it runs and names both of the usual causes, and
        deliberately does not pick one, because an account can be overdrawn, and a sentence that
        asserts the wrong cause sends somebody hunting through the one place the problem is not.
      </Passage>

      <Points
        items={[
          <>
            <strong className="font-medium text-ink">The bank has more than you have ticked.</strong>{' '}
            Usually something that arrived and was never recorded. Occasionally something ticked
            off too early.
          </>,
          <>
            <strong className="font-medium text-ink">The bank has less than you have ticked.</strong>{' '}
            Usually something recorded twice. Occasionally a payment that has not really gone
            through.
          </>,
        ]}
      />

      <Heading>Locking, and why</Heading>

      <Passage>
        Finishing a check locks every payment up to the statement date. Locked records cannot be
        edited or deleted by accident, and an entry that would change one is refused with a
        sentence saying when you checked it.
      </Passage>

      <Aside>
        This is not the app distrusting you. A record you have personally matched against a bank
        statement is worth more than one you can still change without noticing, and you can
        always unlock a stretch deliberately, which is a different act from changing it by
        mistake.
      </Aside>

      <Passage>
        The check itself is kept even when it balanced exactly, because "this account was checked
        against the bank on these dates and agreed every time" is the sentence the whole feature
        exists to let you say.
      </Passage>
    </>
  );
}

/* ------------------------------------------------------------------------- */

const STATEMENT_DATE = '2026-08-31';

/**
 * Eight lines off a statement, one of them dated after it.
 *
 * The out-of-scope line is the point of the exercise as much as the ticking
 * is: it stays in the register, it is not ticked, and it is not counted
 * against the difference either.
 */
const LINES: readonly (ReconcilableLine & { startsCleared: boolean })[] = [
  { postingId: 'p1', entryId: 'e1', date: '2026-08-04', amount: minor(-125_000), description: 'Rent', clearance: 'cleared', startsCleared: true },
  { postingId: 'p2', entryId: 'e2', date: '2026-08-07', amount: minor(-6_420), description: 'Albert Heijn', clearance: 'cleared', startsCleared: true },
  { postingId: 'p3', entryId: 'e3', date: '2026-08-12', amount: minor(-2_450), description: 'Etos pharmacy', clearance: 'pending', startsCleared: false },
  { postingId: 'p4', entryId: 'e4', date: '2026-08-19', amount: minor(-1_199), description: 'Spotify', clearance: 'pending', startsCleared: false },
  { postingId: 'p5', entryId: 'e5', date: '2026-08-25', amount: minor(315_000), description: 'Pay from work', clearance: 'pending', startsCleared: false },
  { postingId: 'p6', entryId: 'e6', date: '2026-08-28', amount: minor(-9_680), description: 'Lidl', clearance: 'pending', startsCleared: false },
  { postingId: 'p7', entryId: 'e7', date: '2026-08-30', amount: minor(-3_180), description: 'Thai Corner', clearance: 'pending', startsCleared: false },
  { postingId: 'p8', entryId: 'e8', date: '2026-09-02', amount: minor(-4_500), description: 'Bakery, after the statement date', clearance: 'pending', startsCleared: false },
];

/** What the bank would say if every in-scope line were ticked. */
const TRUE_BALANCE = LINES.filter((line) => line.date <= STATEMENT_DATE).reduce(
  (sum, line) => sum + line.amount,
  0,
);

function ReconcilingLab() {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(LINES.filter((l) => l.startsCleared).map((l) => l.postingId)),
  );
  const [statement, setStatement] = useState(TRUE_BALANCE);

  const lines: ReconcilableLine[] = useMemo(
    () =>
      LINES.map(({ startsCleared: _ignored, ...line }) => ({
        ...line,
        clearance: ticked.has(line.postingId) ? ('cleared' as const) : ('pending' as const),
      })),
    [ticked],
  );

  const state = useMemo(
    () =>
      reconciliationState({
        lines,
        statementBalance: minor(statement),
        statementDate: STATEMENT_DATE,
      }),
    [lines, statement],
  );

  function toggle(postingId: string) {
    setTicked((previous) => {
      const next = new Set(previous);
      if (next.has(postingId)) next.delete(postingId);
      else next.add(postingId);
      return next;
    });
  }

  return (
    <Lab
      title={`Checking against the statement of ${describeDate(STATEMENT_DATE, locale)}`}
      engine="core/reconciliation/reconciliationMath"
    >
      <ul className="flex flex-col gap-1.5">
        {LINES.map((line) => {
          const inScope = line.date <= STATEMENT_DATE;
          const on = ticked.has(line.postingId);
          return (
            <li key={line.postingId}>
              <button
                type="button"
                onClick={() => inScope && toggle(line.postingId)}
                disabled={!inScope}
                aria-pressed={inScope ? on : undefined}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                  !inScope
                    ? 'cursor-default border-line-faint bg-sunken opacity-60'
                    : on
                      ? 'border-liquid-dim bg-liquid-wash'
                      : 'border-line bg-raised [@media(hover:hover)]:hover:border-line-strong',
                )}
              >
                <span
                  className={clsx(
                    'flex size-5 shrink-0 items-center justify-center rounded-sm border text-micro',
                    on ? 'border-liquid bg-liquid text-base' : 'border-line-strong text-transparent',
                  )}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {line.description}
                </span>
                <span className="shrink-0 text-caption text-ink-3">
                  {describeDate(line.date, locale)}
                </span>
                <span className="tnum w-24 shrink-0 text-right text-caption text-ink-2">
                  {money.format(line.amount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Dial
        label="What the bank says the closing balance was"
        value={statement}
        onChange={setStatement}
        min={TRUE_BALANCE - 20_000}
        max={TRUE_BALANCE + 20_000}
        step={500}
        display={money.format(minor(statement))}
      />

      <Readout
        lines={[
          {
            label: 'What the bank says',
            value: money.format(state.statementBalance),
          },
          {
            label: 'What you have ticked',
            value: money.format(state.clearedBalance),
            note: `${state.clearedCount} ticked, ${state.pendingCount} not`,
          },
          {
            label: 'Recorded but not gone through',
            value: money.format(state.unclearedBalance),
            note: 'Left out of the comparison, not counted against you',
            tone: 'taken',
          },
        ]}
        answer={{
          label: 'Difference',
          value: money.format(state.discrepancy),
          tone: state.status === 'balanced' ? 'liquid' : 'deficit',
        }}
      />

      <EngineSays>{describeDifference(state, (amount) => money.format(amount))}</EngineSays>

      <p className="text-caption text-ink-3">
        {state.status === 'balanced'
          ? describeLock(state.lockedCount)
          : 'Nothing can be locked until the difference is nothing, or you record an adjustment for it.'}
      </p>
    </Lab>
  );
}
