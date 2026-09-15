# Sovereign

*Autonomous precision, sovereign wealth.*

A double-entry personal wealth platform that runs entirely on your device.
There is no server, no account to create, and no network request — not for
telemetry, not for fonts, not for exchange rates. The database is a SQLite file
in your browser's private storage, and you can export it whole and open it in
any tool that reads SQLite.

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, bundle, generate the service worker |
| `npm run typecheck` | `tsc --noEmit` under full strict |
| `npm test` | Vitest. The engines by property over generated sequences of entries; the copy per branch of every sentence an engine builds; the design system against its own rules — computed contrast, token existence, the motion budget, hit areas, hover gating, one field per screen, no prose in a component, no bare inputs; and a small rendering gate that mounts real screens to assert focus behaviour and that a screen prints the figure its engine returned |
| `npm run lint` | ESLint, including the import-layering rule |
| `npm run icons` | Regenerate `public/icons/*` and the favicon from the vector mark |

Hosting has one hard requirement: **`Cross-Origin-Embedder-Policy:
require-corp` and `Cross-Origin-Opener-Policy: same-origin`**, which are in
`public/_headers` (Cloudflare Pages, Netlify) and `vercel.json`. Without them
`crossOriginIsolated` is false and SQLite's OPFS backend has no fallback — the
app opens and cannot reach its own database.

Live at **https://sovereign-e5u.pages.dev**. [`DEPLOY.md`](DEPLOY.md) has the
deploy command, the checks that prove a deploy took, and the rollback route —
including the `pre-redesign` tag, a permanent bookmark on the app as it stood
before any of this work.

---

## What it does

Sixteen screens, all of them reading one ledger.

- **Today** — what is safe to spend, and why that figure and not the balance.
- **Envelopes** — money assigned to categories, with pacing against the month.
- **Ahead** — a ninety-day cash forecast, a calendar, where the money went,
  debt payoff, and what-if sketches, behind one segmented control; and, on its
  own, when you could stop working.
- **Invested** — holdings, lots, disposals with the tax consequence shown
  before you sell, fee drag against a tracker, and rebalancing.
- **What you're worth** — accounts, debts, property, net worth over time.
- **Pots** — sinking funds that work out what this month owes them.
- **Record** and **Review** — entry, import, splits, rules, and a triage queue.
- **Categories**, **Settings**, and a **field manual** of six chapters.

A seventeenth route, the primitive gallery, is development-only and is not part
of the app.

Nothing is a mock. Every figure on every screen is derived from journal entries
by an engine in `src/core`, which has no React, no DOM, and no I/O.

## The two books

Every transaction posts to two independent ledgers.

- **FINANCIAL** — where the money actually is. Assets, liabilities, income,
  expenses.
- **BUDGET** — what the money is *for*. Envelopes, assignments, cover.

Both must balance on every entry, and they can disagree in a way that is
informative rather than broken: paying a credit card moves cash in the
financial book and nothing in the budget book, because that money was assigned
when the card was used.

`assertBalanced` runs on the write path and refuses any entry whose lines do
not sum to zero in each book it touches. Above that sits an engine of ten
properties, **I1 to I10**, covering split agreement across both books, exact
cancellation of a reversal, cross-currency residuals and more. That engine is
deliberately *not* in the app bundle — it is the second opinion the property
tests hold the ledger to, over randomly generated sequences of entries. The
note at the foot of `src/core/ledger/index.ts` says why.

## Money

Every amount is an integer in minor units, carried as a branded `Minor` type.
No float touches a figure at any point, including formatting: an exact decimal
string is built from the integer and handed to `Intl`, so `amount / 100`
appears nowhere.

- Scaling goes through `mulDivRound` — exact integer arithmetic with a BigInt
  fallback past 2^53, which refuses to return a result it cannot represent.
- Splits go through `allocate`, which distributes remainder units by the
  largest-remainder method, so a 60/40 split of `10.01` is `6.01 / 4.00` and
  never loses a cent.

**No component names a currency.** Amounts reach the screen only through
`<Money>` or `useMoney`, which take the symbol, placement, grouping and
decimal precision from `Intl` via the configured locale — so `EUR → JPY`
correctly drops to zero decimals with no component involved. A test walks the
source tree and fails the build on a currency literal or a direct
`Intl.NumberFormat` outside `src/core/money/`.

