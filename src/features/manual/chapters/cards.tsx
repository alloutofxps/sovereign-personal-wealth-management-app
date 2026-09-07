/* Chapter 4 — cards, mortgages, and why the two are treated nothing alike. */

import { useMemo, useState } from 'react';
import { minor } from '@/core/money';
import { calculateSafeToSpend, type Commitment, type Cycle } from '@/core/liquidity';
import { useMoney } from '@/app/money/useMoney';
import {
  Aside,
  Controls,
  Dial,
  Heading,
  Lab,
  Passage,
  Points,
  Readout,
  Switch,
} from '../parts';

export function CardsChapter() {
  return (
    <>
      <Passage>
        A credit card is the single easiest way for a budget to be quietly wrong. The money is
        still in your account, so the app says you have it. The card statement arrives three weeks
        later for money you no longer think of as spent. Do that for a year and the balance has
        grown by a few hundred pounds nobody ever decided to borrow.
      </Passage>

      <Heading>The pot that fills itself</Heading>

      <Passage>
        Every card in Sovereign is created with a pot attached to it, and you cannot have one
        without the other. The moment you spend on the card, the money comes out of whichever
        envelope you spent it from and goes into that pot instead.
      </Passage>

      <Passage>
        So a forty-two euro shop on the card takes forty-two euros out of your food budget, the
        same as if you had paid cash, and puts forty-two euros aside for the bill. Nothing has
        physically moved. What has changed is that the cash to settle the statement is now spoken
        for, weeks before the statement exists.
      </Passage>

      <Aside>
        When the bill finally arrives, paying it records no spending at all. The groceries were
        counted when you bought them. Counting them again when you settle the card would double
        every purchase you have ever made on it.
      </Aside>

      <Heading>Why the balance comes off, and a mortgage does not</Heading>

      <Passage>
        What a card owes is taken off what is safe to spend, in full, today. That is right,
        because it has to be paid out of exactly the cash you are looking at, and usually within
        the month.
      </Passage>

      <Passage>
        A mortgage is not treated that way, and it would be absurd to. Nobody has to find two
        hundred thousand this month; they have to find one payment, and that payment is a bill
        like any other. An app that subtracted the whole balance would tell somebody with a house
        and a healthy current account that they have nothing at all to spend. That is both false
        and the most discouraging thing a money app can say.
      </Passage>

      <CardsLab />

      <Heading>What this buys you</Heading>

      <Points
        items={[
          <>
            The statement is never a surprise. By the time it lands, the money for it has been
            sitting untouched in the pot since the day of each purchase.
          </>,
          <>
            Card spending and cash spending read identically in your budget, so the choice of
            which one to pay with stops being a budgeting decision.
          </>,
          <>
            If the pot is short of what the card owes, the home screen says so plainly rather than
            waiting for you to work it out. That is the one case worth flagging: it means
            something was spent on the card outside the app.
          </>,
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- */

type Debt = 'card' | 'mortgage';

const CYCLE: Cycle = {
  start: '2026-09-01',
  end: '2026-09-30',
  totalDays: 30,
  elapsedDays: 6,
  remainingDays: 24,
};

function CardsLab() {
  const money = useMoney();
  const [debt, setDebt] = useState<Debt>('card');
  const [owed, setOwed] = useState(85_000);
  const [payment, setPayment] = useState(120_000);

  const result = useMemo(() => {
    // A mortgage contributes its monthly payment as a bill; a card contributes
    // its whole balance. That single difference is the entire chapter, so the
    // lab changes nothing else between the two.
    const cardBalances: Commitment[] =
      debt === 'card' ? [{ label: 'Card', amount: minor(owed), kind: 'card' }] : [];
    const bills: Commitment[] =
      debt === 'mortgage'
        ? [{ label: 'Mortgage payment', amount: minor(payment), kind: 'bill' }]
        : [];

    return calculateSafeToSpend({
      liquidCash: minor(280_000),
      bills,
      cardBalances,
      buffer: minor(20_000),
      goalFunding: minor(0),
      cycle: CYCLE,
    });
  }, [debt, owed, payment]);

  return (
    <Lab title="The same debt, counted two ways" engine="core/liquidity/safeToSpend">
      <Controls>
        <Switch
          label="What you owe it on"
          value={debt}
          options={[
            { value: 'card', label: 'A credit card' },
            { value: 'mortgage', label: 'A mortgage' },
          ]}
          onChange={setDebt}
        />
        {debt === 'card' ? (
          <Dial
            label="Balance on the card"
            value={owed}
            onChange={setOwed}
            min={0}
            max={250_000}
            step={2_500}
            display={money.format(minor(owed))}
          />
        ) : (
          <Dial
            label="This month’s mortgage payment"
            value={payment}
            onChange={setPayment}
            min={0}
            max={250_000}
            step={2_500}
            display={money.format(minor(payment))}
          />
        )}
      </Controls>

      <Readout
        lines={[
          { label: 'Cash you can reach', value: money.format(result.liquidCash) },
          {
            label: debt === 'card' ? 'The card balance, in full' : 'One mortgage payment',
            value: `− ${money.format(result.committed)}`,
            note:
              debt === 'card'
                ? 'It comes out of this same cash, and soon'
                : 'The balance is not a claim on this month',
            tone: 'taken',
          },
          { label: 'Your cushion', value: `− ${money.format(result.buffer)}`, tone: 'taken' },
        ]}
        answer={{
          label: 'Safe to spend',
          value: money.format(result.safeToSpend),
          tone: result.safeToSpend < 0 ? 'deficit' : 'liquid',
        }}
      />

      <p className="text-caption text-ink-3">
        Slide the mortgage payment up to a card-sized figure and the two agree. The difference is
        never the size of the debt. It is whether the whole of it has to be found this month.
      </p>
    </Lab>
  );
}
