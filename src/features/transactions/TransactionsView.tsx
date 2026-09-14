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
import type { AccountId, EntryId, LedgerAccount } from '@/core/ledger';
import type { EntryWithPostings } from '@/data/repositories/ledgerRepo';
import type { EntrySearchParams } from '@/data/repositories/searchRepo';
import { useAccounts } from '@/app/ledger/useLedger';
import { useDebounced, useEntrySearch, useMonthGroups } from '@/app/ledger/useSearch';
import { presentEntry, type PresentedEntry } from '@/app/ledger/present';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { useSelection } from '@/app/selection';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { describeSelection, describeTagging, describeUntagging } from '@/core/taxonomy/tags';
import {
  TAG_TABLES,
  ensureTag,
  listTags,
  tagEntries,
  tagsForEntries,
  untagEntries,
  type TagRecord,
} from '@/data/repositories/tagsRepo';
import { toast } from '@/app/toast';
import { SelectionBar, Tick } from '@/features/shell/SelectionBar';
import { TagSheet } from './TagSheet';
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

/**
 * The empty list, once.
 *
 * `results.data?.entries ?? []` looks harmless and is not: a fresh array every
 * render gives every `useMemo` and `useCallback` keyed on it a new identity,
 * and a live query built from one of those re-subscribes on every render,
 * which sets state, which renders again. The page locks up — and it only does
 * so *after a write*, because that is when the query briefly has no data.
 */
const NOTHING: readonly EntryWithPostings[] = [];
/* Same reason as `NOTHING`. The tags map reaches a memo's dependencies,
 * and `?? new Map()` there is a new map every render. */
const NO_TAGS: ReadonlyMap<EntryId, TagRecord[]> = new Map();

