/* ===========================================================================
 * NARROWING IT DOWN
 * ---------------------------------------------------------------------------
 * Account, category, a window of dates, and how much it was for. Each filter
 * that is on becomes a chip on the screen behind this sheet, so it is always
 * visible why a list is shorter than expected — a filter you have forgotten
 * about is indistinguishable from missing data, and much more alarming.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { minor } from '@/core/money';
import { isoDate, type AccountId, type LedgerAccount } from '@/core/ledger';
import type { EntrySearchParams } from '@/data/repositories/searchRepo';
import { useMoney } from '@/app/money/useMoney';
import { BottomSheet, Button, Chip, Input } from '@/design/ui';

export interface FilterChip {
  key: string;
  label: string;
  remove: (current: EntrySearchParams) => EntrySearchParams;
}

/** The filters currently applied, as chips that can each be taken off. */
export function describeFilters(
  params: EntrySearchParams,
  accounts: Map<AccountId, LedgerAccount>,
): FilterChip[] {
  const chips: FilterChip[] = [];
  const nameOf = (id: string) => accounts.get(id as AccountId)?.name ?? 'an account';

  for (const id of params.accountIds ?? []) {
    chips.push({
      key: `account:${id}`,
      label: nameOf(id),
      remove: (current) => {
        const rest = (current.accountIds ?? []).filter((a) => a !== id);
        const { accountIds: _drop, ...others } = current;
        return rest.length ? { ...others, accountIds: rest } : others;
      },
    });
  }

  for (const id of params.categoryIds ?? []) {
    chips.push({
      key: `category:${id}`,
      label: nameOf(id),
      remove: (current) => {
        const rest = (current.categoryIds ?? []).filter((c) => c !== id);
        const { categoryIds: _drop, ...others } = current;
        return rest.length ? { ...others, categoryIds: rest } : others;
      },
    });
  }

  if (params.dateRange) {
    chips.push({
      key: 'dates',
      label: `${params.dateRange.start} to ${params.dateRange.end}`,
      remove: ({ dateRange: _drop, ...others }) => others,
    });
  }

  if (params.amountRange?.min !== undefined || params.amountRange?.max !== undefined) {
    chips.push({
      key: 'amount',
      label: 'A set amount',
      remove: ({ amountRange: _drop, ...others }) => others,
    });
  }

  if (params.hasNotes) {
    chips.push({
      key: 'notes',
      label: 'Has a note',
      remove: ({ hasNotes: _drop, ...others }) => others,
    });
  }

  return chips;
}

export function FilterSheet({
  open,
  onClose,
  value,
  onChange,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  value: EntrySearchParams;
  onChange: (next: EntrySearchParams) => void;
  accounts: readonly LedgerAccount[];
}) {
  const money = useMoney();
  const [draft, setDraft] = useState<EntrySearchParams>(value);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');

  // Reopening should show what is actually applied, not what was abandoned
  // last time the sheet was dismissed.
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setMinText(value.amountRange?.min !== undefined ? String(value.amountRange.min / 100) : '');
    setMaxText(value.amountRange?.max !== undefined ? String(value.amountRange.max / 100) : '');
  }, [open, value]);

  const places = accounts.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY');
  const categories = accounts.filter((a) => a.type === 'EXPENSE');

  const toggle = (list: string[] | undefined, id: string): string[] | undefined => {
    const current = list ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    return next.length ? next : undefined;
  };

  function apply() {
    const next: EntrySearchParams = { ...draft };

    const min = parseMajor(minText);
    const max = parseMajor(maxText);
    if (min !== null || max !== null) {
      next.amountRange = {
        ...(min !== null ? { min: minor(min) } : {}),
        ...(max !== null ? { max: minor(max) } : {}),
      };
    } else {
      delete next.amountRange;
    }

    onChange(next);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title="Narrow it down"
      footer={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            block
            onClick={() => {
              onChange({});
              onClose();
            }}
          >
            Clear everything
          </Button>
          <Button variant="primary" block onClick={apply}>
            Show these
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 pb-2">
        <Section title="Which account">
          <div className="flex flex-wrap gap-2">
            {places.map((account) => (
              <Chip
                key={account.id}
                active={(draft.accountIds ?? []).includes(account.id)}
                onClick={() =>
                  setDraft((d) => {
                    const ids = toggle(d.accountIds, account.id);
                    const { accountIds: _drop, ...rest } = d;
                    return ids ? { ...rest, accountIds: ids } : rest;
                  })
                }
              >
                {account.name}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="What it was for">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Chip
                key={category.id}
                active={(draft.categoryIds ?? []).includes(category.id)}
                onClick={() =>
                  setDraft((d) => {
                    const ids = toggle(d.categoryIds, category.id);
                    const { categoryIds: _drop, ...rest } = d;
                    return ids ? { ...rest, categoryIds: ids } : rest;
                  })
                }
              >
                {category.name}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Between which dates">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="From"
              value={draft.dateRange?.start ?? ''}
              onChange={(e) =>
                setDraft((d) => withDates(d, e.target.value, d.dateRange?.end ?? ''))
              }
              containerClassName="flex-1"
            />
            <span className="text-caption text-ink-3">to</span>
            <Input
              type="date"
              aria-label="To"
              value={draft.dateRange?.end ?? ''}
              onChange={(e) =>
                setDraft((d) => withDates(d, d.dateRange?.start ?? '', e.target.value))
              }
              containerClassName="flex-1"
            />
          </div>
        </Section>

        <Section title={`How much, in ${money.currency}`}>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              aria-label="At least"
              placeholder="At least"
              value={minText}
              onChange={(e) => setMinText(e.target.value)}
              containerClassName="flex-1"
            />
            <span className="text-caption text-ink-3">to</span>
            <Input
              type="number"
              inputMode="decimal"
              aria-label="At most"
              placeholder="At most"
              value={maxText}
              onChange={(e) => setMaxText(e.target.value)}
              containerClassName="flex-1"
            />
          </div>
        </Section>

        <Section title="Anything else">
          <Chip
            active={Boolean(draft.hasNotes)}
            onClick={() =>
              setDraft((d) => {
                const { hasNotes: _drop, ...rest } = d;
                return d.hasNotes ? rest : { ...rest, hasNotes: true };
              })
            }
          >
            Only ones with a note
          </Chip>
        </Section>
      </div>
    </BottomSheet>
  );
}

function withDates(params: EntrySearchParams, start: string, end: string): EntrySearchParams {
  const { dateRange: _drop, ...rest } = params;
  if (!start && !end) return rest;
  // One end filled in is still a useful window; the other end goes wide.
  return {
    ...rest,
    dateRange: {
      start: isoDate(start || '0001-01-01'),
      end: isoDate(end || '9999-12-31'),
    },
  };
}

/** Read a major-unit figure like "12.50" into minor units. Null when empty. */
function parseMajor(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
        {title}
      </span>
      {children}
    </div>
  );
}
