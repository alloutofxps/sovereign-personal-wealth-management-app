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
| `npm test` | Vitest. The engines by property over generated entries, the copy per branch of every sentence it builds, and the design system against its own rules — contrast, token existence, the motion budget, hit areas, hover gating, no prose in a component |
| `npm run lint` | ESLint, including the import-layering rule |
| `npm run icons` | Regenerate `public/icons/*` and the favicon from the vector mark |

Hosting has one hard requirement: **`Cross-Origin-Embedder-Policy:
require-corp` and `Cross-Origin-Opener-Policy: same-origin`**, which are in
`public/_headers` (Cloudflare Pages, Netlify) and `vercel.json`. Without them
`crossOriginIsolated` is false and SQLite's OPFS backend has no fallback — the
app opens and cannot reach its own database.

---

## What it does

Twelve screens, all of them reading one ledger.

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
- **Settings** and a **field manual** of six chapters.

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
stay out of the opening bundle, which is held to **185.5 kB gzipped**. That
number is a decision rather than a measurement: it is what a phone on a bad
connection can fetch before somebody gives up, and it is the reason there is no
animation library, no charting components and no date library here — a scale
function and a path generator, and the rest is markup.

## Design

**Colour encodes category, never sentiment.** Six families — housing, food,
transport, obligation, leisure, health. Housing is the same hue in the donut, in
the envelope tile, in a transaction row's icon square and on the calendar. That
consistency is what lets colour be an index you can navigate by, and it is why
the explanatory prose can come out of the screens.

A category hue never means good or bad. There is no danger red: overspending is
a number that needs cover, not a siren. One hot accent exists and appears at
most twice on a screen — the record button, and the single mark on the one
thing that needs a decision.

Two themes, **Daylight** and **Midnight**, chosen or followed from the system.
Contrast is computed rather than eyeballed: `tokens.test.ts` asserts WCAG AA
for every ink-on-surface pair in both.

Three surfaces, deliberately unlike each other — a `field` (never more than
one on a screen, carrying the figure that screen exists for), a `card`, and a
`tile`. Radii are hierarchical: the bigger the object, the rounder it is,
because one radius on everything is what makes a screen read as a kit of
identical boxes.

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
  Measured by hit-testing outwards from each control's centre, because a class
  that says 44 is not a target that measures 44.
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

None yet. All rights reserved.
