/* ===========================================================================
 * THE PORTFOLIO, ASSEMBLED
 * ---------------------------------------------------------------------------
 * One live query behind the whole investments screen. Everything it returns is
 * derived from the register and the latest prices, so recording a new price
 * recalculates the total, the allocation bar and the fee figure together —
 * there is no second copy of any of it to fall behind.
 * ======================================================================== */

import { useCallback } from 'react';
import { currentValue } from '@/data/repositories/accountsRepo';
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
import { minor, type Minor } from '@/core/money';
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
  /**
   * Money in the investment accounts that is not in a holding.
   *
   * Invested used to show only what the holdings came to while Net worth showed
   * the accounts' full value, and the gap between the two was this, with
   * nothing on either screen reconciling them. Two figures for one thing and
   * no explanation is how somebody decides a screen is lying.
   */
  uninvestedCash: Minor;
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

    /*
     * What the accounts say, less what the register accounts for.
     *
     * Floored at zero for the same reason `reconcileTarget` floors it: a
     * negative residual is a question rather than a figure to print.
     */
    const accountValues = await Promise.all(accounts.map((a) => currentValue(a.id)));
    const accountsTotal = accountValues.reduce((sum, value) => sum + value, 0);
    const held = totalsOf(holdings).marketValue;

    return {
      holdings,
      priceHistory,
      uninvestedCash: minor(Math.max(0, accountsTotal - held)),
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