The ledger itself is single-currency: one reporting currency, gated by
`assertLedgerCurrency`. Accounts may be *denominated* in another currency, and
a rate you record yourself converts them for a quiet second line — always
written as an estimate, because a rate somebody typed on some particular day is
not a balance.

## Architecture

```
core  ←  content  ←  data  ←  app  ←  design  ←  charts  ←  features
```

Imports point leftwards only, and ESLint enforces it.

| | |
| --- | --- |
| `src/core/**` | The engines. Ledger, budget, forecast, tax, investments, rules, goals. Pure, deterministic, no React. |
| `src/content/**` | The words. Explanations, and the arithmetic behind them written out in the person's own figures. It sits directly above `core` because it may name a `Minor` and nothing else. |
| `src/data/**` | SQLite WASM in a worker over OPFS, repositories, migrations, a live-query bus. |
| `src/app/**` | Hooks and selectors joining core to data. |
| `src/design/**` | Tokens and primitives. Knows nothing about finance. |
| `src/charts/**` | SVG, written out by hand. `d3-scale` for scales and `d3-shape` for path maths; no charting components. |
| `src/features/**` | Screens and sheets. |

Analytics, investments, accounts, budget, the field manual and the gallery each
stay out of the opening bundle. The ceiling is **185.5 kB gzipped** and first
paint currently walks the chunk graph to **150.2 kB**, so there is 35.3 kB of
headroom.

Both numbers want reading carefully. The ceiling is a decision rather than a
measurement — it is what a phone on a bad connection can fetch before somebody
gives up, and it is the reason there is no animation library, no charting
components and no date library here. And **nothing enforces it**: there is no
constant and no CI check, so the figure comes from walking `index.html`'s
static imports by hand. It has been exceeded twice, both times by a re-export
from an eagerly imported barrel, which is why `AppShell.tsx` carries comments
naming what may not be imported above a given line.

## Design

**Colour encodes category, never sentiment.** Six families — housing, food,
transport, obligation, leisure, health. Housing is the same hue in the donut, in
the envelope tile, in a transaction row's icon square and on the calendar. That
consistency is what lets colour be an index you can navigate by, and it is why
the explanatory prose can come out of the screens.

A category hue never means good or bad. There is no danger red: overspending is
a number that needs cover, not a siren.

One hot accent exists and appears **at most once on a screen**, on the single
thing that needs a decision — the square covering the worst overspent envelope,
the dot on anything needing you, and the confirm on the reset. Three places,
each the one decision on its screen. A second occurrence is a bug.

**The record button is not one of them**, though this file said it was for six
phases. It is emerald, `--color-liquid`, which means "this releases or confirms
capital". Recording something is not a decision the app is asking you to make;
it is the app's ordinary verb.

The distinction that makes a budget like that hold is between treatments that
may repeat and treatments that may not. A ring, a hatched band, a category hue
states a fact about one item, and every item may carry one — four envelopes
over budget get four completed rings, because suppressing the second would be
hiding a fact. A hot mark says *look here*, and saying it four times says it
nowhere.

Two themes, **Daylight** and **Midnight**, chosen or followed from the system.
Contrast is computed rather than eyeballed: `tokens.test.ts` asserts WCAG AA
for every ink-on-surface pair in both.

Three surfaces, deliberately unlike each other — a `field`, a `card` and a
`tile`. Radii are hierarchical: the bigger the object, the rounder it is,
because one radius on everything is what makes a screen read as a kit of
identical boxes.

The field carries the one figure its screen exists for, and the rule is
**exactly one per screen, or a reason written down** — which is not the same as
"never more than one". Read the weaker way, it sat on three routes of sixteen
while the other thirteen led with a card carrying their hero figure, which is
one surface doing two jobs. Eight routes have one; the other eight are on a
list, each with an argument rather than a label, because "no" is a real answer
to *is there one number this screen exists for* — a queue, a calendar, a list
of sketches and a book of prose have none. A test fails if a route is on
neither list, if an owner stops drawing one, or if one appears anywhere else.

Position is evidence. A field was added to the forecast pane over a note in the
file arguing against it, and measuring it found it 552px down the screen, below
the whole chart, where the other eight land between 70px and 179px. A field
below the fold is a card with a field's paint on it. It was removed.

### Explanations

No explanatory paragraph lives in a component. They live in
`src/content/explain/`, surface behind an information button, and each one
shows the sum in your own numbers rather than in the general case. A test fails
the build on prose found in `src/features`. The field manual is the single
exemption, because it is meant to be prose.

