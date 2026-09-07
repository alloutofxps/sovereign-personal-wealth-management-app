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
 * ======================================================================== */

import { useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import { describeAllocation, formatReturn, type Holding } from '@/core/investments';
import { formatExpenseRatio } from '@/core/investments';
import { usePortfolio } from '@/app/investments/usePortfolio';
import { useMoney } from '@/app/money/useMoney';
import { useRoute } from '@/app/router';
import { Button, Card, Money } from '@/design/ui';
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
import { DeferredTaxCard } from './DeferredTaxCard';

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

  const data = portfolio.data;
  const up = (data?.totals.gainLoss ?? 0) > 0;
  const flat = (data?.totals.gainLoss ?? 0) === 0;

  const prices = new Map((data?.holdings ?? []).map((h) => [h.security.id, h.priceMinor]));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lead font-medium text-ink">What you hold</h1>
          <p className="text-caption text-ink-2">
            Your investments, what they have done, and what they cost to keep.
          </p>
        </div>
        {(data?.holdings.length ?? 0) > 0 && (
          <span className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRebalancing(true)}>
              Targets
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPricing(true)}>
              Update prices
            </Button>
          </span>
        )}
      </header>

      {/* --- the headline -------------------------------------------------- */}
      {data && data.holdings.length > 0 && (
        <Card label="What it is all worth" accent="liquid">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Money value={data.totals.marketValue} size="figure" />
              <span
                className={clsx(
                  'tnum rounded-pill px-2.5 py-1 text-micro font-medium',
                  flat
                    ? 'bg-raised text-ink-2'
                    : up
                      ? 'bg-liquid-wash text-liquid'
                      : 'bg-deficit-wash text-deficit',
                )}
              >
                {up ? '+' : data.totals.gainLoss < 0 ? '−' : ''}
                {money.format(minor(Math.abs(data.totals.gainLoss)))} (
                {formatReturn(data.totals.returnBp)})
              </span>
            </div>

            <p className="text-caption text-ink-2">
              {money.format(data.totals.costBasis)} went in.{' '}
              {flat
                ? 'It is exactly where it started.'
                : up
                  ? 'The rest is growth you have not sold.'
                  : 'It is below what you paid, which is what markets do between the days you look.'}
            </p>

            {data.feeDrag.weightedBp > 0 && (
              <p className="text-caption text-ink-3">
                Weighted fund fee: {formatExpenseRatio(data.feeDrag.weightedBp)} a year, about{' '}
                {money.format(data.feeDrag.annualCost)} at this size.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                Add a holding
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setInvesting(true)}>
                Record money going in
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* --- what of it is not yours ---------------------------------------- */}
      {data && data.holdings.length > 0 && (
        <DeferredTaxCard
          investments={data.totals.marketValue}
          costBasis={data.totals.costBasis}
        />
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
              Add a brokerage account or a pension and you can record what is in it — what you
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

          <section className="flex flex-col gap-3">
            <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">
              Everything you hold
            </h2>
            <HoldingsList holdings={data.holdings} onOpen={setViewing} />
          </section>

          <FeeDragCard drag={data.feeDrag} />
        </>
      )}

      {data && (
        <>
          <AddHoldingSheet
            open={adding}
            onClose={() => setAdding(false)}
            accounts={data.accounts}
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