export function TransactionsView() {
  const [, navigate] = useRoute();
  const locale = useAppConfig((s) => s.locale);
  const accounts = useAccounts();

  const [typed, setTyped] = useState('');
  const [filters, setFilters] = useState<EntrySearchParams>({});
  const [filtering, setFiltering] = useState(false);
  const [looking, setLooking] = useState<EntryWithPostings | null>(null);
  const [tagging, setTagging] = useState<'add' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useDebounced(typed);

  const params = useMemo<EntrySearchParams>(
    () => ({ ...filters, ...(query.trim() ? { query: query.trim() } : {}), limit: PAGE_SIZE }),
    [filters, query],
  );

  const results = useEntrySearch(params);
  const entries = results.data?.entries ?? NOTHING;
  const total = results.data?.total ?? 0;

  const byId = useMemo(
    () => new Map<AccountId, LedgerAccount>((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );

  const entryIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const selection = useSelection<EntryId>(entryIds);

  // Keyed on the ids themselves rather than the array holding them. Belt and
  // braces with `NOTHING` above: a query that re-subscribes on every render is
  // a loop, and this is the one query whose input is derived from a list.
  const entryIdKey = entryIds.join(' ');
  const tags = useLiveQuery(useCallback(() => listTags(), []), TAG_TABLES);
  const onEntries = useLiveQuery(
    useCallback(() => tagsForEntries(entryIdKey === '' ? [] : (entryIdKey.split(' ') as EntryId[])), [entryIdKey]),
    TAG_TABLES,
  );
  const tagsById = onEntries.data ?? NO_TAGS;

  // Only the tags actually present on what is chosen, so "take a tag off"
  // never offers something that would do nothing.
  const tagsOnChosen = useMemo(() => {
    const seen = new Map<string, TagRecord>();
    for (const id of selection.ids) {
      for (const tag of tagsById.get(id) ?? []) seen.set(tag.id, tag);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [selection.ids, tagsById]);

  const groups = useMonthGroups(entries, locale);
  const searching = query.trim().length > 0;
  const filterChips = describeFilters(filters, byId);
  // A tag on its own narrows the list too. Without it here, filtering to a tag
  // that matches nothing would say "nothing recorded yet" to somebody with
  // four months of records, and offer to import a statement.
  const narrowed = searching || filterChips.length > 0 || filters.tagId !== undefined;

  const clearEverything = useCallback(() => {
    setTyped('');
    setFilters({});
  }, []);

  /**
   * Put a tag on everything chosen, making it first if it is new.
   *
   * The count that comes back is what actually changed, not how many were
   * chosen. Saying "tagged 17" when three of them already had it would be a
   * number nobody could check and everybody would half-believe.
   */
  async function applyTag(name: string) {
    if (selection.count === 0) return;
    setBusy(true);
    try {
      // The stored name, not the one just typed: typing "italy 2026" into an
      // existing "Italy 2026" adds to it, and the confirmation should say so.
      const tag = await ensureTag(name);
      const changed = await tagEntries(selection.ids, tag.id);
      setTagging(null);
      selection.cancel();
      toast(describeTagging(changed, tag.name));
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'That could not be saved, so nothing has been tagged.',
        { tone: 'attention' },
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tag: TagRecord) {
    if (selection.count === 0) return;
    setBusy(true);
    try {
      const changed = await untagEntries(selection.ids, tag.id);
      setTagging(null);
      selection.cancel();
      toast(describeUntagging(changed, tag.name));
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'That could not be changed just now.',
        { tone: 'attention' },
      );
    } finally {
      setBusy(false);
    }
  }

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
        {entries.length > 1 && !selection.active && (
          <button
            type="button"
            onClick={() => selection.begin()}
            className="target self-start pt-1 text-caption text-liquid [@media(hover:hover)]:hover:text-liquid-bright"
          >
            Choose several at once
          </button>
        )}
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

        <div className="flex items-center gap-2 overflow-x-auto py-[6px] -my-[6px]">
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

          {(tags.data ?? []).slice(0, 8).map((tag) => (
            <Chip
              key={tag.id}
              active={filters.tagId === tag.id}
              onClick={() =>
                setFilters((previous) =>
                  previous.tagId === tag.id
                    ? withoutTag(previous)
                    : { ...previous, tagId: tag.id },
                )
              }
            >
              {tag.name}
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
                      tags={tagsById.get(entry.id) ?? []}
                      selecting={selection.active}
                      chosen={selection.has(entry.id)}
                      onOpen={() =>
                        selection.active ? selection.toggle(entry.id) : setLooking(entry)
                      }
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

      {selection.active && (
        <SelectionBar
          count={selection.count}
          summary={describeSelection(selection.count)}
          allChosen={selection.allChosen}
          onSelectAll={selection.selectAll}
          onCancel={selection.cancel}
          actions={[
            {
              label: 'Tag them',
              primary: true,
              disabled: busy,
              onAction: () => setTagging('add'),
            },
            {
              label: 'Take a tag off',
              disabled: busy || tagsOnChosen.length === 0,
              onAction: () => setTagging('remove'),
            },
          ]}
        />
      )}

      <TagSheet
        mode={tagging}
        count={selection.count}
        tags={tagging === 'remove' ? tagsOnChosen : (tags.data ?? [])}
        busy={busy}
        onApply={(name) => void applyTag(name)}
        onRemove={(tag) => void removeTag(tag)}
        onClose={() => setTagging(null)}
      />
    </div>
  );
}

/** Drop the tag filter without leaving an undefined key behind. */
function withoutTag(params: EntrySearchParams): EntrySearchParams {
  const { tagId: _dropped, ...rest } = params;
  return rest;
}

function Row({
  entry,
  accounts,
  locale,
  tags,
  selecting,
  chosen,
  onOpen,
}: {
  entry: EntryWithPostings;
  accounts: Map<AccountId, LedgerAccount>;
  locale: string;
  tags: TagRecord[];
  selecting: boolean;
  chosen: boolean;
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
      {...(selecting ? { selected: chosen } : {})}
      leading={selecting ? <Tick on={chosen} /> : <ClearanceMark clearance={shown.clearance} />}
      title={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{shown.title}</span>
          {shown.note && <NoteIcon />}
          {shown.isSplit && shown.categories.length > 1 && <SplitIcon />}
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="shrink-0 rounded-pill border border-line bg-raised px-1.5 py-0.5 text-micro text-ink-3"
            >
              {tag.name}
            </span>
          ))}
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
