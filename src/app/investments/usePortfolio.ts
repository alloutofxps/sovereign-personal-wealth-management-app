/* ===========================================================================
 * THE PORTFOLIO, ASSEMBLED
 * ---------------------------------------------------------------------------
 * One live query behind the whole investments screen. Everything it returns is
 * derived from the register and the latest prices, so recording a new price
 * recalculates the total, the allocation bar and the fee figure together —
 * there is no second copy of any of it to fall behind.
 * ======================================================================== */

import { useCallback } from 'react';
import {
  allocationOf,
  feeDragOf,
  totalsOf,
  type Allocation,
  type FeeDrag,
  type Holding,
  type PortfolioTotals,
} from '@/core/investments';
import type { AccountId, LedgerAccount } from '@/core/ledger';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import {
  INVESTMENT_TABLES,
  listInvestmentAccounts,
  listPortfolio,
  listSecurities,
  priceHistories,
} from '@/data/repositories/investmentsRepo';
import type { Minor } from '@/core/money';
import type { Security } from '@/core/investments';

export interface PortfolioData {
  holdings: Holding[];
  totals: PortfolioTotals;
  allocation: Allocation;
  feeDrag: FeeDrag;
  accounts: LedgerAccount[];
  securities: Security[];
  /**
   * Recent prices per security, oldest first, for the sparkline in each row.
   *
   * A security with fewer than two prices is absent rather than present and
   * short, so a row either draws a real line or draws nothing.
   */
  priceHistory: Map<string, Minor[]>;
  /** True when there are accounts that could hold securities but none do yet. */
  awaitingFirstHolding: boolean;
}

export function usePortfolio(accountId?: AccountId): LiveQueryResult<PortfolioData> {
  const query = useCallback(async (): Promise<PortfolioData> => {
    const [holdings, accounts, securities] = await Promise.all([
      listPortfolio(accountId),
      listInvestmentAccounts(),
      listSecurities(),
    ]);

    // Second round trip, not third: it needs the security ids the first one
    // returned. Twelve rows still cost one query between them.
    const priceHistory = await priceHistories(holdings.map((h) => h.security.id));

    return {
      holdings,
      priceHistory,
      totals: totalsOf(holdings),
      allocation: allocationOf(holdings),
      feeDrag: feeDragOf(holdings),
      accounts,
      securities,
      awaitingFirstHolding: accounts.length > 0 && holdings.length === 0,
    };
  }, [accountId]);

  return useLiveQuery(query, INVESTMENT_TABLES);
}
