/* ===========================================================================
 * THE INVALIDATION BUS
 * ---------------------------------------------------------------------------
 * SQLite has no change notifications of its own, so the worker tells us which
 * tables a write touched and this fans that out to whoever is watching.
 *
 * Deliberately coarse: a subscriber names the tables it depends on and re-runs
 * its query when any of them change. Finer-grained tracking would mean parsing
 * queries to work out what each one reads, which is a lot of machinery to save
 * a few milliseconds on a database this size.
 * ======================================================================== */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Watch a set of tables. Returns an unsubscribe function. */
export function subscribe(tables: readonly string[], listener: Listener): () => void {
  for (const table of tables) {
    let set = listeners.get(table);
    if (!set) {
      set = new Set();
      listeners.set(table, set);
    }
    set.add(listener);
  }

  return () => {
    for (const table of tables) listeners.get(table)?.delete(listener);
  };
}

/** Called by the client when the worker reports a write. */
export function invalidate(tables: readonly string[]): void {
  // Collect first, so a listener watching two changed tables still runs once.
  const due = new Set<Listener>();
  for (const table of tables) {
    const set = listeners.get(table);
    if (set) for (const listener of set) due.add(listener);
  }
  for (const listener of due) listener();
}

/** Test helper: drop every subscription. */
export function resetBus(): void {
  listeners.clear();
}
