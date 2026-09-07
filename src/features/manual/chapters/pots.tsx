/* Chapter 3 — pots, and the arithmetic that decides what this month owes. */

import { useMemo, useState } from 'react';
import { minor } from '@/core/money';
import {
  describePot,
  planFor,
  potStatusLabel,
  reservedForPots,
  type PotTarget,
  type PotTargetKind,
} from '@/core/goals';
import { useMoney } from '@/app/money/useMoney';
import {
  Aside,
  Controls,
  Dial,
  EngineSays,
  Formula,
  Heading,
  Lab,
  Passage,
  Points,
  Readout,
  Switch,
} from '../parts';

export function PotsChapter() {
  return (
    <>
      <Passage>
        Irregular costs are what wreck an otherwise sensible month. The car insurance, the boiler
        service, the flights in August. None of them is a surprise. Every one of them arrives as
        one, because nothing was put by.
      </Passage>

      <Passage>
        A pot fixes that without moving any money. The car insurance fund sits in the same current
        account as everything else; what changes is that Sovereign stops counting it as spare. By
        March the money is there, and it was never available to spend on anything else.
      </Passage>

      <Heading>Three kinds, three different sums</Heading>

      <Passage>
        The kinds are not three labels on one idea. They are three genuinely different pieces of
        arithmetic, and choosing the wrong one gives you a monthly figure that is wrong every
        month.
      </Passage>

      <Formula>
        {`By a date     this month  =  (target − balance at month start) ÷ months left
Every month   this month  =  the amount, again, for ever
No deadline   this month  =  nothing. Put in what you can.`}
      </Formula>

      <Passage>
        The by-date sum uses the balance as it stood when the month began, not the live one. If it
        used the live balance, paying in would immediately lower the very figure you were paying
        towards. You would put in the eighty-five you were asked for and be told the month now
        wanted seventy-eight, which reads exactly like the goalposts moving the moment you reach
        them.
      </Passage>

      <Aside>
        A monthly pot is never reported as finished. Fifty a month has not completed when it
        reaches fifty. It has completed <em>this month</em>, and next month wants another fifty.
        Calling it done would quietly stop holding the money back from the second month onwards.
      </Aside>

      <PotsLab />

      <Heading>What a pot costs you today</Heading>

      <Passage>
        Two separate things come off what is safe to spend, and both belong there.
      </Passage>

      <Points
        items={[
          <>
            <strong className="font-medium text-ink">What is already in the pot.</strong> It is
            sitting in your bank account, so it is inside the cash figure. Spending it would empty
            the pot without you noticing.
          </>,
          <>
            <strong className="font-medium text-ink">What still has to go in this month.</strong>{' '}
            You have promised it, even though it has not moved yet. Counting it as spare would be
            counting the same money twice.
          </>,
        ]}
      />

      <Passage>
        Fall behind and next month is worked out again from wherever the pot actually got to, so
        it asks for more. Get ahead and it asks for less. Nothing is ever recorded as a failure,
        because a month where the boiler broke is not a moral event.
      </Passage>
    </>
  );
}

/* ------------------------------------------------------------------------- */

const KINDS: { value: PotTargetKind; label: string }[] = [
  { value: 'by_date', label: 'By a date' },
  { value: 'monthly', label: 'Every month' },
  { value: 'open', label: 'No deadline' },
];

const TODAY = '2026-09-01';

/** 'YYYY-MM-DD' plus a whole number of months, with no timezone in sight. */
function addMonths(iso: string, months: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  const zeroBased = month - 1 + months;
  const y = year + Math.floor(zeroBased / 12);
  const m = (zeroBased % 12) + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(day)}`;
}

function PotsLab() {
  const money = useMoney();
  const [kind, setKind] = useState<PotTargetKind>('by_date');
  const [target, setTarget] = useState(102_000);
  const [balance, setBalance] = useState(17_000);
  const [assigned, setAssigned] = useState(0);
  const [months, setMonths] = useState(12);

  const plan = useMemo(() => {
    // A target date `months` whole months out from a fixed today, built by
    // arithmetic on the parts rather than through a Date.
    //
    // `toISOString` was the first attempt and it was wrong by a day: a local
    // midnight in any zone ahead of UTC converts back to the previous evening,
    // so 1 September plus twelve months came out as 31 August and the engine
    // — correctly — counted eleven months. The slider then said twelve while
    // the readout said eleven, in the one chapter whose whole job is to show
    // that the label and the arithmetic agree.
    const targetDate = addMonths(TODAY, months);

    const potTarget: PotTarget = {
      envelopeId: 'manual-pot',
      name: 'Car insurance',
      targetAmount: minor(target),
      currentBalance: minor(balance + assigned),
      kind,
      targetDate: kind === 'by_date' ? targetDate : null,
      recurring: false,
      assignedThisCycle: minor(assigned),
      balanceAtCycleStart: minor(balance),
    };
    return planFor(potTarget, TODAY);
  }, [kind, target, balance, assigned, months]);

  return (
    <Lab title="What this month owes the pot" engine="core/goals/sinkingFund">
      <Controls>
        <Switch label="What kind of pot" value={kind} options={KINDS} onChange={setKind} />
        <Dial
          label={kind === 'monthly' ? 'Amount every month' : 'What you need in the end'}
          value={target}
          onChange={setTarget}
          min={1_000}
          max={300_000}
          step={1_000}
          display={money.format(minor(target))}
        />
        <Dial
          label="What was in it when the month began"
          value={balance}
          onChange={setBalance}
          min={0}
          max={300_000}
          step={1_000}
          display={money.format(minor(balance))}
        />
        <Dial
          label="Put in so far this month"
          value={assigned}
          onChange={setAssigned}
          min={0}
          max={30_000}
          step={500}
          display={money.format(minor(assigned))}
        />
        {kind === 'by_date' && (
          <Dial
            label="Months until you need it"
            value={months}
            onChange={setMonths}
            min={1}
            max={36}
            step={1}
            display={`${months} ${months === 1 ? 'month' : 'months'}`}
          />
        )}
      </Controls>

      <Readout
        lines={[
          {
            label: 'This month’s share',
            value: money.format(plan.monthlyAllocation),
            note:
              kind === 'by_date'
                ? `Worked out over ${plan.monthsRemaining} ${plan.monthsRemaining === 1 ? 'month' : 'months'}`
                : kind === 'monthly'
                  ? 'The same every month'
                  : 'Nothing is required',
          },
          {
            label: 'Already gone in',
            value: `− ${money.format(plan.assignedThisCycle)}`,
            tone: 'taken',
          },
          {
            label: 'Where it stands',
            value: potStatusLabel(plan.status),
          },
        ]}
        answer={{
          label: 'Still to find this month',
          value: money.format(plan.stillNeededThisCycle),
          tone: plan.stillNeededThisCycle === 0 ? 'liquid' : 'ink',
        }}
      />

      <EngineSays>{describePot(plan, (amount) => money.format(amount))}</EngineSays>

      <p className="text-caption text-ink-3">
        Held back from what is safe to spend today: {money.format(reservedForPots([plan]))}: the{' '}
        {money.format(minor(Math.max(0, plan.currentBalance)))} already in the pot plus the{' '}
        {money.format(plan.stillNeededThisCycle)} still promised.
      </p>
    </Lab>
  );
}
