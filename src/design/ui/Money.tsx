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
export type MoneyTone =
  | 'auto'
  /** Takes the colour of what it sits in — a field, a tile, a coloured row. */
  | 'inherit'
  | 'neutral'
  | 'muted'
  | 'liquid'
  | 'caution'
  | 'deficit';

export interface MoneyProps extends MoneyDisplayOptions {
  value: Minor;
  size?: MoneySize;
  /** `auto` dims negatives to clay. Emerald is reserved for liquidity. */
  tone?: MoneyTone;
  /** Render fraction digits at full size and weight. */
  flatFraction?: boolean;
  className?: string;
}

/*
 * Fraunces carries the two figure sizes and Space Grotesk the rest.
 *
 * `.figure` is where the optical-size axis earns its place: a 64px hero and a
 * 17px row amount are drawn with genuinely different stroke contrast rather
 * than one outline scaled up, which is what makes a number read as an amount
 * of money instead of a readout. Below `figure` the difference stops being
 * legible and the operational face is the better one — its digits are tabular
 * and it sits with the rest of the row.
 */
const SIZE: Record<MoneySize, string> = {
  anchor: 'figure text-anchor',
  figure: 'figure text-figure',
  lead: 'text-lead font-medium',
  body: 'text-body',
  caption: 'text-caption',
};

const TONE: Record<Exclude<MoneyTone, 'auto'>, string> = {
  /*
   * Takes the colour of whatever it sits in.
   *
   * For a figure on a field, which already carries its family's ink. The
   * alternative that was tried first -- `tone="neutral"` plus a
   * `text-[var(--tile-ink)]` className -- puts two colour utilities of equal
   * specificity on one element, and Tailwind emits `text-ink` after the
   * arbitrary one, so the override lost on every field in the app without
   * leaving a trace in the markup.
   */
  inherit: 'text-current',
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
