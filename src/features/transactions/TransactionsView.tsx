/* ===========================================================================
 * EVERYTHING YOU HAVE RECORDED
 * ---------------------------------------------------------------------------
 * Before this screen existed, Sovereign could record a payment and never show
 * it to you again — the dashboard's last eight entries were the whole window
 * onto your own history. A double-entry ledger you cannot query is a
 * write-only log.
 *
 * The two empty states are deliberately different. "Nothing matches" and
 * "nothing recorded yet" look identical to a component and feel completely
 * different to a person: one means try again, the other means get started.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import { minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import type { EntryWithPostings } from '@/data/repositories/ledgerRepo';
import type { EntrySearchParams } from '@/data/repositories/searchRepo';
import { useAccounts } from '@/app/ledger/useLedger';
import { useDebounced, useEntrySearch, useMonthGroups } from '@/app/ledger/useSearch';
import { presentEntry, type PresentedEntry } from '@/app/ledger/present';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import {
  Button,
  Card,
  Chip,
  ClearButton,
  Input,
  List,
  ListItem,
  ListSectionHeader,
  Money,
  SearchIcon,
} from '@/design/ui';
import { PaymentDetailsSheet } from '@/features/entry/PaymentDetailsSheet';
import { FilterSheet, describeFilters } from './FilterSheet';

const PAGE_SIZE = 100;

export function TransactionsView() {
  const [, navigate] = useRoute();
  const locale = useAppConfig((s) => s.locale);
  const accounts = useAccounts();

  const [typed, setTyped] = useState('');
  const [filters, setFilters] = useState<EntrySearchParams>({});
  const [filtering, setFiltering] = useState(false);
  const [looking, setLooking] = useState<EntryWithPostings | null>(null);

  const query = useDebounced(typed);

  const params = useMemo<EntrySearchParams>(
    () => ({ ...filters, ...(query.trim() ? { query: query.trim() } : {}), limit: PAGE_SIZE }),
    [filters, query],
  );

  const results = useEntrySearch(params);
  const entries = results.data?.entries ?? [];
  const total = results.data?.total ?? 0;

  const byId = useMemo(
    () => new Map<AccountId, LedgerAccount>((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );

  const groups = useMonthGroups(entries, locale);
  const searching = query.trim().length > 0;
  const filterChips = describeFilters(filters, byId);
  const narrowed = searching || filterChips.length > 0;

  const clearEverything = useCallback(() => {
    setTyped('');
    setFilters({});
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Everything you have recorded</h1>
        <p className="text-caption text-ink-2">
          {results.data === undefined
            ? 'Looking through your records…'
            : total === 1
              ? '1 payment.'
              : `${total} payments.`}
        </p>
      </header>

      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 bg-base/95 px-4 pb-3 pt-1 backdrop-blur-md">
        <Input
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Search a shop, a note, anything"
          aria-label="Search everything you have recorded"
          leadingIcon={<SearchIcon />}
          {...(typed ? { trailingIcon: <ClearButton onClear={() => setTyped('')} /> } : {})}
        />

        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          <Chip active={filterChips.length > 0} onClick={() => setFiltering(true)} leading={<FilterIcon />}>
            Filters
          </Chip>

          {filterChips.map((chip) => (
            <Chip
              key={chip.key}
              active
              onDismiss={() => setFilters(chip.remove(filters))}
            >
              {chip.label}
            </Chip>
          ))}

          {narrowed && (
            <Chip onClick={clearEverything}>Clear all</Chip>
          )}
        </div>
      </div>

      {entries.length === 0 && results.data !== undefined ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            {narrowed ? (
              <>
                <p className="text-lead text-ink">Nothing matches that</p>
                <p className="max-w-[38ch] text-caption text-ink-2">
                  No payments match your search. Try changing or clearing your filters.
                </p>
                <Button variant="secondary" onClick={clearEverything}>
                  Clear the filters
                </Button>
              </>
            ) : (
              <>
                <p className="text-lead text-ink">Nothing recorded yet</p>
                <p className="max-w-[38ch] text-caption text-ink-2">
                  No payments recorded yet. Tap the plus button to record one, or bring in a
                  statement from your bank.
                </p>
                <Button variant="secondary" onClick={() => navigate('triage')}>
                  Bring in a statement
                </Button>
              </>
            )}
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <List>
            {groups.map((group) => (
              <li key={group.label}>
                <ul>
                  <ListSectionHeader>{group.label}</ListSectionHeader>
                  {group.items.map((entry) => (
                    <Row
                      key={entry.id}
                      entry={entry}
                      accounts={byId}
                      locale={locale}
                      onOpen={() => setLooking(entry)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </List>
        </Card>
      )}

      {results.data?.hasMore && (
        <p className="pb-2 text-center text-caption text-ink-3">
          Showing the {PAGE_SIZE} most recent. Narrow it down with a search or a filter to see
          further back.
        </p>
      )}

      <FilterSheet
        open={filtering}
        onClose={() => setFiltering(false)}
        value={filters}
        onChange={setFilters}
        accounts={accounts.data ?? []}
      />
      <PaymentDetailsSheet entry={looking} onClose={() => setLooking(null)} />
    </div>
  );
}

function Row({
  entry,
  accounts,
  locale,
  onOpen,
}: {
  entry: EntryWithPostings;
  accounts: Map<AccountId, LedgerAccount>;
  locale: string;
  onOpen: () => void;
}) {
  const shown = presentEntry(entry, accounts);

  const subtitle = [
    shown.isSplit && shown.categories.length > 1
      ? `Split across ${shown.categories.length} categories`
      : shown.categories[0]?.name,
    shown.accountName,
    describeDate(shown.date, locale),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListItem
      onClick={onOpen}
      muted={shown.isCorrection}
      leading={<ClearanceMark clearance={shown.clearance} />}
      title={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{shown.title}</span>
          {shown.note && <NoteIcon />}
          {shown.isSplit && shown.categories.length > 1 && <SplitIcon />}
        </span>
      }
      subtitle={subtitle}
      trailing={
        <Money
          value={shown.direction === 'out' ? minor(-shown.amount) : shown.amount}
          size="lead"
          tone={shown.direction === 'in' ? 'liquid' : shown.isCorrection ? 'muted' : 'neutral'}
          signDisplay={shown.direction === 'neutral' ? 'never' : 'auto'}
        />
      }
    />
  );
}

/**
 * How far through the bank a row has got, in a shape rather than a colour.
 *
 * Deliberately small and grey. This is reference information somebody looks
 * for when they are looking for it — a bright badge on every row would make
 * the whole list about clearance, which is not what the list is for.
 */
function ClearanceMark({ clearance }: { clearance: PresentedEntry['clearance'] }) {
  if (clearance === 'reconciled') {
    return (
      <span title="Checked against your statement and locked" className="flex text-ink-3">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-label="Locked" role="img">
          <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (clearance === 'pending') {
    return (
      <span
        aria-label="Has not gone through yet"
        role="img"
        title="Has not gone through your bank yet"
        className="h-2.5 w-2.5 rounded-full border border-line-strong"
      />
    );
  }

  return (
    <span title="Has gone through your bank" className="flex text-ink-4">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-label="Gone through" role="img">
        <path
          d="m5 13 4 4L19 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Has a note"
      role="img"
      className="shrink-0 text-ink-3"
    >
      <path
        d="M5 4h14v16l-4-3H5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Split across categories"
      role="img"
      className="shrink-0 text-ink-3"
    >
      <path
        d="M4 6h5l6 12h5M20 6h-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
