/* ===========================================================================
 * EXCHANGE RATES
 * ---------------------------------------------------------------------------
 * The rates are the one thing in this app that go stale on their own. Nothing
 * fetches them — no request has ever left this device and this is not where
 * that starts — so the screen's real job is to make updating them a ten-second
 * job rather than a chore, and to be honest about how old the figures are when
 * nobody has.
 *
 * Rates read quote-per-base throughout: 1.085215 on USD means one euro buys
 * 1.085215 dollars. Every rate source quotes it that way round, so it is the
 * way round somebody can copy without thinking.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import type { Rate1e6 } from '@/core/money';
// Deep import on purpose: see the note in the money barrel.
import { formatRate1e6, rateFromDecimal } from '@/core/money/fxReturns';
import { isoDate } from '@/core/ledger';
import { toIsoDate } from '@/core/liquidity';
import {
  FX_TABLES,
  currenciesInUse,
  latestRates,
  revalueForeignBalances,
  saveFxRates,
} from '@/data/repositories/fxRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Input } from '@/design/ui';

export function FxRatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const baseCurrency = useAppConfig((s) => s.currencyCode);
  const locale = useAppConfig((s) => s.locale);

  const [typed, setTyped] = useState<Record<string, string>>({});
  const [pasted, setPasted] = useState('');
  const [asOf, setAsOf] = useState(toIsoDate(new Date()));
  const [busy, setBusy] = useState(false);

  const rates = useLiveQuery(
    useCallback(() => latestRates(baseCurrency), [baseCurrency]),
    FX_TABLES,
  );
  const inUse = useLiveQuery(
    useCallback(() => currenciesInUse(baseCurrency), [baseCurrency]),
    FX_TABLES,
  );

  // Every currency that either has a rate or is used by something, so a newly
  // added dollar account appears here before it has ever been priced.
  const currencies = [
    ...new Set([...(inUse.data ?? []), ...(rates.data ?? []).map((r) => r.quoteCurrency)]),
  ].sort();

  useEffect(() => {
    if (!open) return;
    const start: Record<string, string> = {};
    for (const row of rates.data ?? []) {
      start[row.quoteCurrency] = formatRate1e6(row.rateScaled);
    }
    setTyped(start);
    setPasted('');
    setAsOf(toIsoDate(new Date()));
  }, [open, rates.data]);

  const parsed = parsePastedRates(pasted, asOf);
  const byCurrency = new Map((rates.data ?? []).map((r) => [r.quoteCurrency, r]));

  const updates = currencies.flatMap((currency) => {
    const fromPaste = parsed.matched.get(currency);
    const value = fromPaste ?? safeRate(typed[currency] ?? '');
    if (value === null) return [];
    if (value === byCurrency.get(currency)?.rateScaled && !fromPaste) return [];
    return [{ currency, rateScaled: value, date: fromPaste ? parsed.dateFor(currency) : asOf }];
  });

  async function save() {
    setBusy(true);
    try {
      const written = await saveFxRates(
        updates.map((u) => ({
          baseCurrency,
          quoteCurrency: u.currency,
          rateScaled: u.rateScaled,
          date: isoDate(u.date),
          source: parsed.matched.size > 0 ? ('csv' as const) : ('manual' as const),
        })),
      );

      // A new rate changes what foreign balances are worth, so the balance
      // sheet is brought into line in the same breath rather than drifting
      // until something else happens to touch it.
      const revalued = await revalueForeignBalances(baseCurrency, isoDate(asOf));

      toast(
        written === 0
          ? 'Nothing had changed, so nothing was recorded.'
          : `${written} ${written === 1 ? 'rate' : 'rates'} brought up to date.` +
              (revalued.length > 0
                ? ` ${revalued.length === 1 ? 'One account is' : `${revalued.length} accounts are`} now worth a different amount in ${baseCurrency}.`
                : ''),
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Those rates could not be saved.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title="Exchange rates"
      description={`How much of each currency one ${baseCurrency} buys. Nothing is fetched — these are the figures you give it.`}
      footer={
        currencies.length > 0 ? (
          <Button
            variant="primary"
            block
            disabled={busy || updates.length === 0}
            onClick={() => void save()}
          >
            {busy
              ? 'Saving…'
              : updates.length === 0
                ? 'Nothing has changed yet'
                : `Update ${updates.length} ${updates.length === 1 ? 'rate' : 'rates'}`}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {currencies.length === 0 ? (
          <p className="py-2 text-caption text-ink-2">
            Everything you hold is in {baseCurrency}, so there is nothing to convert. Add an
            account or a holding in another currency and it will appear here.
          </p>
        ) : (
          <>
            <Input
              type="date"
              label="Rates as at"
              value={asOf}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
              hint="Rates are kept per day, so a figure from last week stays where it was."
            />

            <ul className="flex flex-col gap-2.5">
              {currencies.map((currency) => {
                const row = byCurrency.get(currency);
                const fromPaste = parsed.matched.get(currency);
                return (
                  <li key={currency} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono text-caption text-ink">
                        1 {baseCurrency} = ? {currency}
                      </span>
                      <span className="truncate text-micro text-ink-3">
                        {row
                          ? `Last set ${describeDate(row.date, locale)}${row.source === 'csv' ? ' · pasted' : ''}`
                          : 'No rate yet — figures in this currency have no euro estimate.'}
                      </span>
                    </span>
                    <span className="w-32 shrink-0">
                      <Input
                        aria-label={`Rate for ${currency}`}
                        value={
                          fromPaste !== undefined
                            ? formatRate1e6(fromPaste)
                            : (typed[currency] ?? '')
                        }
                        onChange={(e) =>
                          setTyped((current) => ({ ...current, [currency]: e.target.value }))
                        }
                        readOnly={fromPaste !== undefined}
                        inputMode="decimal"
                        placeholder="1.085215"
                      />
                    </span>
                  </li>
                );
              })}
            </ul>

            <details className="rounded-md border border-line bg-raised px-3.5 py-3">
              <summary className="cursor-pointer text-caption text-ink">
                Paste rates instead
              </summary>
              <div className="flex flex-col gap-2 pt-3">
                <p className="text-caption text-ink-3">
                  One line each, as <span className="font-mono">currency,rate</span> — or{' '}
                  <span className="font-mono">date,currency,rate</span> to backfill a day you
                  missed. It stays on this device.
                </p>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder={'USD,1.085215\n2026-08-01,GBP,0.842100'}
                  className="w-full rounded-sm border border-line bg-sunken px-3 py-2 font-mono text-caption text-ink outline-none focus:border-line-strong"
                />
                {pasted.trim() !== '' && (
                  <p className="text-caption text-ink-2">
                    {parsed.matched.size === 0
                      ? 'None of those look like a currency and a rate. Check the spelling and try again.'
                      : `${parsed.matched.size} read.` +
                        (parsed.unknown.length > 0
                          ? ` ${parsed.unknown.join(', ')} ${parsed.unknown.length === 1 ? 'is' : 'are'} not in use here, so ${parsed.unknown.length === 1 ? 'it was' : 'they were'} left out.`
                          : '')}
                  </p>
                )}
              </div>
            </details>

            <Card>
              <p className="text-caption text-ink-2">
                Changing a rate changes what your foreign accounts are worth in {baseCurrency},
                so it moves what you are worth. It does not move your spending, and it does not
                move what is safe to spend — money you would have to convert first was never
                counted as spendable.
              </p>
            </Card>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

/* --- parsing -------------------------------------------------------------- */

