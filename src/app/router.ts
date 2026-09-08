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
  'budget',
  'accounts',
  'investments',
  'pots',
  'forecast',
  'calendar',
  'analytics',
  'debt',
  'whatif',
  'independence',
  'categories',
  'settings',
  'gallery',
  'manual',
] as const;
export type Route = (typeof ROUTES)[number];

/**
 * The five panes behind the Ahead toggle.
 *
 * They are one screen with a segmented control, not five destinations, and
 * three separate places used to decide that for themselves: the shell decided
 * which routes render `AheadView`, the dock decided which routes light up the
 * Ahead tab, and `AheadView` decided which pane it was showing. 'analytics'
 * was in two of those three lists, so tapping "Where it went" rendered the
 * pane bare — no toggle, while the dock still said Ahead — and the only way
 * back to the strip was to tap Ahead again.
 *
 * One list, read by all three, so they cannot disagree again.
 */
export const AHEAD_ROUTES = [
  'forecast',
  'calendar',
  'analytics',
  'debt',
  'whatif',
] as const satisfies readonly Route[];

export type AheadRoute = (typeof AHEAD_ROUTES)[number];

export function isAheadRoute(route: Route): route is AheadRoute {
  return (AHEAD_ROUTES as readonly Route[]).includes(route);
}

const DEFAULT: Route = 'home';

/**
 * A hash is a route and, optionally, one thing inside it: `#/manual/pots`.
 *
 * The second segment exists because the Field Manual has to be linkable
 * chapter by chapter — "why is this held back?" on the pots screen has to open
 * the chapter about pots, not the contents page. It is deliberately one
 * segment and no query string: anything more would be a routing library
 * pretending to be forty lines of code.
 */
export function parseHash(hash: string): { route: Route; detail: string | null } {
  const [name = '', detail] = hash.replace(/^#\/?/, '').split('/');
  return {
    route: (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT,
    detail: detail === undefined || detail === '' ? null : detail,
  };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getSnapshot = () => window.location.hash;

export function useRoute(): [Route, (route: Route, detail?: string) => void] {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '');
  const navigate = useCallback((route: Route, detail?: string) => {
    window.location.hash = detail === undefined ? `/${route}` : `/${route}/${detail}`;
  }, []);
  return [parseHash(hash).route, navigate];
}

/**
 * The thing inside the current route, where there is one.
 *
 * Read by the view rather than passed down from the shell, so a route that has
 * no detail — which is all of them but one — carries no extra prop.
 */
export function useRouteDetail(): string | null {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '');
  return parseHash(hash).detail;
}
