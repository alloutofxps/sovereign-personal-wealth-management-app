/* ===========================================================================
 * ONE FIELD, OR A REASON
 * ---------------------------------------------------------------------------
 * A field is the one panel a screen is built around, and the brief says
 * exactly one per screen. That was honoured as "never more than one" and not
 * as "always one": before phase 4e it existed on three of sixteen routes, and
 * the other thirteen led with a `Card` carrying their hero figure — one
 * surface doing two jobs, which is the state phase 2 was commissioned to fix.
 *
 * The count was not the finding. The finding was that nothing was counting, so
 * this does. Every route is either in `FIELD_OWNER` or in `NO_FIELD` with a
 * reason written down, the two lists together are exactly the routes, and no
 * file outside `FIELD_OWNER` may render a field at all.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CANNOT SEE, AND WHAT MEASURED IT INSTEAD
 *
 * "Exactly one on the screen" is a runtime property and this is a source scan.
 * A file may hold two `<Field>`s in different branches — `SafeToSpendCard`
 * does, one for the figure and one for its loading skeleton, and only ever one
 * renders. So this asserts ownership rather than arithmetic, and the
 * arithmetic was measured in the browser with
 * `document.querySelectorAll('.field').length` on each of the sixteen routes:
 *
 *   eight routes   exactly 1
 *   eight routes   0, every one of them in NO_FIELD below
 *
 * Forecast was the ninth until phase 8 measured its field at 552px down the
 * screen and `ForecastView`'s own note turned out to have argued against it
 * from the start. It is in `NO_FIELD` now, with that argument as the reason.
 *
 * The nine, with the hue each one takes:
 *
 *   Today            housing     the app's spine
 *   What you're worth housing    the same money, totalled
 *   Envelopes        food        the `two-books` chapter's hue
 *   Pots             health      the `pots` chapter's hue
 *   Payoff           obligation  the `cards` chapter's hue, and the brief's
 *   Invested         transport   the brief's
 *   When you stop    transport   Invested's own future
 *   Where it went    none        every family at once; see `family="none"`
 * ======================================================================== */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTES, type Route } from '@/app/router';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/**
 * Which file owns each route's field.
 *
 * The route's own view is not always the owner — `home` renders `Dashboard`,
 * which renders `SafeToSpendCard`, and the five Ahead routes all render
 * `AheadView`, which picks a pane. So the map names the file that actually
 * draws the field rather than the file the router reaches first.
 */
const FIELD_OWNER: Partial<Record<Route, string>> = {
  home: join('features', 'dashboard', 'SafeToSpendCard.tsx'),
  accounts: join('features', 'accounts', 'AccountsView.tsx'),
  investments: join('features', 'investments', 'InvestmentsView.tsx'),
  budget: join('features', 'budget', 'BudgetGrid.tsx'),
  pots: join('features', 'goals', 'PotsView.tsx'),
  analytics: join('features', 'analytics', 'AnalyticsView.tsx'),
  debt: join('features', 'simulations', 'DebtPayoffView.tsx'),
  independence: join('features', 'simulations', 'IndependenceView.tsx'),
};

/**
 * The routes that lead with a headline and no field, and why.
 *
 * Each of these was asked the same question as the nine above — is there one
 * number this screen exists for? — and the answer was no. A field where the
 * answer is no is worse than none: it promotes one figure out of several
 * equals, or it puts a number above a screen whose subject is not a number.
 */
const NO_FIELD: Partial<Record<Route, string>> = {
  triage:
    'A queue. The screen exists for the stack of things waiting, and "three to go" is a ' +
    'property of that stack rather than a figure it qualifies. A field here would push the ' +
    'first row off the fold, which is the one thing the screen is for.',
  transactions:
    'The whole record. There is no one number — the subject is the list itself, and the ' +
    'top affordance is the search box.',
  forecast:
    'Two figures that matter and neither more than the other: where the balance lands, and ' +
    'how low it goes on the way. The note at the top of `ForecastView` made this argument ' +
    'before phase 4e put a field here anyway, and phase 8 measured the result at 552px down ' +
    'the screen — below the chart, which is what the pane is actually about.',
  calendar:
    'Two figures of the same kind, arriving and going out. The screen exists for *when* ' +
    'things land, not for how much, and promoting either one would claim one of two equals ' +
    'as the point. The pair is named rather than ranked, on purpose.',
  whatif:
    'A list of sketches. Each one has a difference figure and the screen has none until you ' +
    'open one, and a hero that appears and disappears is not a hero.',
  categories: 'Taxonomy. The subject is a structure, not a quantity.',
  settings: 'Settings. Nothing here is a figure the screen is built around.',
  manual:
    'Long-form reference, and the one place in the app that is meant to be prose. A field ' +
    'on a contents page would be a figure in a book.',
  gallery: 'Development only, and it renders every primitive including fields on purpose.',
};

function featureFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) featureFiles(full, found);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

/** `<Field ` as the surface, which since phase 4e is the only `Field` there is. */
const FIELD = /<Field[\s>]/g;

describe('every route either owns a field or says why it has none', () => {
  it('accounts for every route exactly once', () => {
    const owned = Object.keys(FIELD_OWNER);
    const exempt = Object.keys(NO_FIELD);
    const both = owned.filter((route) => exempt.includes(route));
    expect(both, 'a route cannot both own a field and be exempt from having one').toEqual([]);

    const missing = ROUTES.filter(
      (route) => !owned.includes(route) && !exempt.includes(route),
    );
    expect(
      missing,
      'a new route has to answer the question: one number it exists for, or a reason',
    ).toEqual([]);
  });

  it('gives every exemption a reason somebody has to read', () => {
    for (const [route, reason] of Object.entries(NO_FIELD)) {
      // Long enough to be an argument rather than a label. "N/A" is how an
      // exemption list stops being one.
      expect(reason.length, `${route}'s exemption is not a reason`).toBeGreaterThan(40);
    }
  });

  it('draws a field in every file that claims to own one', () => {
    for (const [route, file] of Object.entries(FIELD_OWNER)) {
      const source = readFileSync(join(SRC, file), 'utf8');
      const count = (source.match(FIELD) ?? []).length;
      expect(count, `${route}: ${file} owns a field and does not render one`).toBeGreaterThan(0);
    }
  });

  it('draws no field anywhere else', () => {
    const owners = new Set(Object.values(FIELD_OWNER));
    const stray: string[] = [];
    for (const full of featureFiles(join(SRC, 'features'))) {
      const relative = full.slice(SRC.length);
      if ([...owners].some((owner) => relative.endsWith(owner))) continue;
      // The gallery renders every primitive, which is what it is for.
      if (relative.includes(join('features', 'gallery'))) continue;
      const count = (readFileSync(full, 'utf8').match(FIELD) ?? []).length;
      if (count > 0) stray.push(`${relative}  ${count} field(s)`);
    }
    expect(
      stray,
      'a field outside the owner map is a second one on somebody’s screen',
    ).toEqual([]);
  });
});

describe('the surface and the form control no longer share a name', () => {
  /*
   * Eight components in six files were called `Field` — each a label above a
   * control, none of them the surface. Somebody reading `<Field label="How
   * often">` had every reason to think it was the panel from the kit, and the
   * guard above could not tell them apart either. They are `Labelled` now.
   */
  it('declares no local component called Field', () => {
    const offenders: string[] = [];
    for (const full of featureFiles(join(SRC, 'features'))) {
      const source = readFileSync(full, 'utf8');
      if (/(?:^|\n)\s*(?:export )?function Field\b/.test(source)) {
        offenders.push(full.slice(SRC.length));
      }
    }
    expect(offenders, '`Field` is the surface in src/design/ui — call it something else').toEqual(
      [],
    );
  });

  it('passes no `label` to the surface, which has no such prop', () => {
    const offenders: string[] = [];
    for (const full of featureFiles(join(SRC, 'features'))) {
      const source = readFileSync(full, 'utf8');
      // A field has no label slot on purpose: the moment it grows one it is
      // another card. A `<Field label=` is therefore a form control that got
      // missed in the rename.
      if (/<Field\s+label=/.test(source)) offenders.push(full.slice(SRC.length));
    }
    expect(offenders).toEqual([]);
  });
});
