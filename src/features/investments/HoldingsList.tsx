/* ===========================================================================
 * WHAT IS ACTUALLY HELD
 * ---------------------------------------------------------------------------
 * One row per position, and the list is itself a chart.
 *
 * The sparkline is the reason this is not a table. A row that says a name, a
 * return and an amount tells somebody what a thing is worth; the same row with
 * the shape of the last few prices in it tells them how it got there, which is
 * the part they were actually scanning for. It costs 56 points of width and
 * one query for the whole screen.
 *
 * The ticker square takes the holding's family, so the same blue that means
 * "invested" on the accounts screen and in the bar above runs down the list.
 * The return pill is the one thing on the row that is not a category colour:
 * emerald up, clay down — never crimson, because a fund being down this month
 * is the most ordinary thing in investing and an app that treats it as an
 * emergency teaches people to stop looking.
 * ======================================================================== */

import clsx from 'clsx';
import { formatQuantity, formatReturn, valueOf, type Holding } from '@/core/investments';
import type { Minor } from '@/core/money';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useFx } from '@/app/fx/useFx';
import { familyClassFor } from '@/design/category';
import { Money, Sparkline } from '@/design/ui';

export function HoldingsList({
  holdings,
  priceHistory,
  onOpen,
}: {
  holdings: readonly Holding[];
  /** Recent prices per security id, oldest first. Absent means too few to draw. */
  priceHistory: Map<string, Minor[]>;
  onOpen: (holding: Holding) => void;
}) {
  const locale = useAppConfig((s) => s.locale);
  const money = useMoney();
  const fx = useFx();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title text-ink">Holdings</h2>

      <ul className="flex flex-col divide-y divide-line-faint">
        {holdings.map((holding) => {
          const value = valueOf(holding);
          const up = value.gainLoss > 0;
          const flat = value.gainLoss === 0;
          const series = priceHistory.get(holding.security.id);

          // A US fund is priced in dollars and worth euros. Both are true and
          // the person needs both, so both are shown rather than one being
          // silently converted into the other.
          const currency = holding.security.currency;
          const foreign = fx.isForeign(currency);
          const approx = foreign ? fx.approxInBase(value.marketValue, currency) : null;

          const family = familyClassFor(holding.security.assetClass);

          return (
            <li key={holding.id}>
              <button
                type="button"
                onClick={() => onOpen(holding)}
                className="press flex w-full items-center gap-3 rounded-lg py-3 pl-1 pr-1 text-left transition-colors [@media(hover:hover)]:hover:bg-raised"
              >
                {/* The ticker, as a square. It is how people actually refer to
                    what they hold, so it leads rather than the name. */}
                <span
                  className={clsx(
                    family,
                    'grid size-9 shrink-0 place-items-center rounded-md bg-[var(--tile-wash)]',
                    'font-mono text-[10.5px] font-bold tracking-tight text-[var(--tile-ink)]',
                  )}
                >
                  {holding.security.symbol.slice(0, 4)}
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body text-ink">{holding.security.name}</span>
                  <span className="truncate pt-0.5 text-micro text-ink-3">
                    {formatQuantity(holding.quantity1e8)}
                    {holding.quantity1e8 === 100_000_000 ? ' share' : ' shares'}
                    {' at '}
                    {foreign
                      ? fx.formatIn(holding.priceMinor, currency)
                      : money.format(holding.priceMinor)}
                    {holding.pricedOn ? ` · ${describeDate(holding.pricedOn, locale)}` : ''}
                  </span>
                </span>

                {/*
                  * The shape, in the holding's own colour.
                  *
                  * Only where there are at least two prices to join. A single
                  * price drawn flat across the box would be a claim that
                  * nothing moved, when the truth is that nothing was recorded.
                  */}
                {series && (
                  <span className={clsx(family, 'shrink-0 text-[var(--tile-ink)]')}>
                    <Sparkline values={series} />
                  </span>
                )}

                <span className="flex shrink-0 flex-col items-end gap-1">
                  {foreign ? (
                    <span className="flex flex-col items-end">
                      <span className="tnum text-lead text-ink">
                        {fx.formatIn(value.marketValue, currency, { decimals: 'hide' })}
                      </span>
                      {approx && <span className="tnum text-micro text-ink-3">{approx}</span>}
                    </span>
                  ) : (
                    <Money value={value.marketValue} size="lead" decimals="hide" />
                  )}
                  <span
                    className={clsx(
                      'tnum rounded-pill px-1.5 py-0.5 text-micro font-medium',
                      flat
                        ? 'bg-raised text-ink-3'
                        : up
                          ? 'bg-liquid-wash text-liquid'
                          : 'bg-deficit-wash text-deficit',
                    )}
                  >
                    {formatReturn(value.returnBp)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
