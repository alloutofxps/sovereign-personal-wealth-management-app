# Sovereign — Design Brief

Durable spec. Lives at `design-refs/DESIGN-BRIEF.md`. Re-read it at the start of any
session that touches `src/design`, `src/features`, or `src/content`.

**This file is authoritative** wherever it and `tokens-daylight.css` differ.
Corrections found while building are folded back into it, marked **[amended]**,
so the spec never contradicts what shipped.

Companion files in the same folder:

| File | What it is |
| --- | --- |
| `design-refs/visual-direction.html` | Eight reference screens, real HTML + SVG. **The visual target.** Open it, read the markup, lift the geometry. |
| `design-refs/tokens-daylight.css` | The light palette and the surface hierarchy, written as a drop-in replacement for `src/design/tokens.css`. |
| `design-refs/ref-inspiration.jpg` | Colour, tile grid, tactile chrome. Take the *mechanics*, not the pastel. |
| `design-refs/ref-data.jpg` | Data-presentation mechanics: external donut labels, dashed counterfactual, pill period selectors. |

---

## 1. The problem being solved

The app is engineered well and looks generated. Three measurable causes:

1. **175 explanatory caption paragraphs** in `src/features`. Cards explain
   themselves in prose instead of showing themselves. No shipped finance app
   does this.
2. **67 tracked-out uppercase micro-labels** (`.eyebrow`, `text-micro uppercase
   tracking-[…]`). An ALL-CAPS label above every heading is the loudest
   generated-design tell there is.
3. **One `Card` component paints everything** — same radius, same shadow, same
   hairline, whether it holds net worth or two transactions. A screen built
   from identical containers has no hierarchy.

Plus: near-black ground with a single bright emerald accent, Geist + JetBrains
Mono, and a 44px hero figure. All defaults.

`src/core/**` is not the problem. Do not refactor it.

---

## 2. Palette

Colour encodes **category**, never sentiment. Housing is the same hue in the
donut, the envelope tile, the transaction row's icon square, and the calendar
dot. Colour becomes the index a person navigates by. That is what makes it
possible to delete the prose.

### Daylight (default)

See `design-refs/tokens-daylight.css` for the authoritative values. Summary:

| Role | Value |
| --- | --- |
| base | `#EDF0EA` pale celadon |
| sunken | `#E3E8DF` |
| surface / raised | `#FFFFFF` |
| line | `#DCE2D7` |
| ink / ink-2 / ink-3 | `#10130F` / `#5A6157` / `#63695F` **[amended]** |
| hot accent | `#FF3C1F` |

**[amended]** `ink-3` was `#8A9185`, which is **2.82:1** on base — not AA at any
size, despite a comment in the token file claiming it was AA at 12px and up. It
carries every row subtitle, chart axis and caption in the app. `#63695F` is
4.91:1.

Six category families, each `ink` + `wash`:

| Category | ink | wash |
| --- | --- | --- |
| housing | `#0C5A47` | `#B9E2D2` |
| food | `#89590B` **[amended]** | `#F7DCA8` |
| transport | `#2B3480` | `#C6CCF2` |
| obligation | `#943F29` **[amended]** | `#F4C6B6` |
| leisure | `#6B2A62` | `#E6C7E4` |
| health | `#1D4B55` | `#C3DEE3` |

**[amended]** Food ink on its own wash was 4.44:1 and obligation ink 4.13:1 —
both under the AA this section requires of exactly that pair. The new values
are 4.51:1 and 4.53:1, and are close enough to the originals to be
indistinguishable side by side.

### Midnight (dark)

Not obsidian. A deep indigo-navy ground, with a cool green carrying the
analytical work and a warm gold for selective emphasis. The point is that the
dark theme has a *hue*, so it reads as a considered surface rather than the
absence of light.

