/* ===========================================================================
 * SEARCHING, AS YOU TYPE
 * ---------------------------------------------------------------------------
 * The query is debounced but the text field is not: what you typed appears
 * instantly and the database is asked a beat later. Binding the input straight
 * to the query would put a round trip between a keystroke and the letter
 * showing up, which is the difference between a search box that feels
 * immediate and one that feels broken.
 * ======================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import {
  SEARCH_TABLES,
  searchEntries,
  type EntrySearchParams,
  type PaginatedEntries,
} from '@/data/repositories/searchRepo';

const DEBOUNCE_MS = 180;

/** Hold a value back until the typing stops. */
export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/**
 * Run a search, and re-run it whenever the ledger changes underneath.
 *
 * The filters are serialised into the dependency key rather than passed as an
 * object, because a fresh object every render would restart the query on every
 * render and the results would never settle.
 */
export function useEntrySearch(params: EntrySearchParams): LiveQueryResult<PaginatedEntries> {
  const key = JSON.stringify(params);

  const run = useCallback(
    () => searchEntries(JSON.parse(key) as EntrySearchParams),
    [key],
  );

  return useLiveQuery(run, SEARCH_TABLES);
}

/** True when any filter beyond plain text is applied. */
export function hasActiveFilters(params: EntrySearchParams): boolean {
  return Boolean(
    params.accountIds?.length ||
      params.categoryIds?.length ||
      params.dateRange ||
      params.amountRange?.min !== undefined ||
      params.amountRange?.max !== undefined ||
      params.hasNotes,
  );
}

/** Group entries under the month they fall in, newest first. */
export function useMonthGroups<T extends { date: string }>(
  items: readonly T[],
  locale: string,
): { label: string; items: T[] }[] {
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const groups: { label: string; items: T[] }[] = [];

    for (const item of items) {
      const [year, month, day] = item.date.split('-').map(Number);
      const label = formatter.format(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1));
      const last = groups.at(-1);
      if (last && last.label === label) last.items.push(item);
      else groups.push({ label, items: [item] });
    }

    return groups;
  }, [items, locale]);
}
