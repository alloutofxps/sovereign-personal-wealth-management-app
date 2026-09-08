/* Chapter 5 — what a sale actually costs, and which shares go first. */

import { useMemo, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import {
  DisposalError,
  QUANTITY_SCALE,
  describeDisposal,
  formatQuantity,
  relieveLotsFIFO,
  type TaxLot,
} from '@/core/investments';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
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
} from '../parts';

export function DisposalsChapter() {
  return (
    <>
      <Passage>
        You bought the same fund four times over three years, at four different prices. Today you
        sell ten shares. Which ten did you sell?
      </Passage>

      <Passage>
        The answer is not academic. It decides what the sale
        made or lost, and in most countries it decides what you owe on it. Sell the oldest shares
        and you realise three years of growth; sell the newest and you might realise almost
        nothing. The shares are identical. The tax is not.
      </Passage>

      <Heading>Oldest first</Heading>

      <Passage>
        Sovereign relieves the oldest parcel first, then the next, until the sale is covered. This
        is the default nearly everywhere and the only one that can be applied without asking you a
        question you cannot answer from memory.
      </Passage>

      <Formula>
        {`What the sale made  =  proceeds − fees − what those particular shares cost

where "those particular shares" are taken
from the oldest open parcel first.`}
      </Formula>

      <Passage>
        Each parcel keeps what it originally cost, and never changes. When part of one is sold, a
        proportional slice of that cost goes with it and the parcel keeps the rest. So a parcel
        that cost six hundred and is half sold has three hundred of cost left behind, waiting for
        whenever the other half goes.
      </Passage>

      <Aside>
        Nothing here is tax advice, and Sovereign does not file anything. It records which parcels
        went and what they cost, which is the part people cannot reconstruct a year later from a
        brokerage statement.
      </Aside>

      <DisposalsLab />

      <Heading>What happens to the money</Heading>

      <Points
        items={[
          <>
            The cash arrives in whichever account you sold into, and the shares leave the holding.
            Both books move, as always.
          </>,
          <>
            The gain is recorded as a gain, not as income. It is not money you earned this month
            and it should not swell your spending figures or your monthly income averages.
          </>,
          <>
            Only the part that was never yours to spend becomes newly spendable. Selling does not
            make you richer; it makes what you already had liquid.
          </>,
        ]}
      />
    </>
  );
}

/* ===========================================================================
 * THE LAB
 * ---------------------------------------------------------------------------
 * Three parcels bought at rising prices, so the oldest-first rule has visible
 * consequences: selling ten shares relieves a different cost, and reports a
 * different gain, than selling four would.
 * ======================================================================== */

const q = (shares: number) => shares * QUANTITY_SCALE;

const LOTS: readonly TaxLot[] = [
  {
    id: 'lot-1',
    accountId: 'acc-brokerage',
    securityId: 'sec-fund',
    holdingId: 'hold-fund',
    acquiredDate: '2023-04-11',
    quantity1e8: q(6),
    remainingQuantity1e8: q(6),
    costBasisMinor: minor(48_000),
    isClosed: false,
  },
  {
    id: 'lot-2',
    accountId: 'acc-brokerage',
    securityId: 'sec-fund',
    holdingId: 'hold-fund',
    acquiredDate: '2024-09-02',
    quantity1e8: q(5),
    remainingQuantity1e8: q(5),
    costBasisMinor: minor(52_500),
    isClosed: false,
  },
  {
    id: 'lot-3',
    accountId: 'acc-brokerage',
    securityId: 'sec-fund',
    holdingId: 'hold-fund',
    acquiredDate: '2026-02-17',
    quantity1e8: q(4),
    remainingQuantity1e8: q(4),
    costBasisMinor: minor(50_800),
    isClosed: false,
  },
];

const HELD = LOTS.reduce((sum, lot) => sum + lot.remainingQuantity1e8, 0);

function DisposalsLab() {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const [shares, setShares] = useState(10);
  const [price, setPrice] = useState(13_400);
  const [fees, setFees] = useState(150);

  const outcome = useMemo(() => {
    try {
      return {
        result: relieveLotsFIFO({
          lots: LOTS,
          sellQuantity1e8: q(shares),
          salePriceMinor: minor(price),
          feesMinor: minor(fees),
        }),
        refused: null as string | null,
      };
    } catch (error) {
      // The engine refuses rather than clamping, and a lab that hid the
      // refusal would be teaching that it does not happen.
      return {
        result: null,
        refused:
          error instanceof DisposalError
            ? error.message
            : 'That is not a sale this can work out.',
      };
    }
  }, [shares, price, fees]);

  return (
    <Lab title="Selling ten of fifteen shares" engine="core/investments/disposals">
      <Controls>
        <Dial
          label="Shares to sell"
          value={shares}
          onChange={setShares}
          min={1}
          max={16}
          step={1}
          display={`${shares} of ${formatQuantity(HELD)}`}
        />
        <Dial
          label="Price you are selling at"
          value={price}
          onChange={setPrice}
          min={2_000}
          max={30_000}
          step={100}
          display={`${money.format(minor(price))} a share`}
        />
        <Dial
          label="Fees"
          value={fees}
          onChange={setFees}
          min={0}
          max={2_000}
          step={25}
          display={money.format(minor(fees))}
        />
      </Controls>

      {outcome.refused !== null || outcome.result === null ? (
        <p className="rounded-md border border-caution-dim bg-caution-wash px-3.5 py-3 text-body text-caution">
          {outcome.refused}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[26rem]">
              <thead>
                <tr className="border-b border-line bg-raised">
                  <Th>Parcel bought</Th>
                  <Th align="right">Shares taken</Th>
                  <Th align="right">What they cost</Th>
                  <Th align="right">What they fetched</Th>
                </tr>
              </thead>
              <tbody>
                {outcome.result.relieved.map((relief) => (
                  <tr key={relief.lotId} className="border-b border-line-faint last:border-b-0">
                    <Td>
                      {describeDate(relief.acquiredDate, locale)}
                      {relief.closes && (
                        <span className="pl-2 text-micro text-ink-3">all of it</span>
                      )}
                    </Td>
                    <Td align="right">{formatQuantity(relief.quantity1e8)}</Td>
                    <Td align="right">{money.format(relief.costBasisMinor)}</Td>
                    <Td align="right">{money.format(relief.proceedsMinor)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Readout
            lines={[
              {
                label: 'What arrives, after fees',
                value: money.format(outcome.result.totalProceeds),
              },
              {
                label: 'What those shares cost',
                value: `− ${money.format(outcome.result.totalCostBasisRelieved)}`,
                note: 'Taken from the oldest parcels first',
                tone: 'taken',
              },
            ]}
            answer={{
              label: outcome.result.realizedGain < 0 ? 'Loss taken' : 'Gain taken',
              value: money.format(absolute(outcome.result.realizedGain)),
              tone: outcome.result.realizedGain < 0 ? 'deficit' : 'liquid',
            }}
          />

          <EngineSays>
            {describeDisposal(outcome.result, {
              symbol: 'the fund',
              quantity1e8: q(shares),
              cashAccountName: 'current account',
              format: (amount) => money.format(amount),
              formatDate: (iso) => describeDate(iso, locale),
            })}
          </EngineSays>
        </>
      )}
    </Lab>
  );
}

function absolute(amount: Minor): Minor {
  return minor(Math.abs(amount));
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-micro font-medium text-ink-3 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 text-caption text-ink-2 ${
        align === 'right' ? 'tnum text-right' : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}