| Role | Value |
| --- | --- |
| base | `#0B0F22` |
| sunken | `#070A18` |
| surface | `#131936` |
| raised | `#1B2244` |
| overlay | `#232B52` |
| line / line-strong / line-faint | `#2B3358` / `#3A4370` / `#1E2544` |
| ink / ink-2 / ink-3 / ink-4 | `#ECEEF8` / `#A6ADCB` / `#7B84A6` / `#545C80` |
| hot accent | `#FF5A3C` (lifted from `#FF3C1F` to clear AA on indigo) |
| theme-color meta | `#0B0F22` |

Category families in Midnight — the pair inverts, `ink` becomes the light one:

| Category | ink | wash |
| --- | --- | --- |
| housing | `#4FD1A5` | `#0E3A30` |
| food | `#E8B75E` | `#37290F` |
| transport | `#93A0F5` | `#1C2350` |
| obligation | `#E39073` | `#3A1E17` |
| leisure | `#D79BD0` | `#341930` |
| health | `#7FC4D4` | `#10303A` |

Rim/hairline overlays invert by job, exactly as the current file already does:
`--hairline` is white-on-dark and black-on-light; `--rim-top` stays white in
both.

### Rules that hold in both themes

- The hot accent appears **at most twice per screen**: the record button, and
  the single dot marking the one thing needing a decision. Three occurrences is
  a bug.
- **[amended]** The hot accent is a fill and a marker, **never small text**.
  White on it is 3.55:1 and it is 3.08:1 on base: fine for a non-text mark,
  where WCAG wants 3:1, and not fine for type, where it wants 4.5:1. The
  reference sheet sets "See all" and "Change" as 12.5px hot text — those take
  `--color-ink` or the screen's category ink instead.
- Dark is no longer the default paint. The **Vault** screen is the one place
  darkness is used *within* Daylight, where it signals "private, at rest".
- Every category pair must clear **WCAG AA at 14px** for `ink` on `wash` and
  `ink` on `base`. Compute it, don't eyeball it. Write the computed ratios into
  `src/design/tokens.test.ts`.
  **[amended]** Done, and it found three failures — see the two tables above.
  `tokens.test.ts` now parses `tokens.css` itself and recomputes every pair on
  every run, so a later palette edit cannot quietly reintroduce one.
- **[amended]** `ink-4` is the one exception and is held to the non-text rule
  instead. It is the muted half of a paired bar and the fill of a dim track; it
  must never carry type, and the test asserts that rather than exempting it.

---

## 3. Typography

Two families, self-hosted.

```
npm i @fontsource-variable/fraunces @fontsource-variable/space-grotesk
```

**Self-hosting is mandatory, not a preference.** `vercel.json` sets
`Cross-Origin-Embedder-Policy: require-corp`. A Google Fonts `<link>` will be
blocked outright.

**[amended]** The registered family names carry a `Variable` suffix:
`'Fraunces Variable'` and `'Space Grotesk Variable'`. Naming them without it
falls through to the fallback stack silently.

**[amended]** Import `@fontsource-variable/fraunces/opsz.css`, not the package
root and not `full.css`. Production runs Fraunces at its default `SOFT` and
`WONK`, and those defaults are 0 and 0 — so neither axis has to be in the file
to reach the look. The `opsz` subset is 67,304 bytes on latin against 121,016
for `full`: **54kB saved for a pixel-identical result**. Verified in the
browser — setting `SOFT` or `WONK` on the shipped face changes no metric, while
`opsz` moves them by roughly 100px across its range at 64px, and
`font-optical-sizing: auto` is active. Import the fontsource CSS in `src/main.tsx` alongside the
existing imports, and remove `@fontsource-variable/geist` and
`@fontsource-variable/jetbrains-mono` once nothing references them.

### Fraunces — figures and screen titles only

Fraunces is right because its optical-size axis draws a €296,480 at 46px with
different contrast than a €76 at 19px, rather than the same outline scaled. It
is what makes a number feel like an amount of money.

**Dial it back.** The reference HTML runs it hot. Production settings:

