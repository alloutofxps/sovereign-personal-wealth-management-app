/* ===========================================================================
 * <Money>
 * ---------------------------------------------------------------------------
 * The only way an amount reaches the screen. It takes minor units and the
 * active currency from config — a caller cannot pass a symbol, and there is
 * no prop through which one could be injected.
 *
 * At figure and anchor sizes the fraction digits are set smaller and dimmer,
 * so the magnitude reads first at a glance while the cents stay available.
 * The pieces come from Intl via formatMoneyParts, so this works unchanged in
 * locales that trail the symbol or use a comma as the decimal mark.
 * ======================================================================== */

import clsx from 'clsx';
import type { Minor } from '@/core/money';
import { useMoney, type MoneyDisplayOptions } from '@/app/money/useMoney';

export type MoneySize = 'anchor' | 'figure' | 'lead' | 'body' | 'caption';
export type MoneyTone = 'auto' | 'neutral' | 'muted' | 'liquid' | 'caution' | 'deficit';

export interface MoneyProps extends MoneyDisplayOptions {
  value: Minor;
  size?: MoneySize;
  /** `auto` dims negatives to clay. Emerald is reserved for liquidity. */
  tone?: MoneyTone;
  /** Render fraction digits at full size and weight. */
  flatFraction?: boolean;
  className?: string;
}

const SIZE: Record<MoneySize, string> = {
  anchor: 'text-anchor font-medium tracking-[-0.02em]',
  figure: 'text-figure font-medium tracking-[-0.01em]',
  lead: 'text-lead font-medium',
  body: 'text-body',
  caption: 'text-caption',
};

const TONE: Record<Exclude<MoneyTone, 'auto'>, string> = {
  neutral: 'text-ink',
  muted: 'text-ink-2',
  liquid: 'text-liquid',
  caution: 'text-caution',
  deficit: 'text-deficit',
};

/** Fraction digits shrink only where there is enough size to make it read. */
const SMALL_FRACTION: Record<MoneySize, string | null> = {
  anchor: 'text-[0.5em] ml-[0.1em]',
  figure: 'text-[0.62em] ml-[0.08em]',
  lead: null,
  body: null,
  caption: null,
};

export function Money({
  value,
  size = 'body',
  tone = 'auto',
  flatFraction = false,
  className,
  ...options
}: MoneyProps) {
  const money = useMoney();
  const parts = money.parts(value, options);

  const resolvedTone = tone === 'auto' ? (parts.isNegative ? 'deficit' : 'neutral') : tone;
  // In compact notation the fraction is part of the magnitude ('1.3M'), so
  // shrinking it would misread as cents. Keep it at full size there.
  const fractionClass = flatFraction || parts.suffix ? null : SMALL_FRACTION[size];

  const number = (
    <>
      {parts.integer}
      {parts.fraction && (
        <span className={clsx(fractionClass, fractionClass && 'align-baseline opacity-60')}>
          {parts.decimalSeparator}
          {parts.fraction}
        </span>
      )}
      {parts.suffixGap}
      {parts.suffix}
    </>
  );

  const symbol = parts.symbol && (
    <span className={clsx(size === 'anchor' && 'text-[0.55em]', 'opacity-70')}>{parts.symbol}</span>
  );

  return (
    <span
      className={clsx('tnum inline-flex items-baseline whitespace-nowrap', SIZE[size], TONE[resolvedTone], className)}
      // Screen readers get the plain formatted string, not the split pieces.
      aria-label={parts.full}
    >
      <span aria-hidden="true" className="inline-flex items-baseline">
        {parts.sign}
        {parts.symbolTrails ? (
          <>
            {number}
            {parts.gap}
            {symbol}
          </>
        ) : (
          <>
            {symbol}
            {parts.gap}
            {number}
          </>
        )}
      </span>
    </span>
  );
}
