/* ===========================================================================
 * useLiveQuery
 * ---------------------------------------------------------------------------
 * Run a query, keep the result, and re-run it whenever the tables it depends
 * on change. Components never hold ledger data in their own state, so what is
 * on screen is always a projection of the journal rather than a copy of it
 * that can drift.
 * ======================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from './bus';

export interface LiveQueryResult<T> {
  data: T | undefined;
  /** True until the first result arrives. Stays false on later re-runs. */
  loading: boolean;
  /** A message safe to show the user, or null. */
  error: string | null;
  /** Re-run by hand — after an action whose write we did not observe. */
  refresh: () => void;
}

/**
 * @param query   the read to run. Must be stable or wrapped in useCallback —
 *                the query re-runs whenever this identity changes, so an
 *                inline closure would re-run on every render.
 * @param tables  which tables this query reads; it re-runs when they change.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  tables: readonly string[],
): LiveQueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryRef = useRef(query);
  queryRef.current = query;

  const alive = useRef(true);
  /** Guards against an older, slower query overwriting a newer result. */
  const generation = useRef(0);

  const run = useCallback(() => {
    const mine = ++generation.current;
    queryRef.current().then(
      (result) => {
        if (!alive.current || mine !== generation.current) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!alive.current || mine !== generation.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'Something went wrong reading your data. Try again in a moment.',
        );
        setLoading(false);
      },
    );
  }, []);

  // `tables` is almost always a literal array, so depend on its contents
  // rather than its identity or every render would resubscribe.
  const tableKey = tables.join(',');

  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribe(tableKey.split(','), run);
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [tableKey, run]);

  /**
   * Re-run when the question changes, not only when the data does.
   *
   * This used to live in the subscription effect above, which depended only on
   * the table list — so a query whose *parameters* moved on kept returning the
   * answer to the previous question. Nothing caught it for five slices because
   * every caller until search had fixed parameters for its whole lifetime.
   */
  useEffect(() => {
    run();
  }, [query, run]);

  return { data, loading, error, refresh: run };
}