```css
--font-display: 'Fraunces Variable', 'Iowan Old Style', Palatino, Georgia, serif;

.figure {
  font-family: var(--font-display);
  font-weight: 550;
  font-variation-settings: 'SOFT' 0, 'WONK' 0;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.025em;
}

.headline {
  font-family: var(--font-display);
  font-size: 1.625rem;   /* 26px, down from 31 */
  font-weight: 560;
  font-variation-settings: 'SOFT' 0, 'WONK' 0;
  letter-spacing: -0.015em;
}
```

`WONK 0` switches off the splayed `g` and the curled `f` — the two glyphs doing
most of the "magazine" work. `SOFT 0` sharpens the terminals. Weight drops from
600 to 550. **Delete the `.headline em` italic treatment entirely.** One italic
word in a headline is a cliché and it is the single most decorative thing in
the reference sheet.

Fallback if it still reads too editorial after review: swap to
`@fontsource-variable/newsreader` at the same weights. Newsreader has lower
stroke contrast and no wonk axis. This is a one-line change in the token file
and nothing else moves — build it so that stays true.

### Space Grotesk — everything operational

Labels, rows, buttons, list metadata, chart axes. Its digits are tabular and
its lowercase reads at 11px, which removes the reason the app was reaching for
a monospace on small labels. **Do not reintroduce a mono face for data
labels.**

**[amended]** That rule is about *labels*. `--font-mono` stays a real monospace,
pointed at the system stack (`ui-monospace, 'SF Mono', Menlo, Consolas,
monospace`), so no third font ships. Pointing it at Space Grotesk would have
broken four things that need character-cell alignment: the field manual's
`Formula` blocks (`whitespace-pre` arithmetic), the bulk-paste boxes in
`UpdatePricesSheet` and `FxRatesSheet`, and the BIP-39 recovery phrase. Ticker
chips move to Space Grotesk as intended.

### Scale

| Token | px | Use |
| --- | --- | --- |
| `--text-micro` | 11 | chart axes only |
| `--text-caption` | 12.5 | row metadata |
| `--text-body` | 14.5 | base reading size |
| `--text-lead` | 17 | row amounts |
| `--text-figure` | 26 | secondary figures |
| `--text-headline` | 26 | screen titles (Fraunces) |
| `--text-anchor` | 64 | the one hero figure per screen (Fraunces) |

The anchor was 44px. It has to actually be the hero.

---

## 4. Surfaces — three kinds, deliberately unlike each other

Replace the single `Card` with a hierarchy. Full CSS in
`design-refs/tokens-daylight.css`.

- **`.field`** — large, flat, category-coloured, no border, no shadow. Exactly
  one per screen, at the top, carrying the number that screen exists for.
- **`.card`** — white (or `surface` in Midnight), hairline, tight contact
  shadow. For lists and charts.
- **`.tile`** — category-coloured, small, no shadow, sits in a grid of
  siblings. Its colour is its category, never its status.

Radii are hierarchical: the bigger the object, the rounder it is. `--radius-sm`
0.5rem → `--radius-hero` 2.125rem. One radius on everything is what makes a
screen read as a kit.

Category binding is one class: `.cat-housing` sets `--tile-ink` and
`--tile-wash`, and a tile, a field, an icon square, a ring and a bar segment
all pick it up.

---

## 5. Explanations — the information-button system

The explanations are keepers. Their **placement** and their **register** are
the problems. Today they sit inline in the card and are written by someone who
already understands personal finance.

### Architecture

Create `src/content/explain/`. No explanatory prose may live in a component
after this change.

```ts
export type ExplainTopic =
  | 'safe-to-spend' | 'pace' | 'cushion' | 'envelopes' | 'cover'
  | 'net-worth' | 'two-books' | 'pots' | 'cards' | 'selling'
  | 'checking' | 'deferred-tax' | 'fee-drag' | 'rebalance'
  | 'runway' | 'recovery-phrase' | 'storage' | 'tax-regime' | 'cgt';

export interface Explanation {
  id: ExplainTopic;
  title: string;                       // sentence case, ≤ 4 words
  short: string;                       // ≤ 20 words. The whole answer.
  how: string[];                       // ≤ 3 sentences. Arithmetic spelled out.
  worked?: (ctx: ExplainContext) => string;  // the user's own live numbers
  manual?: ChapterSlug;                // deep link into the field manual
}
```

