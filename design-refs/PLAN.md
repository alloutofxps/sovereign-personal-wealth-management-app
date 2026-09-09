# Redesign plan — phases 1 to 8

Written after reading `DESIGN-BRIEF.md`, `visual-direction.html`,
`tokens-daylight.css`, both reference images, and the existing
`src/design`, `src/design/ui/*`, `src/features/**`, `src/charts/*`,
`src/app/theme.ts`, `src/app/router.ts` and `index.html`.

Phase 0 is done: `design-refs/INVENTORY.md` is committed on its own at `4a38f11`.
Phase 1 is done at the commit below. The seven decisions were approved as
recommended, and the corrections they produced have been folded back into
`DESIGN-BRIEF.md` and `tokens-daylight.css` — marked **[amended]** in the brief
— so nothing in `design-refs/` contradicts what shipped.

Every phase ends with `npm run typecheck && npm test -- --run && npm run lint`
green, a reported test count, and its own commit.

**Seven decisions need answering before Phase 1 starts. They are at the bottom.**

---

## Phase 1 — tokens and theme

**New**
- `src/design/theme/contrast.ts` — WCAG relative-luminance and ratio helpers, so
  the token test computes rather than hard-codes.

**Rewritten**
- `src/design/tokens.css` — Daylight from `tokens-daylight.css` as the base;
  Midnight from brief §2 added as `@media (prefers-color-scheme: dark)` plus
  `:root[data-theme='midnight']`, mirroring the existing two-block pattern.
  Carried across unchanged: the `inset: 0` viewport lock and its comment, touch
  sanitation, `.scroll-y`, `.no-bar`, `.tnum`, the focus ring, `::selection`,
  the reduced-motion block, `.glass` and its minifier comment, `.press` /
  `.press-row`, `.privacy-veil`.
- `src/app/theme.ts` — three choices become `system | daylight | midnight`.
  Storage key `sovereign.theme` is unchanged; the stored values change, so a
  migration maps the old `light` → `daylight` and `dark` → `midnight` rather
  than silently resetting anyone.
- `index.html` — pre-paint script also switches
  `apple-mobile-web-app-status-bar-style` (`default` / `black-translucent`),
  and `<meta name="color-scheme">` becomes `light dark`.
- `src/main.tsx` — font imports swapped.

**Extended**
- `src/design/tokens.test.ts` — computed AA for every ink-on-wash and
  ink-on-base pair in both themes at 14px; the existing light/dark palette
  guards updated to the new theme names; the viewport-lock guards kept as they
  are.

**Dependencies** — add `@fontsource-variable/fraunces`,
`@fontsource-variable/space-grotesk`; remove `@fontsource-variable/geist` and
`@fontsource-variable/jetbrains-mono` once nothing imports them.

Commit: `design: daylight and midnight token systems`

---

## Phase 2 — surface hierarchy and primitives

**New**
- `src/design/ui/Field.tsx` — the one-per-screen hero panel.
- `src/design/ui/Tile.tsx` — the category-coloured grid child.
- `src/design/ui/Row.tsx` — the shared row: category-tinted icon square, name,
  metadata, right-aligned amount. Appears on six of the eight reference screens.
- `src/design/ui/CategoryIcon.tsx` — the tinted square, used by `Row` and alone.
- `src/design/category.ts` — the mapping from a taxonomy group to one of the six
  families, in `src/design` so both charts and features can read it.

**Rewritten**
- `src/design/ui/Card.tsx` — `.card` only; the `label` prop stops emitting
  `.eyebrow` and starts emitting `.section-title`, or nothing where the label is
  redundant.
- `src/design/ui/List.tsx` — `ListSectionHeader` loses its uppercase tracking.
- `src/design/ui/Money.tsx` — `.figure` (Fraunces) at figure/anchor sizes,
  Space Grotesk below; `--text-anchor` is now 64px.
- `src/design/ui/Button.tsx`, `Tabs.tsx`, `Chip.tsx`, `Input.tsx`, `Select.tsx`,
  `Numpad.tsx`, `SwipeRow.tsx`, `StatPill.tsx` — new radii, new type, category
  binding where they carry one. `Input`/`Select` labels lose uppercase.
- `src/design/ui/index.ts` — new exports.

**Touched** — the 44 files carrying an inline `uppercase` utility (68
occurrences). Each one is judged individually: restyle, or delete where the
content beneath already says it.

Commit: `design: three-surface hierarchy, category binding, row primitive`

---

## Phase 3 — the explanation system

