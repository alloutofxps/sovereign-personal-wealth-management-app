/* ===========================================================================
 * THE SCREEN SHOWS WHAT THE ENGINE RETURNED
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * This is not the rendering gate. It uses `renderToStaticMarkup`, which is
 * server rendering: **no effects run, no layout happens, nothing is
 * interactive.** It therefore cannot see any of the defects that made the
 * rendering gate worth building — not the focus trap that never installed on a
 * cold open, not a stale closure, not hook order, not geometry, not an
 * accessible name computed from the tree. `renderingGate.test.tsx` is where
 * those live.
 *
 * It closes exactly one class from the G1 analysis in `AUDIT.md`, and it is
 * the cheapest one to close: **engine-to-screen wiring.** Until this file, 981
 * tests established that the engines were right and nothing established that a
 * screen reads the right one with the right arguments. `ForecastBand`'s
 * scrubber converted pointer positions against a stale width for months while
 * its engine was perfectly correct, and no test could have noticed.
 *
 * It costs nothing to run and needed no new dependency: `react-dom` was
 * already here.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF THE ASSERTION
 *
 * Call the engine. Hand its output to the screen. Assert the screen prints the
 * engine's number, formatted by the one formatter the app is allowed to use.
 * Nothing is hand-written on either side, so the test cannot drift from either
 * — if the card starts reading `committed` instead of `safeToSpend`, or
 * formats it itself, this fails.
 * ======================================================================== */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { minor, formatMoney, type Minor } from '@/core/money';
import { calculateSafeToSpend, type Cycle } from '@/core/liquidity';
import { useAppConfig } from '@/app/config/store';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { SafeToSpendCard } from './SafeToSpendCard';

const m = (major: number): Minor => minor(Math.round(major * 100));

/** Mid-cycle, so `dailyPace` has days to spread over. */
const CYCLE: Cycle = {
  start: '2026-09-01',
  end: '2026-09-30',
  totalDays: 30,
  elapsedDays: 14,
  remainingDays: 17,
};

/** Plain text, the way a person reads it rather than the way React writes it. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'");

describe('Safe to spend, engine to screen', () => {
  const engine = calculateSafeToSpend({
    liquidCash: m(28_402.84),
    bills: [{ label: 'Rent', amount: m(1_326.76), kind: 'bill', dueDate: '2026-09-20' }],
    cardBalances: [{ label: 'Main Visa', amount: m(2_308.58), kind: 'card' }],
    buffer: m(200),
    goalFunding: m(10_964.29),
    cycle: CYCLE,
    daysUntilIncome: 11,
  });

  /*
   * The card reads `liquidity`, `cycle` and `buffer` and nothing else, which
   * the cast records rather than hides: if it grows a dependency on a field
   * that is not here, this throws rather than silently rendering a blank.
   */
  const data = { liquidity: engine, cycle: CYCLE, buffer: m(200) } as DashboardData;

  const html = renderToStaticMarkup(
    <SafeToSpendCard data={data} onExplain={() => {}} onExplainTopic={() => {}} />,
  );
  const text = textOf(html);

  it('prints the figure the engine returned, not one of its own', () => {
    const { currencyCode, locale } = useAppConfig.getState();
    const expected = formatMoney(engine.safeToSpend, { currency: currencyCode, locale });
    expect(text, `the card should show ${expected}`).toContain(expected);
  });

  it('shows the engine’s daily pace and the cushion it was given', () => {
    const { currencyCode, locale } = useAppConfig.getState();
    const money = (amount: Minor) =>
      formatMoney(amount, { currency: currencyCode, locale, decimals: 'hide' });
    expect(text).toContain(money(engine.dailyPace));
    expect(text).toContain(money(data.buffer));
  });

  it('does not print a figure the engine did not produce', () => {
    // `committed` is the total taken off. It belongs in the breakdown sheet,
    // never on the face of the card, and confusing the two is exactly the
    // wiring mistake this file exists to catch.
    const { currencyCode, locale } = useAppConfig.getState();
    const committed = formatMoney(engine.committed, { currency: currencyCode, locale });
    expect(engine.committed).not.toBe(engine.safeToSpend);
    expect(text).not.toContain(committed);
  });

  it('renders the days-until-income ring from the cycle it was given', () => {
    // 11 days until income, and the ring's accessible name says so in words.
    expect(html).toContain('11 days until you are next paid');
  });
});