`<Explain topic="safe-to-spend" />` renders a 22px circular button (44×44 tap
target) beside the label it explains, and opens `ExplainSheet` — a
`--radius-sheet` bottom sheet, `.card` surface, using the existing sheet
presentation. Where a chapter exists, the sheet ends with a
`ManualLink` row.

`worked()` receives live dashboard context so the example uses the person's
actual figures. An explanation that says "€412 of bills" when their bills are
€412 is worth ten that say "your bills".

### Copy standard

- **Second person. Active voice. Present tense.** Reading age ~12.
- `short` answers the question on its own. If someone reads only that line,
  they are not confused.
- `how` spells out the arithmetic with real numbers and no named concepts.
- **Banned unless defined in the same sentence:** envelope, pacing, disposal,
  FIFO, cost basis, deferred tax, runway, book, posting, double-entry,
  reconcile, accrual, amortisation, drift, allocation, liquidity, position.
- No apologising, no hedging, no "simply", no "just".
- Never explain the interface ("tap here to see more"). Explain the money.

### Calibration — rewrite these three, then match the register everywhere

**Safe to spend**

> Current: "This is what is left after your bills, your card, and your safety
> cushion are taken care of."

```
title: Safe to spend
short: Money you can spend this month without breaking anything.
how:
  - We start with the cash sitting in your everyday accounts — €3,700.
  - Then we take out the bills due before you're next paid (€412), what you
    already owe on your card (€248), and the €900 you asked us to keep back.
  - What's left is €2,140. Spending it changes nothing you've already promised.
```

**The two books**

> Current: engine-voice about FINANCIAL and POSITION postings.

```
title: Why every payment is stored twice
short: Sovereign records where money went and what it was for, separately.
how:
  - One record says €42 left your Bunq account. The other says it was groceries.
  - The two have to add up to the same number.
  - That's how the app notices a mistake instead of quietly losing €42.
```

**Selling part of a holding**

> Current: FIFO / cost-basis / disposal language.

```
title: Which units you sold
short: When you sell part of a holding, we assume the oldest units went first.
how:
  - You bought 10 VWRL at €80, then 10 more at €100. You sell 12.
  - We count that as all ten of the €80 units and two of the €100 ones, so the
    gain is worked out against €1,000 of what you paid.
  - Most tax offices expect this order, which is why it's the default.
```

### Enforcement

Add `src/content/explain/noProseInFeatures.test.ts`: walk `src/features/**`,
fail on any string literal longer than 90 characters that is not a
`aria-label`, a toast, an error message, or an import path. This is the guard
that stops the prose creeping back in.

**[amended]** `src/features/manual/chapters/**` is exempt, with a comment in the
test saying why. Section 6 keeps the field manual as long-form prose on
purpose; it holds 64 strings over the threshold and is supposed to. Onboarding
is **not** exempt: its explanatory asides move into the registry like every
other screen's, and only the step copy stays.

---

## 6. The field manual

Keep it. Keep the six slugs exactly — `safe-to-spend`, `two-books`, `pots`,
`cards`, `selling`, `checking` — they are in the address bar and
`slugs.ts` correctly notes they are permanent.

- **Contents screen**: six chapter tiles, one per category hue, each with the
  chapter title, a one-line summary, and a reading time. No numbered markers
  unless the chapters are genuinely sequential; they are reference, so use the
  hue as the index instead.
- **Chapter pages**: `.headline` title, a running head that stays visible on
  scroll, body at `--text-body` with a **65-character measure**, and the
  working engine labs preserved and restyled as `.card` with a distinct
  `demo` treatment so a live calculation never reads as prose.
- Every `Explain` sheet whose topic maps to a chapter ends with a link into it.
  Every chapter opens with the same `short` line as its `Explain` entry, so the
  two never drift.