**New**
- `src/content/explain/types.ts` — `ExplainTopic`, `Explanation`, `ExplainContext`.
- `src/content/explain/registry.ts` — all 19 topics.
- `src/content/explain/index.ts` — a lookup that does not drag the registry into
  first paint.
- `src/design/ui/Explain.tsx` — 22px glyph, 44×44 tap target.
- `src/features/explain/ExplainSheet.tsx` — the sheet, ending in a `ManualLink`
  where a chapter exists.
- `src/content/explain/noProseInFeatures.test.ts` — the guard.
- `src/content/explain/registry.test.ts` — every topic reachable, every
  `manual` slug real, `short` within 20 words, banned vocabulary absent.

**Touched** — roughly 55 feature files lose their inline explanatory
paragraphs. The prose is rewritten into the registry, not moved.

Deliverable: a table of every explanation — topic, old text, new `short` — in
the commit body and in chat.

Commit: `content: plain-language explanations behind information buttons`

---

## Phase 4 — screens

Four screen groups, then a fifth pass that is not a screen group.

Commit per group, not one giant commit. Each commit body names the reference
screen followed and the category family assigned.

1. `design: today, where it went, net worth` — `Dashboard`, `SafeToSpendCard`,
   `PaceCard`, `BalanceCard`, `TriageBar`, `GettingStarted`, `AnalyticsView`,
   `AccountsView`, `NetWorthHistoryCard`.
2. `design: envelopes, ahead, invested` — `BudgetGrid`, `BudgetSettingsCard`,
   `QuickAssignSheet`, `QuickCoverSheet`, `ForecastView`, `RunwayCard`,
   `CalendarView`, `DayDetailSheet`, `SubscriptionAudit`, `InvestmentsView`,
   `HoldingsList`, `AssetAllocationBar`, `FeeDragCard`, `DeferredTaxCard`.
3. `design: record and the vault` — `AddPaymentSheet`, `SplitEditor`,
   `CategoryPicker`, `PaymentDetailsSheet`, `AccountDetailSheet` and the ten
   account sheets.
4. `design: the screens the reference does not cover` — `TransactionsView`,
   `FilterSheet`, `TagSheet`, `TriageView`, `ImportSheet`, `PotsView`,
   `PotSheet`, `DebtPayoffView`, `WhatIfView`, `IndependenceView`,
   `CategoryManagerView`, `ReconcileAccountSheet`, the seven investment sheets,
   `FirstFlightWizard` + `steps.tsx` + `parts.tsx`, `LockGate`, `SelectionBar`,
   `UpdateBanner`, `Toasts`, `BottomNav`, `AppShell`.

5. `design: the label review` — a separate final pass, after every screen is
   finished. Re-asks the deletion question on all 63 labels restyled in phase
   2, now that each one can be seen in a whole screen rather than in a diff.
   The bar is **does this label earn its place**, not "is it a literal
   duplicate": a heading that names what the list beneath it obviously is
   should go. This also empties the `STILL_INLINE` debt list, for the same
   reason — a paragraph is easier to judge in a finished screen.

Every item is ticked off against `INVENTORY.md` in the commit body.

---

## Phase 5 — charts

**Rewritten** — `CumulativeSpend`, `ForecastBand`, `GrowthBand`,
`NetWorthTimeline`, `SankeyFlow`, `CategoryBars`.

**New** — `src/charts/useChartWidth.ts` (a `ResizeObserver` hook) and
`src/charts/geometry.ts` (donut `stroke-dasharray` maths and ring arcs, lifted
from the reference SVG).

Fixes the hard-coded `WIDTH = 320` in four files and adds
`vector-effect="non-scaling-stroke"` to every path. Keeps: no forward
projection on net worth, no unreached milestones, zero stays on the scale.

Commit: `charts: responsive geometry and new presentation mechanics`

---

## Phase 6 — field manual and settings

**Touched** — `ManualView` (contents as category-hued tiles with reading times;
running head; 65-character measure), `manual/parts.tsx` (labs restyled so a live
calculation never reads as prose), the six chapters (each opening with its
`Explain` `short` line), `SettingsView`, `DataAndSecurity`, `ProtectStorage`,
`RecoveryPhrase`, `FxRatesSheet`.

`chapters/slugs.ts` is not touched. The audit verifies the opening bundle still
does not pull the chapter list.

Settings gains `<Explain>` on currency, tax regime, CGT, storage, recovery
phrase and reset; a three-state theme control with live swatches; the hot accent
only on the destructive confirm; and the gallery behind a dev flag
(`import.meta.env.DEV`), removed from the user-facing menu but with `#/gallery`
still routable.

