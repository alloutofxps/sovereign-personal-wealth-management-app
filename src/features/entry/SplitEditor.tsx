/* ===========================================================================
 * DIVIDING ONE PAYMENT UP
 * ---------------------------------------------------------------------------
 * €120 at the supermarket is rarely €120 of one thing. This is where it
 * becomes €80 of food, €25 of household and €15 of something for the bathroom
 * cabinet.
 *
 * The running remainder is the whole design. Everything else here — the
 * "assign the rest" button, the disabled submit, the emerald line when it is
 * exact — exists to make one number, the bit not yet accounted for, impossible
 * to lose track of. Arithmetic the person has to do in their head is
 * arithmetic they will get wrong, and a split that does not add up is a
 * payment that quietly misstates a month.
 * ======================================================================== */

import { useMemo } from 'react';
import clsx from 'clsx';
import { minor, type Minor } from '@/core/money';
import type { AccountId, SplitLine } from '@/core/ledger';
import { CATEGORIES } from '@/data/seed';
import { useMoney } from '@/app/money/useMoney';
import { Button, Input, Money, Select } from '@/design/ui';

/** A line while it is still being edited: the amount is text, not a number. */
export interface DraftLine {
  key: string;
  categoryId: AccountId | '';
  amountText: string;
  memo: string;
}

export function newDraftLine(): DraftLine {
  return { key: crypto.randomUUID(), categoryId: '', amountText: '', memo: '' };
}

/** Read a typed figure like "12,50" into minor units. Zero when unreadable. */
export function parseAmountText(text: string): Minor {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return minor(0);
  return minor(Math.round(value * 100));
}

/** The lines that are complete enough to post. */
export function toSplitLines(drafts: readonly DraftLine[]): SplitLine[] {
  const lines: SplitLine[] = [];
  for (const draft of drafts) {
    const amount = parseAmountText(draft.amountText);
    if (!draft.categoryId || amount <= 0) continue;
    const pair = CATEGORIES.find((c) => c.categoryId === draft.categoryId);
    if (!pair) continue;
    lines.push({
      categoryId: pair.categoryId,
      envelopeId: pair.envelopeId,
      amount,
      ...(draft.memo.trim() ? { memo: draft.memo.trim() } : {}),
    });
  }
  return lines;
}

export function allocated(drafts: readonly DraftLine[]): Minor {
  return minor(drafts.reduce((sum, draft) => sum + parseAmountText(draft.amountText), 0));
}

export function SplitEditor({
  total,
  lines,
  onChange,
}: {
  total: Minor;
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
}) {
  const money = useMoney();

  const given = allocated(lines);
  const remainder = minor(total - given);
  const exact = remainder === 0 && given > 0;
  const over = remainder < 0;

  const options = useMemo(
    () => CATEGORIES.map((c) => ({ value: c.categoryId, label: c.name })),
    [],
  );

  const update = (key: string, patch: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
          Splitting
        </span>
        <Money value={total} size="lead" />
      </div>

      <div className="flex flex-col gap-3">
        {lines.map((line, index) => {
          const lineAmount = parseAmountText(line.amountText);
          const rest = minor(total - given + lineAmount);

          return (
            <div
              key={line.key}
              className="flex flex-col gap-2 rounded-md border border-line bg-raised p-3"
            >
              <div className="flex items-start gap-2">
                <Select
                  aria-label={`What part ${index + 1} was for`}
                  value={line.categoryId}
                  onChange={(e) => update(line.key, { categoryId: e.target.value as AccountId })}
                  options={options}
                  placeholder="What was it for?"
                  containerClassName="flex-1"
                />

                {lines.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                    aria-label={`Remove part ${index + 1}`}
                    className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:text-caution"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="m6 6 12 12M18 6 6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <div className="flex items-end gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  aria-label={`How much of it was part ${index + 1}`}
                  placeholder="0.00"
                  value={line.amountText}
                  onChange={(e) => update(line.key, { amountText: e.target.value })}
                  containerClassName="flex-1"
                />
                {remainder !== 0 && rest > 0 && (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() =>
                      update(line.key, { amountText: (rest / 100).toFixed(2) })
                    }
                  >
                    Use the rest
                  </Button>
                )}
              </div>

              <Input
                type="text"
                aria-label={`A note about part ${index + 1}`}
                placeholder="A note about this part (optional)"
                value={line.memo}
                onChange={(e) => update(line.key, { memo: e.target.value })}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" size="sm" onClick={() => onChange([...lines, newDraftLine()])}>
          Add another part
        </Button>

        <p
          className={clsx(
            'text-caption',
            exact ? 'text-liquid' : over ? 'text-deficit' : 'text-caution',
          )}
          role="status"
        >
          {exact
            ? `All ${money.format(total)} accounted for.`
            : over
              ? `${money.format(minor(-remainder))} more than the payment.`
              : `${money.format(remainder)} left to allocate.`}
        </p>
      </div>
    </div>
  );
}