- Manual chapters stay lazily loaded. The barrel-leak note in `slugs.ts` is
  correct and must survive the redesign — verify in the audit that the opening
  bundle still does not pull the chapter list.

---

## 7. Settings

Same system as everything else. Currently it is a stack of identical cards with
engine-voice labels.

- Group into sections with `.section-title` in sentence case. **No eyebrows.**
- Rows use the shared row pattern with a category-tinted icon square.
- `<Explain>` buttons on: currency, tax regime, CGT rate and exemption, where
  data lives, storage persistence, recovery phrase, and reset.
- Theme control offers three states: **System / Daylight / Midnight**, as a
  segmented control showing a live swatch of each.
- Destructive actions (reset) are the only place the hot accent appears in
  settings, and only on the confirm step.
- Move the design-system gallery behind a dev-only flag. It should not be a
  user-facing destination.

---

## 8. PWA now, native later

The app must stay wrappable (Capacitor or PWABuilder) without a rewrite.

- **Same-origin everything.** `COEP: require-corp` is already set. No CDN, no
  external font, no external image. Self-host or inline.
- **No hover-dependent affordances.** Anything reachable only on `:hover` is
  unreachable on device.
- **44×44pt minimum** on every interactive target, including the 22px info
  buttons — pad the hit area, don't grow the glyph.
- **No `vh` / `dvh` for layout.** The `inset: 0` reasoning in the current
  tokens file is correct and hard-won; keep it. A wrapped web view has the same
  fault.
- **Status bar must switch with theme.** `index.html` currently pins
  `apple-mobile-web-app-status-bar-style` to `black-translucent`, which paints
  white status text over the light theme. Set `default` for Daylight and
  `black-translucent` for Midnight, alongside the existing `theme-color`
  update, in the same pre-paint script.
- **Icons**: regenerate with `npm run icons` for the new palette, and emit
  maskable and monochrome variants as well as the standard set.
- **No API absent from WKWebView.** Keep OPFS and the SQLite worker. Do not
  introduce Web Bluetooth, Web Share Target, or Background Sync as a
  dependency for any core flow.
- **[amended]** Motion is built on CSS transitions and the Web Animations API.
  The `motion` package was listed in `package.json` but imported nowhere:
  commit `ffc299e` removed every use of it, which took first paint from 184.92
  to 145.02 kB gzipped against a 185.50 kB budget. Re-adding it costs about
  40 kB and would land near 188 kB, over budget. It has now been removed from
  `package.json` entirely. `BottomSheet`, `SwipeRow`, `Tabs` and `Toasts`
  already do hand-written physics on pointer events and are better for being
  specific. **One orchestrated moment per screen** — the hero figure counting
  up on first paint, or the sheet presenting. Fade-and-slide on every card is
  the generated default. `prefers-reduced-motion` disables all of it.

---

## 9. Charts

`WIDTH = 320` is hard-coded in all four chart files, so on a 430pt device every
stroke renders ~34% fatter than designed. Fix with `vector-effect:
non-scaling-stroke` on every path plus a `ResizeObserver`-driven width where
the axis labels need real spacing.

Mechanics to build, per the reference HTML:

| Screen | Mechanic |
| --- | --- |
| Today | hero figure + days-to-payday ring; cumulative spend against a dashed even-spread line |
| Where it went | donut with values on **external tinted pills**, total plus one comparison in the centre, category rows repeating the hue |
| Net worth | solid actual against a **dashed counterfactual** (last year's savings rate), one scrubber dot, quarter pills. Never a forecast — the existing refusal to project forwards is correct and stays |
| Envelopes | pacing rings inside category tiles; over-budget gets a dot, not a red card |
| Ahead | day tick lines, a **hatched band** over the squeeze between a big bill and payday, dotted outflow curve |
| Invested | allocation as one stacked bar, not a second donut; sparklines inside the holding rows |
| Vault | one sparkline, deliberately unlabelled |
