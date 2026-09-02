/* ===========================================================================
 * LEDGER HOOKS
 * ---------------------------------------------------------------------------
 * The React side of the ledger. Each hook is a live query: it reads from
 * SQLite and re-reads whenever the tables it depends on change, so a new entry
 * shows up everywhere at once without anything having to remember to refresh.
 * ======================================================================== */

import { useCallback } from 'react';
import type { Minor } from '@/core/money';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import {
  LEDGER_TABLES,
  accountBalances,
  listAccounts,
  listRecentEntries,
  spendableCash,
  type AccountBalance,
  type EntryWithPostings,
} from '@/data/repositories/ledgerRepo';

export function useAccounts(): LiveQueryResult<LedgerAccount[]> {
  return useLiveQuery(useCallback(() => listAccounts(), []), ['accounts']);
}

export function useBalances(): LiveQueryResult<Map<AccountId, AccountBalance>> {
  return useLiveQuery(useCallback(() => accountBalances(), []), LEDGER_TABLES);
}

export function useRecentEntries(limit = 50): LiveQueryResult<EntryWithPostings[]> {
  return useLiveQuery(useCallback(() => listRecentEntries(limit), [limit]), LEDGER_TABLES);
}

export function useSpendableCash(): LiveQueryResult<Minor> {
  return useLiveQuery(useCallback(() => spendableCash(), []), LEDGER_TABLES);
}