Where an engine builds a sentence, that sentence is tested per branch.
`describeFeeDrag` once said "−€174.44 *less* than the same money in a tracker"
to everybody whose funds were cheaper than the comparison. The figure was
correct to the cent; the word in front of it was not.

### Motion

No animation library. One was 40 kB gzipped of the opening bundle to do four
things `BottomSheet`, `SwipeRow`, `Tabs` and `Toasts` now do in hand-written
pointer physics, and better for being specific — a library has to guess what a
drag means, and these know.

At most one orchestrated moment per screen, and it belongs to the field: its
parts arrive in the order you read them, and the ring sweeps to its position.
No card, tile or row animates in. Every keyframe declares only a `from`, so
the resting state lives in the component and each animation ends exactly where
the screen would have been with motion switched off — which is also why none of
this needed the Web Animations API. `prefers-reduced-motion` disables all of
it, delays included.

The figures do not count up. It would be the one animation here that put a
number on screen that is not your money.

## Accessibility

- Every swipe action is also a real focusable button. A gesture alone is
  unreachable by keyboard and by switch control.
- 44×44 on every interactive target, with no exceptions — as a hit area, not a
  bigger glyph, so a 22px information button stays 22px and answers across 44.
  A class that says 44 is not a target that measures 44: expanding a hit area
  means overflowing a layout slot, and whatever comes next owns the overflow
  unless it is given a `z-index`. One information button had a 44×44 box, a
  class saying 44, and a hit area of 44×37, because the caption after it
  painted over the bottom seven pixels.

  Verified by an exhaustive per-pixel scan at an unscaled viewport, **not** by
  walking outwards from each control's centre. The walking probe reads 2–3px
  short under a scaled viewport, and it once reported 123 of 217 controls under
  44px — every value 41 or 42, including a button whose hit area is 44 by
  construction. A control that cannot be short reading short is a measurement
  of the ruler.
- `focus-visible` rings throughout; sheets trap focus and hand it back.
- `role="progressbar"` on pacing bars, live regions on counts that change.
- Text inputs never below 16px, or iOS zooms the viewport on focus.

## Wrappable, not wrapped

The app is a PWA and is built to stay wrappable with Capacitor or PWABuilder
without a rewrite. Same-origin everything, fonts bundled. No layout is sized in
viewport units — `100dvh` in an iOS home-screen app with a translucent status
bar comes back one status-bar inset short of the real web view, and `html`,
`body` and the shell are pinned with `position: fixed; inset: 0` instead. The
status bar style follows the theme in the same pre-paint script as
`theme-color`. Nothing depends on an API absent from WKWebView.

## Licence

Copyright © 2026 Pratik Parashar.

**GNU Affero General Public License v3.0 or later.** The full text is in
[`LICENSE`](LICENSE), byte-for-byte as the Free Software Foundation publishes
it.

The reasoning is specific to what this app claims. "No network request, ever"
is not a promise anybody can take on trust — it is a promise you verify by
reading the source, which means the licence has to permit reading, auditing,
forking and self-hosting. "All rights reserved" on a public repository permits
none of that, and it was the default rather than a decision.

**In one sentence: if you change this and give the result to anyone — as a
website, an app, or a binary — you have to offer them the changed source under
this same licence.** That is the whole obligation. Reading it, running it,
forking it, and changing it for your own use ask nothing of you at all.

Copyleft rather than MIT because the fork most likely to hurt somebody who
trusts this app is one that keeps the look and adds a server. The reach is
worth being straight about, though: the AGPL's distinguishing clause, §13, is
about software people interact with *over a network*, which an app with no
server barely engages. Someone wrapping this bundle in Capacitor and shipping
it to an app store is covered by ordinary GPL distribution — they are handing
out a copy, so they owe their users the source — and not by §13 at all. So the
AGPL here is really GPL-with-a-clause-held-in-reserve, against the hosted fork
rather than the wrapped one, and the wrapped one is the likelier of the two.

The alternative was plain GPL-3.0, which would cover the app-store case
identically and drop a clause that mostly does not apply. AGPL is kept because
the clause costs nothing while it is dormant and is the only thing that would
bite a hosted rewrite, which is the version of this that could do real harm.

As sole copyright holder I can relicense or dual-license this at any time, so
choosing the stricter of the two costs nothing that cannot be given back.