Commit: `design: field manual and settings`

---

## Phase 7 — motion, PWA and native-readiness

**Touched** — `tokens.css` (`will-change` only under `[data-presenting]`),
`BottomSheet.tsx` (set `data-presenting` a frame before the recede, drop the
dock's `backdrop-filter` for the duration of the transform), `BottomNav.tsx`,
one orchestrated moment per screen, `scripts/generate-icons.mjs` (new palette,
maskable and monochrome variants), `README.md` rewritten.

Commits: `perf: compositor and blur fixes`, then `docs: rewrite README`

---

## Phase 8 — the audit

`design-refs/AUDIT.md` with a finding table (ID, severity 1–4, file, what is
wrong, why it matters, proposed fix), covering all eleven areas in the brief.
Feature parity is reported as a pass/fail table against every line of
`INVENTORY.md`, not as a summary.

Playwright captures every route at 390×844 in both themes into
`design-refs/screenshots/` if it installs; if it does not, the audit says so
rather than describing screenshots that were not taken.

Then severity 1 and 2 are fixed and the audit re-run. Severity 3 and 4 are
listed as a backlog and not fixed silently.

Commits: `docs: post-redesign audit`, then `fix: audit severity 1–2`

---

# Decisions taken during the work

The section below is the questions asked before any of this was built. This one
is the choices made while building it — the ones that outlive the commit that
made them, and that a reader will not find by reading the code alone.

A decision belongs here when the code can only carry *what* was chosen and not
*what else was on the table*. The file gets the reasoning; this gets the fact
that a choice existed at all.

## The drift tile names the class that is behind, never the one that is ahead

Phase 4b. `core/investments/rebalance.ts` computes two routes back to a chosen
mix and recommends neither — but it *orders* them, and says so in its own
header: the next deposit into whatever is furthest behind costs nothing, and
selling the side that grew realises a gain with a tax bill on it.

The first version of the tile picked the line with the largest absolute drift.
On an all-equity portfolio against a 60/30/10 target that is Shares at forty
points over, and the sentence closing an overweight gap is a sale — so a tile
added by a redesign put a taxable disposal on screen as the recommended next
action of a screen whose engine refuses to recommend one.

Selecting on `driftBp < 0` always finds a line when the mix is off, because
shares of one portfolio sum to 100. What it yields is a buy.

The reasoning is in `InvestmentsView.tsx` at the selector. **If this is ever
rewritten to rank by magnitude again, that is the bug.**

## `src/core` may be corrected for a false sentence, never refactored for a look

Phase 4c, approved. The brief puts `src/core/**` out of scope, and it should
stay that way for anything visual. `describeFeeDrag` was telling everybody whose
funds were cheaper than the comparison that their charges added up to "−€174.44
*less*" than a tracker — the figure correct to the cent, the word in front of it
wrong, and 879 tests green over it.

The line: a two-line fix to a sentence that is false is a correction, and comes
with a test per branch written to fail against the old wording first. Anything
that changes how an engine computes, or moves code for a visual change, is the
refactor the brief forbids.

## The debt gate was miscounting, twice, and both fixes lowered the number

Phase 4c, approved. Recorded because the count is a gate and its history has to
be legible: 89 at the end of 4b became 70 on the same commit once the gate was
right.

- Five entries were Tailwind class lists. A multi-line `clsx(` puts its opener a
  line above its arguments, and the exemption only looked at the string's own
  line.
- Fourteen were whitespace. The JSX arm matched 90 characters of raw inner text,
  indentation included, while the string arm measured 90 characters of copy — so
  the same sentence counted or did not depending on how deeply nested it was.

The second is the one that mattered beyond the count: a gate satisfiable by
reflowing JSX and failable by indenting deeper is not measuring prose. Both arms
now judge the trimmed sentence. `noProseInFeatures.test.ts` carries a do-not-
delete note at the check, because it looks like a duplicate of the regex above
it and is not.

---

# Decisions I need from you

## 1. `motion` would put the bundle over budget — I recommend not using it

Phase 7 says "motion uses the `motion` package already in `package.json`". It is
in `package.json` but **imported nowhere**: commit `ffc299e` removed every use
of it on purpose. A sourcemap breakdown at the time put motion-dom +
framer-motion + motion-utils at ~512 kB of source in the eager chunk, second
only to react-dom, and removing it took first paint from **184.92 → 145.02 kB**
gzipped.

First paint today is **147.69 kB** against a **185.50 kB** budget. Re-adding
motion costs roughly 40 kB and lands at ~188 kB — over.

`BottomSheet`, `SwipeRow`, `Tabs` and `Toasts` already do hand-written physics
on CSS transitions and pointer events, and they are better for being specific.
"One orchestrated moment per screen" is comfortably reachable with CSS plus the
Web Animations API at zero bundle cost.

**Recommendation:** build the motion with CSS + WAAPI and delete `motion` from
`package.json`. Say the word and I will use the library instead, and we accept
the budget going to ~188 kB.

## 2. Daylight fails its own AA requirement in three places

The brief says to compute contrast rather than eyeball it. I computed it, and
`tokens-daylight.css` does not pass:

| Pair | Now | Verdict | Proposed |
| --- | --- | --- | --- |
| `--color-ink-3` on base | **2.82:1** | fails at any size | `#63695F` → 4.91:1 |
| food ink on food wash | **4.44:1** | just under AA | `#89590B` → 4.51:1 |
| obligation ink on obligation wash | **4.13:1** | under AA | `#943F29` → 4.53:1 |

`ink-3` is the significant one — it carries row metadata, chart axes and every
caption, and the comment in the token file claiming it is "AA on `--color-base`
at 12px+" is simply not true. The proposed value keeps the green-grey character
and is a real darkening you will see. The other two are near-imperceptible.

Midnight passes everywhere except `ink-4` (2.91:1), which is a muted bar fill
and never carries type — I will assert that in the test rather than change it.

**Recommendation:** take all three fixes. Confirm you are happy with a visibly
darker `ink-3`.

## 3. The hot accent cannot carry small text

`#FF3C1F` gives 3.55:1 for white-on-hot and 3.08:1 for hot-on-base. As a fill
and a dot that is fine — WCAG's non-text rule wants 3:1 and it clears. But the
reference sheet sets "See all" and "Change" as 12.5px hot text on white, which
fails AA for type.

**Recommendation:** keep `#FF3C1F`, and set those inline links in `--color-ink`
or the screen's category ink instead. Alternative is darkening hot to `#D92B0E`
(4.88:1 white-on-hot), which costs the accent much of its heat.

## 4. The prose guard would fail the field manual

§5 specifies a guard that fails on any string over 90 characters in
`src/features/**`. §6 keeps the field manual, which is long-form prose by
design — it holds 64 such strings and is supposed to.

**Recommendation:** exempt `src/features/manual/chapters/**` explicitly, with a
comment saying why. `onboarding/steps.tsx` is the other awkward case: it is a
guided narrative, and I plan to move its explanatory asides into the registry
while leaving the step copy in place. Tell me if you would rather onboarding be
fully exempt too.

## 5. Mapping `--font-mono` to Space Grotesk breaks four things

The token file points `--font-mono` at Space Grotesk. "No mono for data labels"
is right, and ticker chips should move. But four places genuinely need
character-cell alignment:

- the manual's `Formula` block — `whitespace-pre` ASCII arithmetic
- the bulk paste boxes in `UpdatePricesSheet` and `FxRatesSheet` (`symbol,price`)
- the BIP-39 recovery phrase

**Recommendation:** keep `--font-mono` as a real monospace but point it at the
**system stack** (`ui-monospace, SF Mono, Menlo, monospace`) rather than
shipping JetBrains Mono — that honours the rule for labels, keeps the formulas
aligned, and drops a font from the bundle. Ticker chips move to Space Grotesk.

## 6. Two of the supplied files contradict each other on Fraunces

`tokens-daylight.css` has `--text-headline: 31px`, `.figure` at weight 600 with
`'SOFT' 20`, `.headline` with `'SOFT' 20, 'WONK' 1`, and a `.headline em` rule.
Brief §3 says production is 26px, weight 550/560, `'SOFT' 0, 'WONK' 0`, and to
delete `.headline em` entirely.

**I am taking the brief** — it is explicitly the dial-back and the later
decision. Flagging it so the token file is not later read as authoritative.
Same for the family name: `'Fraunces Variable'` (fontsource) rather than
`'Fraunces'`.

## 7. The dock does not need to move

The token file's comment says promoting only while presenting "lets the dock go
back to being fixed to the viewport". Since `#app-shell` stays
`position: fixed; inset: 0`, the shell's rectangle and the viewport are already
the same, so nothing has to move and the dock can keep receding with the screen
— which is the iOS behaviour and what the reference shows.

One caution I will handle: toggling `will-change` on the same frame the
transform starts defeats it, so `data-presenting` gets set a frame early.

**Recommendation:** keep the dock inside the shell. No change beyond the
`will-change` scoping.
