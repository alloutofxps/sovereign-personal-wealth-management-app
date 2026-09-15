/* ===========================================================================
 * WHAT YOU HOLD
 * ---------------------------------------------------------------------------
 * Three things a statement will not tell you: what it is actually worth
 * against what you paid, how much of it is in one kind of thing, and what the
 * funds take each year for holding it.
 *
 * Nothing on this screen is advice. It states figures and explains what they
 * mean; it never says what to do about them, because it does not know anything
 * about the person's plans, their nerve or their tax position.
 *
 * ---------------------------------------------------------------------------
 * THE DRIFT TILE NAMES THE CLASS THAT IS BEHIND, NEVER THE ONE THAT IS AHEAD
 *
 * This is the one place on the screen with a verb on it, and getting it wrong
 * would have had the interface contradict the engine behind it.
 *
 * `core/investments/rebalance.ts` computes two routes back to a chosen mix and
 * recommends neither, because it cannot: it does not know anybody's tax
 * position, their horizon, or whether they are about to need the money. But it
 * does *order* them, and the order is not arbitrary. Directing the next deposit
 * at whatever is furthest behind costs nothing. Selling the side that grew gets
 * there faster and realises a gain on the way, with a tax bill attached to it.
 * The file offers the deposit route first and shows the sale alongside with
 * what it would realise — deliberately, and it says so in its own header.
 *
 * The first version of this tile picked the line with the largest absolute
 * drift. On a portfolio that is all equities against a 60/30/10 target, that is
 * Shares at forty points over, and the sentence that closes an overweight gap
 * is a sale: it read "Shares drifted 40pts high — €4,945 sell brings it back".
 * One tile, put on the screen by a redesign, promoting the taxable disposal to
 * the recommended next action of a screen whose engine refuses to recommend it.
 *
 * Shares of one portfolio sum to 100, so anything over its target has something
 * under it. Selecting on `driftBp < 0` always finds that line when the mix is
 * off, and what it yields is a buy: "Bonds, 30pts under — your next €3,709 in
 * here closes it". Same drift, same sheet behind the tap, no disposal on
 * screen.
 *
 * If this ever gets rewritten to rank by magnitude again, that is the bug.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import { minor } from '@/core/money';
import { describeAllocation, formatReturn, type Holding } from '@/core/investments';
import { formatExpenseRatio } from '@/core/investments';
import { usePortfolio } from '@/app/investments/usePortfolio';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { INVESTMENT_TABLES, getRebalancePlan } from '@/data/repositories/investmentsRepo';
import { familyFor } from '@/design/category';
import { Button, Card, Field, Money, Ring, StatCell, StatStrip, Tile } from '@/design/ui';
import { AddHoldingSheet } from './AddHoldingSheet';
import { AssetAllocationBar } from './AssetAllocationBar';
import { FeeDragCard } from './FeeDragCard';
import { HoldingDetailSheet } from './HoldingDetailSheet';
import { HoldingsList } from './HoldingsList';
import { InvestSheet } from './InvestSheet';
import { RebalanceModal } from './RebalanceModal';
import { RecordDividendSheet } from './RecordDividendSheet';
import { SellHoldingSheet } from './SellHoldingSheet';
import { UpdatePricesSheet } from './UpdatePricesSheet';

export function InvestmentsView() {
  const [, navigate] = useRoute();
  const money = useMoney();
  const portfolio = usePortfolio();

  const [adding, setAdding] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [investing, setInvesting] = useState(false);
  const [viewing, setViewing] = useState<Holding | null>(null);
  const [selling, setSelling] = useState<Holding | null>(null);
  const [payingOut, setPayingOut] = useState<Holding | null>(null);
  const [rebalancing, setRebalancing] = useState(false);

  /*
   * Drift, for the tile.
   *
   * `null` means no targets have been set, which is a different thing from
   * being on target and gets a different treatment: nothing to fix, so nothing
   * that looks like a fix.
   */
  const rebalance = useLiveQuery(
    useCallback(() => getRebalancePlan(minor(0)), []),
    INVESTMENT_TABLES,
  );
  const plan = rebalance.data ?? null;

  /*
   * The class furthest BEHIND, not the class furthest off.
   *
   * Those are different lines and the difference is the whole argument of
   * `rebalance.ts`: the overweight side is closed by selling, which realises a
   * gain and a tax bill, and the underweight side is closed by putting the
   * next deposit there, which costs nothing. The engine offers the second
   * first and recommends neither, so the tile cannot lead with "sell" —
   * picking on absolute drift did exactly that.
   *
   * Shares of one portfolio add to 100, so whenever anything is over its
   * target something else is under it. The underweight line is always there
   * when the mix is off; the fallback is only for a plan that is off in a
   * shape this does not expect.
   */
  const lines = plan === null || plan.alreadyBalanced ? [] : plan.lines;
  const behind = lines.filter((line) => line.driftBp < 0);
  const pool = behind.length > 0 ? behind : lines;
  const worstDrift =
    pool.length === 0
      ? null
      : pool.reduce((worst, line) =>
          Math.abs(line.driftBp) > Math.abs(worst.driftBp) ? line : worst,
        );
  // The tile is coloured by what drifted, not by the fact that it drifted.
  const driftFamily = familyFor(worstDrift?.assetClass);

  const data = portfolio.data;

  /*
   * Which accounts already hold something.
   *
   * `AddHoldingSheet` needs it to say the truth in its preview: the first
   * holding recorded in an account replaces the figure somebody typed for it,
   * and every one after that adds to a register the account already follows.
   */
  const accountsHoldingSomething = useMemo(
    () => new Set((data?.holdings ?? []).map((h) => h.accountId)),
    [data?.holdings],
  );
  const up = (data?.totals.gainLoss ?? 0) > 0;
  const flat = (data?.totals.gainLoss ?? 0) === 0;

  const prices = new Map((data?.holdings ?? []).map((h) => [h.security.id, h.priceMinor]));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="headline text-ink">Invested</h1>
        {(data?.holdings.length ?? 0) > 0 && (
          <span className="flex shrink-0 gap-2">
            {/*
              * Targets live here only when there is no drift tile below.
              *
              * Where something has drifted, the tile is the way in and it
              * carries the number; a button saying the same thing two inches
              * above it would be two entrances to one room.
              */}
            {worstDrift === null && (
              <Button variant="secondary" size="sm" onClick={() => setRebalancing(true)}>
                Targets
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setPricing(true)}>
              Update prices
            </Button>
          </span>
        )}
      </header>

      {/*
        * --- the one field on this screen ---------------------------------
        *
        * Transport blue, because that is the family every invested thing
        * carries: the brokerage row on the accounts screen, the equity segment
        * of the bar below, the ticker square on each holding.
        *
        * The gain, what went in and the fee sit in the strip as three facts of
        * the same kind, rather than one as a loud pill and the others as lines
        * of grey prose underneath. They are what qualifies the figure, and the
        * sentences that used to carry them said nothing the numbers did not.
        */}
      {data && data.holdings.length > 0 && (
        <Field family="transport">
          <div className="text-caption opacity-75">What it is all worth</div>
          <div className="pt-1">
            <Money value={data.totals.marketValue} size="anchor" tone="inherit" />
          </div>

          <StatStrip className="pt-5">
            <StatCell label="Went in">
              {money.format(data.totals.costBasis, { decimals: 'hide' })}
            </StatCell>
            <StatCell
              label={flat ? 'Unchanged' : up ? 'Growth' : 'Below cost'}
              hint={formatReturn(data.totals.returnBp)}
            >
              {up ? '+' : data.totals.gainLoss < 0 ? '−' : ''}
              {money.format(minor(Math.abs(data.totals.gainLoss)), { decimals: 'hide' })}
            </StatCell>
            {data.feeDrag.weightedBp > 0 && (
              <StatCell
                label="Fund fee"
                hint={`${money.format(data.feeDrag.annualCost, { decimals: 'hide' })} a year`}
              >
                {formatExpenseRatio(data.feeDrag.weightedBp)}
              </StatCell>
            )}
          </StatStrip>

          <div className="flex flex-wrap gap-2 pt-5">
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              Add a holding
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setInvesting(true)}>
              Record money going in
            </Button>
          </div>
        </Field>
      )}

      {/*
        * --- what has drifted ---------------------------------------------
        *
        * One tile, one class, one number, one way to act on it. The sheet
        * behind it lists every line; this names the one that is furthest from
        * where it was meant to be, which is the only one a person can act on
        * first anyway.
        *
        * See CLAUDE.md: describe every instance, name only the one that needs
        * a decision. The bar below describes the whole allocation; this names
        * the single slice that has a decision attached to it.
        */}
      {data && data.holdings.length > 0 && worstDrift && (
        <Tile
          family={driftFamily}
          onClick={() => setRebalancing(true)}
          className="flex items-center gap-3.5"
          aria-label={`${worstDrift.name} is off target. Open targets.`}
        >
          <Ring
            progress={worstDrift.currentBp / 10_000}
            mark={worstDrift.targetBp / 10_000}
            size={46}
            weight={6}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            {/* Comma, not a verb: the class names are a mix of singular and
                plural — "Cash is" and "Bonds are" — and no one copula fits
                both. */}
            <span className="truncate text-body font-medium">
              {worstDrift.name}, {Math.round(Math.abs(worstDrift.driftBp) / 100)}pts{' '}
              {worstDrift.driftBp > 0 ? 'over' : 'under'}
            </span>
            <span className="truncate pt-0.5 text-caption opacity-75">
              {worstDrift.difference === 0
                ? 'Set against the target you gave it'
                : worstDrift.difference > 0
                  ? `Your next ${money.format(minor(worstDrift.difference), {
                      decimals: 'hide',
                    })} in here closes it`
                  : `${money.format(minor(-worstDrift.difference), {
                      decimals: 'hide',
                    })} would have to come out of it`}
            </span>
          </span>
          <span className="shrink-0 rounded-pill bg-[color-mix(in_srgb,var(--color-surface)_62%,transparent)] px-2.5 py-1 text-micro font-medium">
            Fix
          </span>
        </Tile>
      )}

      {/* --- nothing yet ---------------------------------------------------- */}
      {data === undefined ? (
        <Card>
          <p className="py-8 text-center text-caption text-ink-3">Adding it up…</p>
        </Card>
      ) : data.accounts.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">No investment accounts yet</p>
            <p className="max-w-[38ch] text-caption text-ink-2">
              Add a brokerage account or a pension and you can record what is in it: what you
              hold, what it cost, and what the funds charge you each year for it.
            </p>
            <Button variant="secondary" onClick={() => navigate('accounts')}>
              Go to accounts
            </Button>
          </div>
        </Card>
      ) : data.holdings.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">Nothing recorded yet</p>
            <p className="max-w-[38ch] text-caption text-ink-2">
              Your accounts are set up. Add what is actually in them and this will show how it
              is spread and what it costs to hold.
            </p>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add a holding
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <AssetAllocationBar
            allocation={data.allocation}
            description={describeAllocation(data.allocation)}
          />

          <HoldingsList
            holdings={data.holdings}
            priceHistory={data.priceHistory}
            onOpen={setViewing}
          />

          <FeeDragCard drag={data.feeDrag} />

          {/*
            * --- where the tax figure went ---------------------------------
            *
            * The deferred-tax card lives on Net worth now, in both regimes.
            *
            * It was never a fact about the portfolio. Under a gains regime it
            * needs the cost basis, which is here; under a deemed-return regime
            * it is charged on the bank balances and the card debts too, and a
            * figure worked out from the brokerage alone told a household with
            * twenty-eight thousand in the bank that it owed nothing. The
            * screen that already holds every account is the screen where the
            * whole estate is on hand, so that is where the number belongs.
            *
            * This is the link, not a second copy of it. One number, one home.
            */}
          <button
            type="button"
            onClick={() => navigate('accounts')}
            className="press flex items-center justify-between gap-3 rounded-card border border-line px-4 py-3.5 text-left"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-body text-ink">What of this is not yours</span>
              <span className="pt-0.5 text-caption text-ink-2">
                The tax owed on it is worked out across everything you hold, on Net worth.
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-ink-3">
              →
            </span>
          </button>
        </>
      )}

      {data && (
        <>
          <AddHoldingSheet
            open={adding}
            onClose={() => setAdding(false)}
            accounts={data.accounts}
            accountsHoldingSomething={accountsHoldingSomething}
          />
          <UpdatePricesSheet
            open={pricing}
            onClose={() => setPricing(false)}
            securities={data.securities}
            currentPrices={prices}
          />
          <InvestSheet
            open={investing}
            onClose={() => setInvesting(false)}
            accounts={data.accounts}
          />
          <HoldingDetailSheet
            holding={viewing}
            onClose={() => setViewing(null)}
            onSell={() => {
              setSelling(viewing);
              setViewing(null);
            }}
            onDividend={() => {
              setPayingOut(viewing);
              setViewing(null);
            }}
          />
          <SellHoldingSheet holding={selling} onClose={() => setSelling(null)} />
          <RecordDividendSheet holding={payingOut} onClose={() => setPayingOut(null)} />
          <RebalanceModal open={rebalancing} onClose={() => setRebalancing(false)} />
        </>
      )}
    </div>
  );
}
