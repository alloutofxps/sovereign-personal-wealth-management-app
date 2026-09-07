/* ===========================================================================
 * READING THE ADDRESS BAR
 * ---------------------------------------------------------------------------
 * Forty lines of routing, and the reason it is tested is the second segment.
 * `#/manual/pots` is a link somebody can keep, send, or bookmark, so what it
 * resolves to is a promise rather than an implementation detail — and the
 * failure mode of getting it wrong is landing on the wrong chapter without
 * anything appearing to be broken.
 * ======================================================================== */

import { describe, expect, it } from 'vitest';
import { ROUTES, parseHash } from './router';

describe('a hash with one segment', () => {
  it('reads a known route', () => {
    expect(parseHash('#/accounts')).toEqual({ route: 'accounts', detail: null });
  });

  it('takes an empty hash as home, which is where a fresh visit lands', () => {
    expect(parseHash('')).toEqual({ route: 'home', detail: null });
    expect(parseHash('#')).toEqual({ route: 'home', detail: null });
    expect(parseHash('#/')).toEqual({ route: 'home', detail: null });
  });

  it('sends anything it does not recognise home rather than showing nothing', () => {
    expect(parseHash('#/wherever').route).toBe('home');
    expect(parseHash('#/../etc').route).toBe('home');
  });

  it('recognises every route the app declares', () => {
    for (const route of ROUTES) {
      expect(parseHash(`#/${route}`).route).toBe(route);
    }
  });
});

describe('a hash with a detail', () => {
  it('keeps the route and hands back what is inside it', () => {
    expect(parseHash('#/manual/pots')).toEqual({ route: 'manual', detail: 'pots' });
  });

  it('treats a trailing slash as no detail at all', () => {
    expect(parseHash('#/manual/')).toEqual({ route: 'manual', detail: null });
  });

  it('ignores anything past the second segment', () => {
    // One segment is the whole contract. A third would be a routing library
    // arriving by the back door.
    expect(parseHash('#/manual/pots/extra')).toEqual({ route: 'manual', detail: 'pots' });
  });

  it('does not let a detail rescue an unknown route', () => {
    expect(parseHash('#/nonsense/pots')).toEqual({ route: 'home', detail: 'pots' });
  });
});
