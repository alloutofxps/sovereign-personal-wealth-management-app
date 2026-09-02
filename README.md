# Sovereign

*Autonomous precision, sovereign wealth.*

A local-first, double-entry personal wealth platform. Phase 2 of 5 is complete:
the project scaffold, PWA shell, calm dark design system, and the shared UI
primitives. The ledger engine lands in Phase 3.

```bash
npm install
npm run icons     # generate the PWA icon set (once, or after changing the mark)
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, bundle, generate the service worker |
| `npm run typecheck` | `tsc --noEmit` under full strict |
| `npm test` | Vitest, including the currency abstraction guard |
| `npm run icons` | Regenerate `public/icons/*` from the vector mark |

The app currently renders the **design system gallery** — every primitive in the
states it will be used in, so the visual language can be reviewed before
features are built on it.

---

## Currency policy

**v1 is single-currency. There is no FX engine, no rate table, and no
per-account denomination.** Every amount in the ledger is denominated in the
configured base currency.

Three rules make changing that base a one-line change, and all three are
enforced rather than documented:

1. **One source of truth.** The base currency lives in
   [`src/app/config/store.ts`](src/app/config/store.ts) as `currencyCode`,
   defaulting to `EUR`. Nothing else declares a currency.
   `assertLedgerCurrency()` in that file is the single gate every ledger write
   passes through — the one place that will learn to convert if multi-currency
   ever arrives.

2. **One formatter.** [`src/core/money/format.ts`](src/core/money/format.ts) is
   the only module that turns an amount into text. Components call it through
   [`useMoney()`](src/app/money/useMoney.ts) or render
   [`<Money>`](src/design/ui/Money.tsx). Symbol, placement, grouping,
   separators and decimal precision all come from `Intl` — so `EUR → JPY`
   correctly drops to zero decimals, and `en-GB → de-DE` correctly moves the
   symbol to the end, with no component involved.

3. **No hardcoded symbols.** Enforced by a test, not a convention. The suite in
   `format.test.ts` walks the source tree and fails the build if any file
   outside `src/core/money/` contains a currency literal or reaches for
   `Intl.NumberFormat` directly. It carries its own self-test, so the guard is
   known to fire.

### Precision

Amounts are **integer minor units** (`Minor`, a branded `number`) — never
floats. Scaling goes through `mulDivRound`, which is exact integer arithmetic
with a BigInt fallback past 2^53 and refuses to return a result it cannot
represent. Splits go through `allocate`, which distributes remainder units by
the largest-remainder method so a 60/40 split of `10.01` is `6.01 / 4.00` and
never loses a cent.

Formatting builds an exact decimal *string* from the integer and hands that to
`Intl` — `amount / 100` appears nowhere, so no float touches a displayed figure
at any magnitude.

---

## Layout

```
src/
  core/money/      Minor arithmetic, ICU currency metadata, the formatter,
                   keypad accumulation. Pure, no React, no DOM.
  app/config/      Base currency, locale, cadence. Zustand + persist.
  app/money/       useMoney() — binds config to the formatter.
  design/          tokens.css and the UI primitives.
  features/        Vertical slices. Phase 2 ships only the gallery.
```

Dependencies run one way — `features → app → core` — and `core/` imports
nothing from the app, so the arithmetic is testable in Node with no browser.

Phase 3 adds `core/ledger/`, `core/budget/` and `core/liquidity/`; Phase 4
adds `data/` (SQLite WASM in a worker) and the feature slices.

## Design system

A calm dark surface. Four obsidian elevations, zinc hairlines, **emerald** for
available capital, **amber** for anything needing a decision, and **warm clay**
for negative figures.

There is deliberately no danger red. Overspending is a number that needs cover,
not a siren — punitive deficit framing is what drives the avoidance behaviour
the research identifies as the primary cause of churn.

### Primitives

`Money` · `Card` · `StatPill` · `Button` · `BottomSheet` · `Numpad` /
`AmountInput` · `SwipeRow`

Two are worth reading before use:

- **`Numpad`** — money is never entered through `<input type="number">`,
  because the OS keyboard resizes the visual viewport and shifts the layout
  mid-tap. Entry is point-of-sale style: digits accumulate from the right, so
  the value is a valid `Minor` after every keystroke with no parse step.
  Keystrokes apply against a ref, not the `value` prop, so a burst of fast taps
  cannot collapse into a single digit.

- **`SwipeRow`** — both swipe actions are also real buttons, visually hidden
  until focused. A gesture alone is unreachable by keyboard and switch control.

## PWA

`index.html` sets `viewport-fit=cover` (exposing `env(safe-area-inset-*)`) and
`interactive-widget=resizes-content`. Fonts are bundled, not fetched from a
CDN — a local-first ledger must render offline and must not announce itself to
a third party on load.

Phase 5 replaces the generated service worker with a hand-written one and adds
WebAuthn unlock, storage-persistence guards and the app-switcher privacy veil
(the `.privacy-veil` utility and `--nav-height` token are already in
`tokens.css` waiting for it).
