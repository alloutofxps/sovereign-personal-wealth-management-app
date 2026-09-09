/* Chapter 1 — the one number, and the four things taken off it. */

import { useMemo, useState } from 'react';
import { minor } from '@/core/money';
import { calculateSafeToSpend, type Commitment, type Cycle } from '@/core/liquidity';
import { useMoney } from '@/app/money/useMoney';
import { Aside, Controls, Dial, Formula, Heading, Lab, Passage, Readout, Standfirst } from '../parts';

export function SafeToSpendChapter() {
  return (
    <>
      <Standfirst slug="safe-to-spend" />

      <Passage>
        Every money app shows you a balance. A balance is the least useful number your bank has,
        because it is a fact about the past: it says what has already happened, and says nothing
        about the rent that leaves on Friday. People overspend on the first of the month for
        exactly this reason, and then blame themselves for it.
      </Passage>

      <Passage>
        Sovereign answers a different question. Not what have you got, but what could you spend
        today without breaking anything you have already committed to. That figure is the one
        thing on the home screen, and everything else in the app exists to keep it honest.
      </Passage>

      <Formula>
        {`Safe to spend  =  what you can reach today
                 −  bills due in the next month
                 −  what your cards already owe
                 −  your cushion
                 −  what is put by in pots`}
      </Formula>

      <Heading>Why each one is taken off</Heading>

      <Passage>
        <strong className="font-medium text-ink">What you can reach today</strong> is cash in
        current accounts and savings. Not your pension, not your house. A house is worth a great
        deal and buys no groceries. The test is whether the money could be spent this afternoon.
      </Passage>

      <Passage>
        <strong className="font-medium text-ink">Bills</strong> are taken off for the next thirty
        days rather than to the end of the month. Rent due on the 2nd is a real claim on the money
        in your account on the 28th, and a figure that ignored it would be at its most flattering
        on exactly the day it was most wrong.
      </Passage>

      <Passage>
        <strong className="font-medium text-ink">Cards</strong> are taken off in full. What is
        owed on a card has to be paid from the same cash you are looking at, so counting it twice
        (once as money you have, once as money you owe) is how a card balance quietly grows
        for two years.
      </Passage>

      <Passage>
        <strong className="font-medium text-ink">Your cushion</strong> is a fixed amount that
        never counts as spare. It exists so a direct debit you have forgotten cannot overdraw you,
        and you set it yourself in Settings.
      </Passage>

      <Passage>
        <strong className="font-medium text-ink">Pots</strong> are money that is still in your
        account but has been given a job. The car insurance fund sits in the current account like
        everything else; the only thing stopping you from spending it is that Sovereign stopped
        counting it.
      </Passage>

      <SafeToSpendLab />

      <Heading>The daily figure, and the day it runs to</Heading>

      <Passage>
        Underneath the headline there is an amount per day. It is not the safe figure divided by
        the days left in the month. It is divided by however long the money actually has to last,
        which is the earlier of the month ending and your next pay arriving.
      </Passage>

      <Passage>
        That distinction matters more than it sounds. Drag the payday slider below and watch the
        daily figure jump: the same money spread over eighteen days is a third more per day than
        the same money spread over twenty-four. Say the wrong one out loud and you have handed
        somebody several hundred pounds that does not exist.
      </Passage>

      <Aside>
        Nothing here is stored. The figure is worked out again from your ledger every time the
        screen is drawn, which is why it cannot drift: there is no saved total anywhere that could
        disagree with the entries it came from.
      </Aside>
    </>
  );
}

/* ------------------------------------------------------------------------- */

const DAYS_IN_CYCLE = 30;