function safeRate(input: string): Rate1e6 | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d{0,6}$/.test(cleaned) || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return rateFromDecimal(value);
}

export interface ParsedRates {
  matched: Map<string, Rate1e6>;
  /** Codes that were read but are not used anywhere. Named, not dropped. */
  unknown: string[];
  dateFor: (currency: string) => string;
}

/**
 * Read `currency,rate` or `date,currency,rate` lines.
 *
 * Both shapes, because a rate table copied from anywhere has a date column and
 * a rate typed from memory does not. Anything unrecognisable is skipped rather
 * than guessed at — a misread rate is worse than a missing one, since it looks
 * like an answer.
 */
export function parsePastedRates(text: string, fallbackDate: string): ParsedRates {
  const matched = new Map<string, Rate1e6>();
  const dates = new Map<string, string>();
  const unknown: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const parts = trimmed.split(/[,;\t]/).map((p) => p.trim());
    const withDate = parts.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0] ?? '');

    const date = withDate ? parts[0]! : fallbackDate;
    const code = (withDate ? parts[1] : parts[0])?.toUpperCase() ?? '';
    const raw = withDate ? parts[2] : parts[1];

    if (!/^[A-Z]{3}$/.test(code)) continue;

    const rate = safeRate(raw ?? '');
    if (rate === null) {
      if (!unknown.includes(code)) unknown.push(code);
      continue;
    }

    matched.set(code, rate);
    dates.set(code, date);
  }

  return { matched, unknown, dateFor: (currency) => dates.get(currency) ?? fallbackDate };
}
