/* ===========================================================================
 * BRINGING THE PRICES UP TO DATE
 * ---------------------------------------------------------------------------
 * The chore that decides whether a holdings register gets used at all. Twenty
 * positions, each needing a number typed into its own screen, is a job nobody
 * does twice — so it is one screen, one list, and one save.
 *
 * The paste box is there because the fastest way to get twenty prices out of a
 * broker is to copy two columns out of it. Nothing is uploaded anywhere; the
 * text is parsed here, on the device, like everything else in this app.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { Security } from '@/core/investments';
import { updatePrices, type PriceUpdate } from '@/data/repositories/investmentsRepo';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Input, Textarea } from '@/design/ui';

export function UpdatePricesSheet({
  open,
  onClose,
  securities,
  currentPrices,
}: {
  open: boolean;
  onClose: () => void;
  securities: readonly Security[];
  currentPrices: ReadonlyMap<string, Minor>;
}) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);

  // Start from what is already recorded, so this is editing rather than
  // retyping — and so leaving a row alone genuinely means "unchanged".
  useEffect(() => {
    if (!open) return;
    const start: Record<string, string> = {};
    for (const security of securities) {
      const price = currentPrices.get(security.id);
      start[security.id] = price ? (price / 100).toFixed(2) : '';
    }
    setTyped(start);
    setPasted('');
  }, [open, securities, currentPrices]);

  const parsedPaste = parsePastedPrices(pasted, securities);

  const updates: PriceUpdate[] = securities.flatMap((security) => {
    const fromPaste = parsedPaste.matched.get(security.symbol);
    const price = fromPaste ?? toMinor(typed[security.id] ?? '');
    if (price === null) return [];
    if (price === currentPrices.get(security.id)) return [];
    return [{ securityId: security.id, priceMinor: price }];
  });

  async function save() {
    setBusy(true);
    try {
      const result = await updatePrices(updates, parsedPaste.matched.size > 0 ? 'csv' : 'manual');
      toast(
        result.prices === 0
          ? 'Nothing had changed, so nothing was recorded.'
          : `${result.prices} ${result.prices === 1 ? 'price' : 'prices'} brought up to date.` +
              (result.accounts > 0
                ? ` ${result.accounts === 1 ? 'One account is' : `${result.accounts} accounts are`} now worth a different amount.`
                : ''),
      );
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Those prices could not be saved.', {
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
      title="Bring the prices up to date"
      description="Change what you like and leave the rest. Nothing here moves any money."
      footer={
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
              : `Update ${updates.length} ${updates.length === 1 ? 'price' : 'prices'}`}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {securities.length === 0 ? (
          <p className="py-2 text-caption text-ink-2">
            Nothing to price yet. Add what you hold and it will appear here.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {securities.map((security) => {
                const fromPaste = parsedPaste.matched.get(security.symbol);
                return (
                  <li key={security.id} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono text-caption text-ink">{security.symbol}</span>
                      <span className="truncate text-micro text-ink-3">{security.name}</span>
                    </span>
                    <span className="w-32 shrink-0">
                      <Input
                        aria-label={`Price for ${security.symbol}`}
                        value={
                          fromPaste !== undefined
                            ? (fromPaste / 100).toFixed(2)
                            : (typed[security.id] ?? '')
                        }
                        onChange={(e) =>
                          setTyped((current) => ({ ...current, [security.id]: e.target.value }))
                        }
                        readOnly={fromPaste !== undefined}
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </span>
                  </li>
                );
              })}
            </ul>

            <details className="rounded-md border border-line bg-raised px-3.5 py-3">
              <summary className="cursor-pointer text-caption text-ink">
                Paste prices instead
              </summary>
              <div className="flex flex-col gap-2 pt-3">
                <p className="text-caption text-ink-3">
                  One line per holding, as <span className="font-mono">symbol,price</span>. Copying
                  two columns out of your broker works. It stays on this device.
                </p>
                <Textarea
                  aria-label="Prices to paste in"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder={'VWCE,118.50\nVUSA,92.00'}
                  className="bg-sunken px-3 py-2 font-mono text-caption"
                />
                {pasted.trim() !== '' && (
                  <p className="text-caption text-ink-2">
                    {parsedPaste.matched.size === 0
                      ? 'None of those symbols matched something you hold. Check the spelling and try again.'
                      : `${parsedPaste.matched.size} matched.` +
                        (parsedPaste.unknown.length > 0
                          ? ` ${parsedPaste.unknown.join(', ')} ${
                              parsedPaste.unknown.length === 1 ? 'is not' : 'are not'
                            } something you hold, so ${
                              parsedPaste.unknown.length === 1 ? 'it was' : 'they were'
                            } left out.`
                          : '')}
                  </p>
                )}
              </div>
            </details>

            {updates.length > 0 && (
              <p className="text-caption text-ink-2">
                {updates.length === 1
                  ? 'One price has changed. '
                  : `${updates.length} prices have changed. `}
                Saving will bring the account values into line with what they now hold, which
                changes what you are worth, but not your spending or what is safe to spend.
              </p>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

/* --- parsing ------------------------------------------------------------- */

function toMinor(input: string): Minor | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '.') return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return minor(Number(`${whole || '0'}${fraction.padEnd(2, '0')}`));
}

export interface ParsedPrices {
  matched: Map<string, Minor>;
  /** Symbols in the pasted text that are not held. Named, not silently dropped. */
  unknown: string[];
}

/**
 * Read `symbol,price` lines against what is actually held.
 *
 * Tabs and semicolons count as separators too, because a spreadsheet copy is
 * tab-separated and half of Europe exports CSV with semicolons. A header row
 * is ignored rather than treated as a symbol nobody holds.
 */
export function parsePastedPrices(
  text: string,
  securities: readonly Security[],
): ParsedPrices {
  const bySymbol = new Map(securities.map((s) => [s.symbol.toUpperCase(), s]));
  const matched = new Map<string, Minor>();
  const unknown: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const [rawSymbol = '', rawPrice = ''] = trimmed.split(/[,;\t]/);
    const symbol = rawSymbol.trim().toUpperCase();
    if (symbol === '' || symbol === 'SYMBOL' || symbol === 'TICKER') continue;

    const price = toMinor(rawPrice);
    if (price === null) continue;

    const security = bySymbol.get(symbol);
    if (!security) {
      if (!unknown.includes(symbol)) unknown.push(symbol);
      continue;
    }
    matched.set(security.symbol, price);
  }

  return { matched, unknown };
}
