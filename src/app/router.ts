/* ===========================================================================
 * ROUTING
 * ---------------------------------------------------------------------------
 * The app has five places you can be. That does not need a routing library —
 * it needs the back button to work, which the hash gives us for free.
 * ======================================================================== */

import { useCallback, useSyncExternalStore } from 'react';

export const ROUTES = [
  'home',
  'triage',
  'transactions',
  'accounts',
  'pots',
  'forecast',
  'calendar',
  'debt',
  'independence',
  'categories',
  'settings',
  'gallery',
] as const;
export type Route = (typeof ROUTES)[number];

const DEFAULT: Route = 'home';

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getSnapshot = () => window.location.hash;

export function useRoute(): [Route, (route: Route) => void] {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '');
  const navigate = useCallback((route: Route) => {
    window.location.hash = `/${route}`;
  }, []);
  return [parse(hash), navigate];
}