function SafeToSpendLab() {
  const money = useMoney();
  const [cash, setCash] = useState(240_000);
  const [bills, setBills] = useState(95_000);
  const [card, setCard] = useState(41_000);
  const [cushion, setCushion] = useState(20_000);
  const [pots, setPots] = useState(14_500);
  const [daysLeft, setDaysLeft] = useState(24);
  const [payday, setPayday] = useState(18);

  const result = useMemo(() => {
    const cycle: Cycle = {
      start: '2026-09-01',
      end: '2026-09-30',
      totalDays: DAYS_IN_CYCLE,
      elapsedDays: DAYS_IN_CYCLE - daysLeft,
      remainingDays: daysLeft,
    };
    const billLines: Commitment[] = [{ label: 'Bills due', amount: minor(bills), kind: 'bill' }];
    const cardLines: Commitment[] = [{ label: 'Card', amount: minor(card), kind: 'card' }];

    return calculateSafeToSpend({
      liquidCash: minor(cash),
      bills: billLines,
      cardBalances: cardLines,
      buffer: minor(cushion),
      goalFunding: minor(pots),
      cycle,
      // Zero means "not known" to the caller, so a payday of nought days away
      // is expressed by simply not passing it — the engine then paces over the
      // rest of the cycle, which is what "no more money is coming" means.
      ...(payday > 0 ? { daysUntilIncome: payday } : {}),
    });
  }, [cash, bills, card, cushion, pots, daysLeft, payday]);

  return (
    <Lab title="What is safe to spend" engine="core/liquidity/safeToSpend">
      <Controls>
        <Dial
          label="Cash you can reach today"
          value={cash}
          onChange={setCash}
          min={0}
          max={600_000}
          step={5_000}
          display={money.format(minor(cash))}
        />
        <Dial
          label="Bills due in the next month"
          value={bills}
          onChange={setBills}
          min={0}
          max={300_000}
          step={2_500}
          display={money.format(minor(bills))}
        />
        <Dial
          label="Owed on cards"
          value={card}
          onChange={setCard}
          min={0}
          max={300_000}
          step={2_500}
          display={money.format(minor(card))}
        />
        <Dial
          label="Your cushion"
          value={cushion}
          onChange={setCushion}
          min={0}
          max={100_000}
          step={2_500}
          display={money.format(minor(cushion))}
        />
        <Dial
          label="Put by in pots"
          value={pots}
          onChange={setPots}
          min={0}
          max={200_000}
          step={2_500}
          display={money.format(minor(pots))}
        />
        <Dial
          label="Days left in the period"
          value={daysLeft}
          onChange={setDaysLeft}
          min={1}
          max={30}
          step={1}
          display={`${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
        />
        <Dial
          label="Days until you are paid"
          value={payday}
          onChange={setPayday}
          min={0}
          max={30}
          step={1}
          display={payday === 0 ? 'Nothing coming' : `${payday} ${payday === 1 ? 'day' : 'days'}`}
        />
      </Controls>

      <Readout
        lines={[
          { label: 'What you can reach today', value: money.format(result.liquidCash) },
          {
            label: 'Already promised',
            value: `− ${money.format(result.committed)}`,
            note: 'Bills and cards together',
            tone: 'taken',
          },
          { label: 'Your cushion', value: `− ${money.format(result.buffer)}`, tone: 'taken' },
          { label: 'Put by in pots', value: `− ${money.format(result.goalFunding)}`, tone: 'taken' },
        ]}
        answer={{
          label: 'Safe to spend',
          value: money.format(result.safeToSpend),
          tone: result.safeToSpend < 0 ? 'deficit' : 'liquid',
        }}
      />

      <div className="rounded-md border border-line bg-raised px-3.5 py-3">
        <p className="text-body text-ink">
          {result.dailyPace > 0 ? (
            <>
              {money.format(result.dailyPace)} a day for {result.paceDays}{' '}
              {result.paceDays === 1 ? 'day' : 'days'}
              {result.paceDays < result.daysRemaining
                ? '. Paced to payday, not to the end of the period.'
                : '. Paced to the end of the period.'}
            </>
          ) : (
            <>
              Nothing spare. The honest answer is that there is none, not a negative daily
              allowance nobody could act on.
            </>
          )}
        </p>
      </div>
    </Lab>
  );
}
