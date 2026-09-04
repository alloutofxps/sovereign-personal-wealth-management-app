/* ===========================================================================
 * WHAT IS ACTUALLY HELD
 * ---------------------------------------------------------------------------
 * One row per position. The return pill is emerald when it is up and clay when
 * it is down — never crimson, because a fund being down this month is the most
 * ordinary thing in investing and an app that treats it as an emergency
 * teaches people to stop looking.
 * ======================================================================== */

import clsx from 'clsx';
import { formatQuantity, formatReturn, valueOf, type Holding } from '@/core/investments';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useMoney } from '@/app/money/useMoney';
import { useFx } from '@/app/fx/useFx';
import { Card, Money } from '@/design/ui';

export function HoldingsList({
  holdings,
  onOpen,
}: {
  holdings: readonly Holding[];
  onOpen: (holding: Holding) => void;
}) {
  const locale = useAppConfig((s) => s.locale);
  const money = useMoney();
  const fx = useFx();

  return (
    <Card padding="none">
      <ul className="divide-y divide-line-faint">
        {holdings.map((holding) => {
          const value = valueOf(holding);
          const up = value.gainLoss > 0;
          const flat = value.gainLoss === 0;

          // A US fund is priced in dollars and worth euros. Both are true and
          // the person needs both, so both are shown rather than one being
          // silently converted into the other.
          const currency = holding.security.currency;
          const foreign = fx.isForeign(currency);
          const approx = foreign ? fx.approxInBase(value.marketValue, currency) : null;

          return (
            <li key={holding.id}>
              <button
                type="button"
                onClick={() => onOpen(holding)}
                className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised"
              >
                <span className="flex min-w-0 items-start gap-3">
                  {/* The ticker, as a badge. It is how people actually refer
                      to what they hold, so it leads rather than the name. */}
                  <span className="mt-0.5 shrink-0 rounded-sm bg-raised px-1.5 py-0.5 font-mono text-micro font-medium tracking-wide text-ink-2">
                    {holding.security.symbol}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-ink">{holding.security.name}</span>
                    <span className="truncate pt-0.5 text-caption text-ink-3">
                      {formatQuantity(holding.quantity1e8)}
                      {holding.quantity1e8 === 100_000_000 ? ' share' : ' shares'}
                      {' at '}
                      {foreign
                        ? fx.formatIn(holding.priceMinor, currency)
                        : money.format(holding.priceMinor)}
                      {holding.pricedOn ? ` · ${describeDate(holding.pricedOn, locale)}` : ''}
                    </span>
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  {foreign ? (
                    <span className="flex flex-col items-end">
                      <span className="tnum text-lead text-ink">
                        {fx.formatIn(value.marketValue, currency)}
                      </span>
                      {approx && <span className="tnum text-micro text-ink-3">{approx}</span>}
                    </span>
                  ) : (
                    <Money value={value.marketValue} size="lead" />
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
    </Card>
  );
}
