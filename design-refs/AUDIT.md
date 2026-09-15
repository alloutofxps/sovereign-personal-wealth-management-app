# Audit

Findings against the shipped app. Phase 8 is the full sweep; this file exists
from phase 4d because a severity 1 was found before it, and burying a severity 1
in a phase report is how it stays buried.

Severity is about what it costs the person using the app, not about how hard it
was to find or to fix.

| | |
| --- | --- |
| **1** | Somebody cannot use a feature at all, or is shown something false about their money |
| **2** | Somebody is likely to misread, or the app is materially harder to use than it should be |
| **3** | Wrong against the design system, visible but not misleading |
| **4** | Worth doing, not worth blocking on |

---

## G1 — what each gate structurally cannot see

Written before the audit, so that it decides where the audit looks.

Five defects in this project passed **every** gate, every time, for between one
and six phases. None of them was subtle once found. What they have in common is
that each sat in a class of defect no gate is shaped to detect, so the number of
gates and the number of tests were both irrelevant to it.

### The gates, and the hole in each

**`tsc --noEmit`, full strict.** Sees the shape of values. Cannot see a value
that is the right *type* and the wrong *thing*: a stale `width`, a swapped pair
of same-typed arguments, a `Minor` in the wrong currency, a date string for the
wrong day. Every one of the five is type-correct.

**The 840 engine and unit tests** (`core/**`, `ingest`, `data/schema`,
`data/worker`, `data/live`, `app/dates`, `app/router`, the explanation
registry). Pure functions over inputs the test constructs. Two holes, and they
are the big ones:

- *They never run the screen.* **No test in this repository mounts a React
  component.** Established rather than assumed: no test file imports
  `@testing-library/*`, `react-dom`, `renderToString`, `renderHook` or a DOM
  shim, and `vitest.config.ts` sets `environment: 'node'`, so there is no
  `document` for one to use if it tried. Every property of a rendering — hook
  order, effect cleanup, closure freshness, focus, event handling, what is
  actually on screen — is therefore outside the suite by construction, not by
  omission.
- *They test the engine, not the wiring.* An engine can be perfect and the
  screen can call it with the wrong argument. There is no test anywhere that
  asserts a figure a screen displays equals what its engine returns for the
  same input.

**The 87 design-system tests** (`tokens`, `targets`, `motion`, `fields`,
`primitives`, `toneNotOverridden`, `noBareInputs`, `category`). Eight of the
ten files that call `readFileSync` are here: they are **scans over source
text**. They can see that a class name is written; they cannot see what the
browser resolves it to. Cascade outcome, computed colour, real geometry, paint
order, hit area, stacking — all invisible. `tokens.test.ts` is the exception
that proves the shape: it computes contrast from the token *values*, which is
why it catches colour pairs and nothing about where those colours land.

**`noProseInFeatures`.** A source scan with a length threshold. Sees paragraph
shapes. Cannot see whether a sentence is *true*, which is the entire failure of
`describeFeeDrag`.

**ESLint.** Layering (`import/no-restricted-paths`) is real and enforced.
`rules-of-hooks` reads the call graph and is the one gate that sees execution
order at all. `exhaustive-deps` is a **warning**, which means a real defect can
sit in the output of a green gate indefinitely — and did, for eleven commits.
Nothing here sees semantics.

**`npm run build`.** Sees module resolution and bundle size. Cannot see anything
outside the module graph — the web manifest, `public/_headers`, `vercel.json`,
the icons, `index.html`'s meta tags, `CLAUDE.md`. Two defects have lived there.

### The five, each against the hole it went through

| | The defect | Why every gate was blind to it |
| --- | --- | --- |
| 1 | `NetWorthTimeline` and `SellHoldingSheet` called a hook below an early return | Hook *position* is not a type and not a value. Only executing the component across two different data shapes reveals it, and nothing executes a component. `rules-of-hooks` found both in one run the day it was installed. |
| 2 | `ForecastBand`'s scrubber converted pointer positions against a width of 320 that was no longer the viewBox | The engine was correct and separately tested. The defect was in a closure's *freshness*, which requires two renders to observe. `exhaustive-deps` did flag it — as a warning nobody had to act on. |
| 3 | The compositor layer was released 263ms before the transform it was promoted for | No gate observes **time**. The promotion and the release are both correct in isolation and wrong in sequence. Found only by watching attribute mutations during a real interaction. |
| 4 | Twenty-five text fields had no accessible name | The accessibility tree is a property of the *rendered* output. A source scan can check a proxy — "no bare `<input>`" — and cannot check the property. |
| 5 | `describeFeeDrag` told anybody with cheap funds they were doing badly | 879 tests passed. The tests asserted the amount **appeared in** the string. Presence is not meaning, and a test that checks presence is green for every wording. |

### Four more this project has since produced, same analysis

| | The defect | The hole |
| --- | --- | --- |
| 6 | `Explain` had a 44×44 box and a 44×37 hit area, the bottom 7px painted over by the next sibling | Computed geometry and paint order. The class said 44 and `getBoundingClientRect` said 44; only hit-testing outwards from the centre disagreed. |
| 7 | A field existed on three of sixteen routes | A property of the app *as a whole*. Every individual screen was internally consistent, so no per-file check could see it. Counting sixteen numbers could. |
| 8 | Eight components in six files were called `Field`, none of them the surface | Names that collide across files. Each file compiles, each is locally sensible. |
| 9 | Both home-screen shortcuts opened the dashboard, because nothing reads `location.search` | Outside the module graph. The manifest is data the build copies, and no gate reads it against the app's behaviour. |
| 10 | `CLAUDE.md` said invariants I1–I10 run on every write; they run in tests only | Nothing tests the documentation, and the code's own comment had contradicted it in writing for six phases. |

### The ten classes, which are where this audit looks

1. **Rendered output** — anything only true once a component is on screen.
2. **Execution over time** — hook order, effect ordering, cleanup, async races.
3. **Closure freshness** — a captured value that is type-correct and stale.
4. **Engine-to-screen wiring** — right engine, wrong argument.
5. **Meaning of generated sentences** — per branch, in both directions.
6. **Computed geometry and cascade** — what the browser resolves, not what was written.
7. **The accessibility tree** — accessible names, focus order, reachability.
8. **Whole-app properties** — consistency across routes, not within one.
9. **Everything outside the module graph** — manifest, headers, icons, meta, docs.
10. **Failure paths** — storage eviction, worker failure, half-applied migration.
    Nothing in the suite exercises any of them; `schema.test.ts` runs the DDL
    and the migrations against real SQLite, which is the one real gate the data
    layer has, and it tests the happy application of each migration rather than
    a failure in the middle of one.

**A consequence worth stating plainly.** An app with 981 passing tests, a clean
typecheck and a clean lint has established that its arithmetic is right and its
class names are spelled correctly. It has established almost nothing about what
a person sees or can do. That asymmetry is what this audit is measuring against,
and it is why the largest pass below is driving the app rather than reading it.

---

## Phase 8 — findings

Every row carries how it was established. "Read the code" is not in this
column anywhere; where something could not be established in this environment
it says so and says why.

### Severity 1

| ID | Area | File | What is wrong | How it was established | Why it matters | Proposed fix |
| --- | --- | --- | --- | --- | --- | --- |
| **P1** | a11y / first run | `features/onboarding/FirstFlightWizard.tsx` | The first-run overlay is `role="dialog" aria-modal="true"` with **no accessible name**, focus is **never moved into it**, and there is **no focus trap**. The first three tabbable elements in the document are all *behind* it. | DOM probe on a fresh database. `[...d.attributes]` returned exactly `class`, `role`, `aria-modal` — no `aria-label`, no `aria-labelledby`. `document.activeElement` was `BODY`, `d.contains(document.activeElement)` false. Enumerating visible tabbables in document order gave `Add a bill`, `Add a payment`, `Home` — all outside the dialog. | This is the first screen anyone sees. A screen reader announces an unnamed dialog; a keyboard user's first Tab lands on controls hidden behind an opaque `fixed inset-0` overlay that has declared the rest of the page inert. The app is unusable without a pointer at the point of first contact. | Give it a name from its own heading, move focus in on mount, and trap Tab — `BottomSheet` already does all three and is the reference. |
| **P2** | a11y / every sheet | `design/ui/BottomSheet.tsx:235-284` | The focus effect does nothing on a **cold open**. It reads `sheetRef.current`, which is null on the render where `open` first becomes true because the portal is not mounted until `present` flips one render later — and its dependency array is `[open]`, so it never re-runs once the portal exists. Neither the focus move **nor the Tab trap** is installed. | Measured, three sheets, each opened cold then re-opened 120ms later (inside `EXIT_MS`, so `present` is still true): Quick assign `false → true`, Saving-up Explain `false → true`, and on `Filters` focus stayed on the trigger *behind the backdrop* after a Tab. The dependency array is `}, [open]);` at line 284. | `aria-modal="true"` tells assistive technology the rest of the page is inert; with no trap the browser still moves focus there. This is the exact defect the comment above the effect says it exists to prevent, absent on the only path that normally runs. | Depend on `[open, present]`, or key the effect on the portal's existence. |
| **P3** | correctness | `features/simulations/IndependenceView.tsx` + `core/simulate/fire.ts` | On an empty ledger the screen reads **"Enough to stop, living as you do now — You are there"**, with "What it takes €0" and "Of the way there 0%". With nothing invested and nothing spent, the app tells you you are financially independent. | Measured on a fresh database: the `#/independence` field's text was `Enough to stop, living as you do now You are there What it takes € 0 Of the way there 0% 25 times a year`. Cause: `targetFor(annualSpending=0, rate)` returns 0, and `reached` is `invested >= target`, so `0 >= 0`. | It is a false statement about the person's money, on the screen whose whole subject is that statement, in the state every new user starts in. Pre-existing in the milestone list; phase 4e promoted it to the hero and made it the largest thing on the screen. | A fourth branch: with no spending recorded there is no target, so the milestone is unknown rather than reached. |

### Severity 2

| ID | Area | File | What is wrong | How it was established | Why it matters | Proposed fix |
| --- | --- | --- | --- | --- | --- | --- |
| **P4** | a11y | `features/settings/DataAndSecurity.tsx`, `features/triage/ImportSheet.tsx` | Two `<input type="file" class="sr-only">` with **no accessible name** — no `aria-label`, no `id`+`label[for]`, not wrapped in a `<label>`. | Accessible-name sweep across all sixteen routes and inside eleven sheets, computing the name the way AT does (aria-label → aria-labelledby → label[for] → wrapping label → title; text content names a button, not a control). Exactly two controls came back unnamed, both `input[file].sr-only`. | `sr-only` means visually hidden and **exposed to AT** — the one case where a name is mandatory. A screen-reader user tabbing through Settings or the import flow reaches an unnamed file-upload control. Same class as A1, and it survived A1's fix because `noBareInputs.test.ts` **exempts** `type="file"`. | `aria-label` on both, and extend the guard: an exempt control still needs a name. |
| **P5** | a11y | `design/ui/BottomSheet.tsx` | No sheet has a **focusable close control**. Dismissal is the drag handle (a `div` with pointer handlers, no role and no name), a backdrop tap, or Escape. | Probed eleven sheets across seven routes; none contained a button matching close/cancel/done/back/dismiss. Escape closed all eleven (`escapeClosed: true` × 11). | `CLAUDE.md`'s own rule is that every swipe action also exists as a real focusable button, because a swipe is unreachable by keyboard and by switch control. The sheet's dismiss gesture is exactly that, and Escape is not available to switch control. | A named close button in the sheet header, or a focusable role/name on the drag handle. |
| **P6** | correctness / wiring | `features/settings/DataAndSecurity.tsx:46`, `features/settings/SettingsView.tsx:101` | The `storage` explanation's worked example reads `figures.storageUsedBytes`. Two of its three call sites pass no such figure, so the same explanation shows "Your records take about 4.8 MB on this device" from one button and omits it from the other two. | Opened all four Explain buttons on `#/settings` and compared bodies: one contained the MB sentence, two did not. Then a static cross-check of all 28 topics against every `useExplain({...})` in the same file — exactly these two call sites starve a worked example; the other 26 topics are wired correctly. | This is the engine-to-screen wiring blind spot: the explanation is correct and the screen does not give it what it needs. A person gets a worse answer for pressing the nearer of two identical buttons. | Pass `storageUsedBytes` at both sites, or move the `storage` Explain to the one component that has the figure. |
| **P7** | storage | `features/shell/AppShell.tsx:240` | The top-of-app storage warning is gated on `!storage.durable`, which means "SQLite fell back to an in-memory VFS". It **never checks `storage.persisted`**, which is the field that says the browser has not promised to keep the data. | `navigator.storage.persisted()` returned `false` on this machine and `[role=status]` was empty on every route. `openDatabase` in `data/client.ts:105` computes `persisted` correctly on the main thread, and `SettingsView:233` and `ProtectStorage:61` both read it — so the value is right and the most prominent warning ignores it. Not theoretical: **the seeded database was destroyed between two sessions today**, with no warning at any point, and the commissioner's own note records it happening twice before. | Eviction is the failure a real user is most likely to hit, and the only places that mention it are Settings and the after-import card. Somebody who never imports and never opens Settings is never told their financial history is evictable. | Widen the bar to `!durable \|\| !persisted` with wording per case, or surface `ProtectStorage` on first run. |
| **P8** | copy | `core/budget/multiMonth.ts:222` | `describeReadyToAssign` has three branches — surplus, deficit, exactly nought — and no branch for "there is nothing here yet". On a fresh database the Envelopes field reads **"€0.00 left to give a job / Every unit of your money has a purpose. This is the goal."** | Measured on a fresh database: that is the literal text of the `#/budget` field with zero income, zero envelopes and zero assignments. | It congratulates somebody on an achievement they have not had the chance to attempt. Same shape as `describeFeeDrag`: a sentence whose branches do not cover the data, arithmetically correct and wrong to read. | A fourth branch for an untouched budget, with a test per branch as the copy standard requires. |

| **P15** ✅ | design system | `features/forecast/RunwayCard.tsx`, `features/forecast/ForecastView.tsx:9` | The forecast pane's field sits **552px down the screen**, below the whole chart, and its own screen's source records a decision *against* having a field at all. | Measured the distance from the top of the scroll container to the field on all nine routes that have one: eight land between 70px and 179px — below the heading and nothing else. Forecast is **552px**, the last block on the page. `ForecastView.tsx:9` says, in writing: *"There is no field and no hero figure here on purpose. A forecast has two numbers that matter and neither is more important than the other… Promoting one of them to a 48pt anchor would be picking a winner the arithmetic does not pick."* | `CLAUDE.md` says a field is "exactly one per screen, **at the top**, carrying the number that screen exists for". This one is neither at the top nor the number the screen exists for — the chart is. **I introduced this in phase 4e and overrode a reasoned decision recorded in the file I was changing, without reading it.** Per the standing rule on the brief and the code disagreeing, it is flagged rather than resolved. | Two options, and it is the commissioner's call. **(a)** Take the field off the forecast pane: the screen keeps its two co-equal figures and `RunwayCard` goes back to being a card, restoring the recorded decision and leaving eight fields. **(b)** Keep it and move it above the chart, which asserts the runway is the pane's subject and needs the note in `ForecastView` rewritten to say why. I recommend (a) — the note's argument is sound, and it was written by somebody looking at this screen. **Resolved: (a).** The field is off the forecast pane and `RunwayCard` is a card again. The split into two surfaces stays, because that half was right — the runway figure and the switch list were one card, and a hero and a list are not the same kind of object. Eight routes own a field now; forecast is in `NO_FIELD` with the note's own argument as its reason. |

### Severity 3 — all four resolved or withdrawn

| ID | Area | What is wrong | How it was established |
| --- | --- | --- | --- |
| **P9** ✅ | design system | Three `storage` Explain buttons render on `#/settings`, under two different labels ("where your data lives" ×2, "keeping your records"). | Opened every Explain on the route; four sheets, three of them the same topic. **Resolved: one door.** `SettingsView`'s went with P6 (it had no access to the figure). `ProtectStorage`'s goes now, and `DataAndSecurity`'s stays — because `ProtectStorage` only renders while persistence has *not* been granted, so keeping its button instead would have made the explanation unreachable the moment the browser said yes. Its now-unused `useExplain` and `usedBytes` state went with it. |
| **P10** ❌ **withdrawn — not a defect** | interlinking | *Claimed:* `cards` and `two-books` are the only two manual chapters with no in-context link. | The finding came from extracting every literal `chapter="…"` prop and diffing against `CHAPTERS`. **That instrument could not see the dynamic case.** `ExplainSheet.tsx:85` renders `<ManualLink chapter={showing.manual}>Read the whole story</ManualLink>` for every topic that names a chapter, and the registry gives `cards` → `cards` and `two-books` → `two-books`. Both are reachable in context, one step deeper: through the explanation that introduces them — `cards` from `SettleUpSheet` and onboarding, `two-books` from `PaymentDetailsSheet`. Withdrawn rather than "fixed" with links the app did not need. A grep is an instrument; see M2. |
| **P11** ◐ **part done, part larger than it looked** | interlinking | Accounts has no Explain at all, though `net-worth` is its whole subject and the topic is surfaced from Home. `#/analytics` and `#/debt` have none either. | Enumerated `aria-label^="More about"` per route: accounts 0, analytics 0, debt 0. **Accounts resolved:** a `net-worth` Explain sits in the field, wired with the three figures its worked example reads — `totalAssets`, `totalDebts`, `netWorth`, all of which that screen already computes. The static cross-check of all 28 topics against their call sites now reports **0 starved worked examples**. **Analytics and Payoff are not resolved and should not be forced:** none of the 28 existing topics is about where money went or about paying debt down, so both need a *new* explanation written — title, short line, three `how` steps and a `worked()` built from live figures, in the copy standard's register, with a test per branch. That is a copy task, not an interlinking one, and it is flagged rather than absorbed. |
| **P12** ✅ | a11y contrast | A disabled button's label computes to **2.60:1** in Daylight (`opacity-40` on `text-ink` over `bg-raised`) and 3.35:1 in Midnight. WCAG 1.4.3 exempts inactive controls, so this is not a violation — but it is a pair `tokens.test.ts` does not assert, and 2.60 is hard to read. | Composited `ink × 0.4 + raised × 0.6` from the live token values in both themes and computed the ratio. **Resolved:** the colour is unchanged and the exemption is now in writing. `tokens.test.ts` composites four disabled pairs in both themes — `Button` at 40% on raised, surface and base, and `Chip` at 50% — asserts each is between 2:1 and AA, and asserts the 40% and 50% treatments stay distinguishable. It was exempt because nobody had asked; it is exempt by decision now, and a change to the opacity or an ink token fails the test. |
| **P13** ✅ | a11y | The three Quick-assign options explain *why* they are unavailable in a `<span>` that is not associated with the disabled button (`aria-describedby`). | Read the rendered sheet: `Option` renders title, detail and `Button disabled`, with no association. **Resolved:** every button there says "Do this" and nothing else; the title and the reason now carry ids and the button an `aria-describedby` naming both, so the announcement is never just "Do this, dimmed". |

### Severity 4 — backlog

| ID | What is wrong | How it was established |
| --- | --- | --- |
| **P14** ✅ | `CLAUDE.md` says `--color-hot` marks "the record button, and the single dot". The record button is **emerald** (`rgb(79,209,165)` = `--color-liquid`), which is coherent with `Button`'s own note that emerald means "releases or confirms capital". The doc names a use the app does not have. | Measured the dock button's computed `background-color`; grepped every hot usage in `src` — three, all correct: the budget cover action, the triage dot, the reset confirm. **Resolved:** the rule now says "at most **once** per screen, on the single thing that needs a decision", names the three real uses, and says plainly that the record button is not one of them and why emerald is right there. A rule that misdescribes the app misleads every future reader of it. |

### Dead code, removed

| | What | Why it was dead | What was done |
| --- | --- | --- | --- |
| **P16** ✅ | `net_worth_snapshots` — a table in `ddl.ts`, an index, a drizzle model, and a name in the live-query table list | Nothing has ever read or written it. v15 created it so "a ten-year timeline does not mean aggregating ten years of postings on every paint", and the app went the other way: `netWorthHistory` derives the line from the journal, which is what the rule about deriving rather than storing asks for. | Removed from the DDL, the models and the table list, so a fresh database never gets it. **The migration stays and cannot go:** v15 has shipped, a database at v14 still has to pass through it to reach v16, and editing a step that has already run somewhere changes history rather than the future. v15 now carries a note saying the table it creates is vestigial and that nothing reads it in an upgraded database either. |
| **P17** ✅ | `analyticsToday`, exported from `AnalyticsView.tsx` | Referenced nowhere. | Deleted, with its now-unused import. |

### What passed, with the evidence

Recorded because a pass with no evidence is the same as no pass.

| Checked | Result | How |
| --- | --- | --- |
| `assertBalanced` on every write path | **Pass** | `saveEntry` is the only function that inserts into `entries`/`postings` — grep for every `INSERT INTO` and every `db.insert(entries\|postings)` in `src/data` returns only it, and `assertBalanced` is its first statement. 27 call sites, 8 files. `CLAUDE.md`'s corrected wording is accurate. |
| Worked examples against the figure beside them | **Pass, 7 of 7 checked** | Opened each and did the arithmetic: safe-to-spend 28,402.84 − 1,326.76 − 2,308.58 − 200.00 − 10,964.29 = **13,603.21**, matching the field; pace 47 − 3 = **44 points**; net worth 474,980.47 − 241,237.75 = **233,742.72**, matching the Accounts field; envelopes €3,500 assigned / €9,396.24 waiting, both matching the StatStrip; pots €259.29 and €24.29, matching; fee drag 12,361.85 × 0.13% = **€16.07**; runway 17,262.84 ÷ 2,692.59 = 6.4 → "about 6 months". |
| Explanation registry wiring | **Pass** | All 28 declared topics are surfaced somewhere, all 28 surfaced topics are declared, no dead entries. Cross-checked every topic's `figures.*` reads against its call site's `useExplain({...})`: 26 of 28 wired, the 2 failures are P6. |
| Two tabs at once (OPFS pool held elsewhere) | **Pass** | Opened a second tab on the same origin. It did not blank or throw: it fell back to the memory VFS and showed a `role="status"` bar reading *"Sovereign is already open in another tab, and only one can use your saved data at a time… Anything you add here meanwhile will not be saved."* Full shell rendered. This also confirms the warning bar works — on `!durable`, which is P7's point. |
| `BottomSheet` accessible name, warm-open trap, focus hand-back | **Pass** | `aria-labelledby` resolved to the sheet's own title on every sheet opened (11 of 11). On a warm open focus moved in, Tab from the last control wrapped to the first, and closing returned focus to the trigger that was focused when it opened. |
| Layout at 375 / 390 / 430 px in both themes | **Pass** | Computed per route: page horizontal overflow, text clipped by its own box while `overflow:hidden`, any element painting outside the main column (excluding legitimate scroll-container descendants), and the dock covering the last element at full scroll. **Zero problems on all sixteen routes × 3 widths × 2 themes.** |
| Category hue consistency | **Pass** | Collected `--tile-ink` from every `.cat-*` element across six routes: each of the six families resolves to exactly one ink (`housing #4fd1a5`, `food #e8b75e`, `transport #93a0f5`, `obligation #e39073`, `leisure #d79bd0`, `health #7fc4d4`). |
| Hot accent budget | **Pass** | Zero elements painting `--color-hot` on any route in the seeded state, and three uses in source, each on the single thing that needs a decision. Never more than one per screen. |
| Focus ring contrast | **Pass** | `--color-liquid` against every ground it lands on, computed from live tokens: Daylight 6.57–8.17, Midnight 8.09–10.32. WCAG 1.4.11 wants 3. |
| Accessible names, all routes | **Pass but for P4** | Every interactive element on all sixteen routes has a computed accessible name except the two file inputs. |
| Unnamed controls inside sheets | **Pass but for P4** | Eleven sheets across seven routes swept; the only unnamed control was `ImportSheet`'s file input. |
| Escape closes every sheet | **Pass** | 11 of 11. |

### Parity against INVENTORY.md

Checked mechanically, line by line: every backticked identifier and every
quoted user-visible string on each of the file's 289 checkable lines, matched
against the whole of `src` with whitespace collapsed (JSX wraps copy across
lines, so a raw match would produce false failures).

| | Lines | |
| --- | --- | --- |
| **Pass** — every named thing present | **201** | |
| **Probe false positives** | **24** | 16 module paths written `core/x/y` in a table column where the source imports `@/core/x` — all 15 distinct files confirmed present on disk; 1 JSX expression (`aria-current={active ? 'page' : undefined}` at `BottomNav.tsx:184`, which the probe looked for as a literal attribute); 7 reworded strings, below. |
| **No checkable token** | **64** | Prose claims with no identifier or quoted string. Verified by driving the app where observable; the ones that remain unverified are in the section below. |
| **Genuine parity failures** | **0** | |

**The seven reworded strings, each with what it says now.** Copy was rewritten
wholesale in phase 3 with the commissioner's approval, so a changed string is
expected; what matters is that the affordance survives. Each one does:

| Inventory said | The app says | Affordance |
| --- | --- | --- |
| "See how this figure is worked out" | `aria-label="See what has been taken off"` | Present, `SafeToSpendCard.tsx:77` |
| "what it moved" | the breakdown is unlabelled; "Undo this payment" is intact | Present, `PaymentDetailsSheet.tsx:322` |
| "Projected balance" | "In {horizon} days" and "Tightest point" — the two figures the note says are co-equal | Present, `ForecastView.tsx:99,107` |
| "always file to this" | `AlwaysFileToggle`, reworded | Present, `CategoryPicker.tsx:85` |
| "less than a cheap tracker takes" | rewritten in phase 4b when `describeFeeDrag`'s sign bug was fixed | Present |
| Heading "Categories, rules and tags" | h1 "Categories and tags"; the tab group is still `label="Categories, rules or tags"` with all three tabs | Present, `CategoryManagerView.tsx:70,75` |
| "Nothing spare" | reworded | Present |

**Counts in the inventory's own header, re-measured:** 17 routes ✓ (`ROUTES`
has 17), 6 manual chapters ✓ (`CHAPTERS`), 6 chart components ✓
(`src/charts/*.tsx` — `CategoryBars`, `CumulativeSpend`, `ForecastBand`,
`GrowthBand`, `NetWorthTimeline`, `SpendDonut` = **6**. It was 7 at the time of
the audit: `SpendDonut` was added in phase 5 and `SankeyFlow` was removed in
phase 9, which returns the count to the inventory's 6 by coincidence rather
than by correction.)

### The rendering gate

The G1 analysis said no test in this repository mounted a React component, and
that the three severity 1s all went through that hole. Two files close part of
it, and it is worth being exact about which part.

**`features/dashboard/safeToSpendWiring.test.tsx`** — `renderToStaticMarkup`,
no new dependency, `react-dom` was already here. Calls
`calculateSafeToSpend`, hands the result to `SafeToSpendCard`, and asserts the
card prints the engine's figure formatted by the one formatter the app may use.
Nothing is hand-written on either side, so it cannot drift from either. It
closes **engine-to-screen wiring** — the class `ForecastBand`'s scrubber lived
in for months while its engine was correct — and it closes nothing else:
server rendering runs no effects, so it cannot see focus, hook order, a stale
closure or geometry. The header says so.

Verified by breaking it twice: point the card at `committed` instead of
`safeToSpend`, and have it format a figure itself. Both fail.

**`features/renderingGate.test.tsx`** — `@testing-library/react` +
`happy-dom`, two dev dependencies that do not ship. **Three tests, one per
severity 1**, not a suite:

| | Asserts | Broken to check it fires |
| --- | --- | --- |
| P2 | A sheet opened **cold** moves focus inside, pulls focus back in from behind the backdrop, wraps Tab at the last control, and takes its name from its own title | Deps back to `[open]` → fails |
| P1 | The first-run overlay has a name, takes focus on arrival, and Tab from a control behind it comes back in | Name removed → fails. Focus move removed → fails |
| P3 | An empty ledger claims nothing on any surface — no "You are there", no "already there", no "Reached" | Milestone pill fix reverted → fails |

One result worth recording: **reverting the P3 *engine* fix does not fail the
screen test.** The view checks `isUnknown` before it looks at `reached`, so it
is defended independently of the engine. That is the right layering and it
means the two need their own tests rather than one standing in for the other —
the engine arm is in `forecast.test.ts` and was verified there.

It also moved house on the way in. Written in `src/design`, eslint refused it:
design may not import from features. The rule was right and the file's address
was wrong.

**What is still not covered:** everything geometric, everything about the real
browser's cascade, and every failure path. `happy-dom` does no layout, so the
44×44 sweep, the hit-area probes and the contrast-in-situ checks stay browser
measurements — with M2's calibration rule attached.

### Re-audit: how each fix was confirmed

Measured after fixing, in the browser, not inferred from the diff.

| ID | Confirmed by | Result |
| --- | --- | --- |
| **P1** | Re-opened on an empty database and read the element's attributes, `document.activeElement`, and a Tab from a control behind the overlay. | `aria-label="Setting Sovereign up"` and `tabindex="-1"` present where there were none; `dialog.contains(document.activeElement)` **true** where it was `BODY`; focus placed on a dashboard button behind the overlay and one Tab **pulled it in** to "Not now" — `before: false → after: true`. |
| **P2** | Three sheets opened **cold** (the path that used to install nothing), on three routes. | `focusMovedInOnColdOpen: true` on all three, where all three were false. Tab from a control behind the backdrop pulled focus in on all three. |
| **P3** | Walked `#/independence` on an empty database and searched the whole screen for the claim. | Hero now reads **"Not yet known"**; all four milestone pills read "Nothing to go on"; `/already there\|You are there\|Reached/` over the whole screen returns **false**. |
| **P4** | Re-ran the accessible-name sweep over all sixteen routes and inside three sheets. | **Zero** unnamed interactive elements. The guard was then verified by deleting one of the two labels: it fails. |
| **P5** | Opened three sheets and looked for a named close control, then clicked it. | One `aria-label="Close"` button per sheet; clicking it closed the sheet on all three. Its hit area measured at an unscaled viewport by scanning every integer pixel: box 543×16, **hit 44×44**. |
| **P6** | — | Fixed at both sites; `DataAndSecurity` now passes `state.usedBytes`, and the third button, which had no access to the figure, is gone. Not re-measured on screen: the byte count only appears once the persistence state has resolved, and the static cross-check that found it now reports 0 starved call sites. |
| **P7** | Reloaded and read `[role=status]`. | The bar now reads *"Your records are on this device but your browser has not promised to keep them, so it may clear them if space runs short. Settings can ask it to."* It was **empty on all sixteen routes** before. |
| **P8** | Walked `#/budget` on an empty database. | Field now reads **"Nothing to give a job yet / When money arrives it turns up here first, waiting for you to say what it is for."** |

**P3 was only half fixed, and the re-audit is what caught it.** After the hero
was corrected the milestone cards still read *"Enough to stop, living as you do
now — **already there**"*, because `reached` was now false and the pill fell
through to `describeWhen(milestone.months)`, and `monthsToReach(0, 0, …)`
answers 0, which `describeWhen` renders as "already there". The same false claim
in a smaller pill. This is the value of fixing second and re-measuring: reading
the diff would have shown a correct change.

**One consequence of P7 worth naming.** The bar is now visible on every screen
for anybody whose browser has not granted persistence, which on a fresh
localhost origin is everybody — it is why it appeared here. `openDatabase`
already calls `persisted() || persist()` at open, and Chromium grants that with
any engagement and Safari grants it to an installed app, so in practice the bar
is a first-run state rather than a permanent band. If it proves too loud it
dials back to Home only, or to once per session, in one line.

### A calibration note on the 44×44 instrument

The walking probe used through phases 7 and 8 — step outwards from the centre
until a hit test stops landing on the element — reads **2 to 3px short** when
the Browser pane is scaling an emulated viewport to fit. Re-running it after
these fixes reported 123 of 217 controls "under 44", every one of them at 41 or
42, **including the Explain info button, whose hit area is 44 by construction**.

That is the instrument, not the app. Confirmed by measuring the same two
controls at an unscaled viewport with an exhaustive per-pixel scan instead:

```
Explain info button   box 22x22   hit 44x44
dock record button    box 44x44   hit 44x44
```

Recorded because the phase 7 number — 401 swept, 0 under 44 — was taken with
the walking probe, and anybody re-running it under a scaled pane will get a
different answer from the same app. The exhaustive scan is the one to trust.

### Closing state — the final sweep, against the fixed app

Everything below re-measured after every fix, not carried forward.

| | Result | How |
| --- | --- | --- |
| **Parity** | **289 lines · 202 pass · 0 genuine failures** | 23 probe false positives (16 module paths written `core/x/y` where the source imports `@/core/x`, all 15 files confirmed on disk; 1 JSX expression; 6 strings reworded by approved phase-3 work, each with its surviving affordance named) and 64 lines with no checkable token. One line moved from fail to pass — Accounts' missing Explain was a real gap and is closed. |
| **Accessible names** | **0 unnamed** interactive elements on all sixteen routes | Computed the name the way AT does — aria-label → aria-labelledby → label[for] → wrapping label → title, with text content naming a button and not a control. Was 1 (`input[file].sr-only`) at the start of the audit, 25 before phase 4d. |
| **Fields** | **8 routes at exactly one, 8 at none, 0 at two** | `document.querySelectorAll('main .field').length` per route. Three at the start of phase 4e; nine after it; eight after P15 took the forecast one off. |
| **Hot accent** | **0 painted** in the seeded state, never more than one per screen | Scanned every element on every route for `--color-hot`; the three real uses are each conditional on a decision being needed. |
| **Category hues** | Each of the six families resolves to **exactly one ink** | Collected `--tile-ink` from every `.cat-*` element across all sixteen routes. |
| **Layout** | **Zero problems**, 16 routes × 3 widths (375 / 390 / 430) × 2 themes | Per route: page horizontal overflow, text clipped by its own box while `overflow: hidden`, any element painting outside the main column excluding legitimate scroll descendants, and the dock covering the last element at full scroll. |
| **Explanation wiring** | **0 starved worked examples** across all 28 topics | Cross-checked each topic's `figures.*` reads against every `useExplain({…})` in the file that surfaces it. Was 2 at the start of the audit. |
| **Worked example arithmetic** | 8 of 8 checked agree with the figure beside them | Includes the new one: Accounts' field reads €233,742.72 and its explanation says "You hold €474,980.47 and owe €241,237.75, which leaves €233,742.72". |
| **Write path** | `assertBalanced` on every one | `saveEntry` is still the only function that inserts into `entries`/`postings`, and `assertBalanced` is its first statement. |
| **Gates** | typecheck clean · **1012 tests in 51 files** · lint clean but one warning | The warning is `useWhatIf`'s `base`, which is a false positive: all four of that object's fields are listed individually on purpose. |
| **First paint** | **150.20 kB gzipped**, 35.30 kB inside the budget | Walked the chunk graph from `index.html` through static imports only. |
| **Chunk quarantine** | Clean | Manual still a separate chunk, absent from the opening bundle. |
| **Cross-origin** | Nothing in `dist/` fetches from another origin | Every file scanned for nine request forms. |
| **Debt list** | 0 strings across 0 files | |

### What is genuinely left — THE STANDING LIST

**Current as of phase 9.** This is the list, not a phase report: anything open
lives here rather than in a commit message or a conversation. Every closed line
is kept with its resolution so the list reads as a history rather than a
to-do that forgets what it once held.

#### Closed

| | State |
| --- | --- |
| **P9** — three `storage` Explain buttons on settings | ✅ One door. `ProtectStorage`'s went; `DataAndSecurity`'s stayed, because `ProtectStorage` only renders while persistence has *not* been granted. |
| **P10** — two manual chapters with no in-context link | ❌ **Withdrawn, not a defect.** `ExplainSheet` renders `chapter={showing.manual}` dynamically; the grep could not see it. M2. |
| **P11** — Accounts, Analytics and Payoff had no Explain | ✅ Closed in full. Accounts got `net-worth` in phase 8; `where-it-went` and `payoff` were written in phase 9 from the engines outwards, with a test per branch. Nine of ten drafted steps were wrong before that check. |
| **P13** — Quick-assign's disabled reasons unassociated | ✅ `aria-describedby` names the title and the reason. |
| **P14** — `CLAUDE.md` misdescribed the hot accent | ✅ Rule corrected; the record button is emerald and the rule says so. |
| **P15** — a field 552px down the forecast pane | ✅ Removed. Position is evidence. |
| **A5** — ungated hover fills | ✅ 57 found, all gated behind `@media (hover: hover)`, with a guard that forbids ungated hover outright rather than one pinned to a count. |
| **P18–P21** — the Sankey's opacity, its pointer-only content, its 93% band, and `'Still in your account'` | ✅ Phase 9. The chart was removed and recorded in `INVENTORY.md` as an authorised removal; the node name was fixed with a failing-first test. |
| **P22** — `saved` structurally zero, so earmarked money read as unspoken-for | ✅ Both sums negated; guarded by `postingSigns.test.ts` across `src/app` and `src/data`, verified by three breaks. Severity 1. |
| **P23** — three stat cells truncating their labels at 390px | ✅ Labels measured and shortened; the retained wording now agrees across the cell, the caption and `RETAINED_NAME`. |
| **The analytics field's deficit branch had never been rendered** | ✅ Seeded and rendered in both themes at 390. It is what found P22 and P23. The caution caption measures 10.67:1 in Midnight and 4.82:1 in Daylight — the latter matching the figure computed from the token before it had ever been drawn. |
| **Closure freshness asserted nowhere** | ✅ Two tests in `renderingGate.test.tsx` on `BottomSheet`'s Escape effect, asserting the handler reads a *value* from the latest render rather than merely the latest function. Verified by removing `onClose` from the effect's deps, which makes both read `0` instead of `3`. |

#### Open, by decision

| | Why it is open |
| --- | --- |
| **P12** — a disabled label is 2.60:1 in Daylight | Pinned rather than improved. WCAG exempts disabled controls, the exempt pairs are now asserted explicitly in `tokens.test.ts` rather than by omission, and the figure is in writing. Raising it is a decision somebody can take deliberately; leaving it is the correct resting state for a WCAG-exempt pair. |
| **233 exports referenced nowhere outside their own file** | Almost all are props interfaces and in-file helpers carrying an unnecessary `export`. Two genuinely dead ones were deleted. Tidying the rest is cosmetic, touches a very large number of files for no behavioural change, and was deliberately not done. |
| **The flow graph renders nowhere** | ~300 lines of node and link construction in `sankeyFlow.ts` have no consumer outside the tests since phase 9. Kept on purpose: `conservationErrors` walks them on a path independent of the scalar subtraction a screen prints, so `retained` — a headline figure that produced six false sentences — has a second opinion. The file's header says this as the first thing read, and `sankeyFlow.test.ts` fails if the cross-check stops being called from inside the property test. **Delete the graph and that guard together or neither.** |

#### Open, and not yet a decision

| | What it needs |
| --- | --- |
| **`StatCell` labels on every other screen are unmeasured** | P23 measured the three on the analytics field and shortened them. Eleven other labels exist across the app, up to 22 characters, in strips whose cell widths nobody has measured. They may truncate identically. No gate can see it; it needs a browser sweep of every strip at 375 and 390. |
| **No execution test exists for any selector in `src/app`** | The gap P22 came through, and the largest remaining hole in the suite. Engines are property-tested and components now have a rendering gate; the SQL joining them is tested by nothing. `schema.test.ts` shows the harness is possible — `node:sqlite` plus the real DDL — so this is affordable rather than blocked. Until it exists, `postingSigns.test.ts` is a source scan standing in for it. |

### The rendering gate's remaining blind spots

Worth stating at the end rather than implying the hole is closed. `happy-dom`
does no layout, so of the ten classes in G1:

| | Closed by | |
| --- | --- | --- |
| Rendered output | the gate | partially — structure and focus, not appearance |
| Execution over time | the gate | effects run, so hook order and cleanup are reachable |
| Closure freshness | the gate | reachable, not yet asserted anywhere |
| Engine-to-screen wiring | the SSR test | |
| Meaning of generated sentences | per-branch copy tests | |
| Computed geometry and cascade | **nothing** | browser measurement only, with M2's calibration rule |
| The accessibility tree | the gate | names and focus; not a real AT's announcement |
| Whole-app properties | `fields.test.ts`, `targets.test.ts`, the browser sweeps | |
| Outside the module graph | **nothing** | the manifest, headers, icons and docs are still unguarded |
| Failure paths | **nothing** | see below |

### Could not be established in this environment

| What | Why not |
| --- | --- |
| **OPFS eviction mid-session** | Attempted directly: `await root.removeEntry('.sovereign-opfs', { recursive: true })` fails with `NoModificationAllowedError` while the worker holds sync access handles. The browser will not let same-origin script pull the files from under a live session, and real eviction happens below any API the page can reach. What the app does when the pool disappears mid-session is therefore **unverified**. The adjacent failure — the pool being held by another tab — was tested and passes. |
| **Worker failing to start** | The worker URL is resolved by the bundler; there is no supported way to make it fail from the page without editing the source, which would be testing a modified app. **Unverified.** |
| **A migration failing halfway** | Same: it needs a deliberately broken migration in the build. `schema.test.ts` runs every migration against real SQLite and asserts the result, which covers the happy application of each step and not a failure inside one. **Unverified.** |
| **Frame timing of the dock-blur change** | `requestAnimationFrame` does not fire while the Browser pane is hidden — a 20-frame capture with a 3s ceiling never completed. No frame timeline can be captured here. Carried from phase 7 and still **unverified**. |
| **Real iOS behaviour** | Everything about the status bar, the home-screen shortcut, `100dvh` and the sticky `:hover` fills is reasoned from the platform's documented behaviour and verified only in Chromium. **Unverified on device.** This is the largest single block of unverified surface in the project, and the only one a phone closes in an afternoon. |
| **Screenshots, intermittently** | `computer{action:"screenshot"}` times out when the Browser pane is not displayed — "the page did not finish rendering in time". Text-based instruments (`get_page_text`, DOM reads, computed styles) work throughout, so no finding depended on a picture; the phase 9 layout check was done by measuring `scrollWidth` against `clientWidth` and by walking element rects rather than by looking. Worth knowing before anybody trusts a visual diff taken here. |
| **A real screen reader's announcement** | Accessible names and focus order are computed and swept; what VoiceOver or TalkBack actually says, in order, through a whole flow, has never been heard. The rendering gate reaches the accessibility *tree*, not a reader. **Unverified.** |

---

## Severity 1

### A1. Twenty-five text fields had no label a screen reader could read

**Pre-existing.** Found and fixed in phase 4d.

Every text input and textarea in the app was hand-written inside a wrapper that
rendered its label as a bare `<span>`:

```tsx
<Field label="What is it called?">
  <input type="text" value={name} className="w-full rounded-md …" />
</Field>
```

There is no `htmlFor` and no `id` in that, and there were exactly two uses of
`htmlFor` in the entire `src/features` tree. So:

- Tapping the label did not move focus into the field.
- A screen reader announced an **unnamed edit box**. Not "What is it called?",
  not a wrong name — nothing.

That is WCAG 2.2 **3.3.2 Labels or Instructions** (A) and **4.1.2 Name, Role,
Value** (A), in twenty-five places covering every form in the app: recording a
payment, adding an account, setting a budget, importing a statement, entering a
passphrase, and all six onboarding steps.

The practical effect is that a person using a screen reader could not complete
first-run setup, because the wizard's fields did not say what they were for.

**Why severity 1 and not 2.** It is not a degraded experience, it is an absent
one: a form of unnamed boxes cannot be filled in correctly except by guessing
from surrounding text, and onboarding is unskippable for a new household.

**Fixed.** All twenty-five now go through `Input` or `Textarea`, which generate
an id and wire `<label for>`, `aria-invalid` and `aria-describedby`. Verified in
the DOM rather than asserted: every field reports a generated id and a non-empty
`labels` collection. `src/design/ui/noBareInputs.test.ts` holds the line and was
checked by reverting one field.

**What it says about the process.** The defect survived a full design system
phase, three screen phases and a primitives table. It was found only because a
guard was being written for a *different* reason — a claim about iOS zooming the
viewport, which turned out to be wrong: `tokens.css` puts the 16px floor on the
elements themselves, so bare controls were never at risk of it. Checking that
claim before writing the guard is what turned up the real one. The lesson is in
`CLAUDE.md` under the primitives table: reach for the primitive, and a guard is
justified by a defect that has been measured, not assumed.

### G1. The gates could not see a hook-order violation, and eleven commits went past

**Severity 1. Found in phase 6, recorded here in phase 7 at the commissioner's
instruction, because it is a finding about the tests rather than about a screen.**

Adding one lint rule — `eslint-plugin-react-hooks` — to a project with 946
passing tests found three defects in the first run:

| | |
| --- | --- |
| `NetWorthTimeline` | `useCallback` below `if (!geometry \|\| !last) return`. A household with one month of history calls two hooks; at two months it calls three. React tracks hooks by call order, so on the render where that flips, the `useState` slot is read as a `useCallback`. Introduced in phase 5. |
| `SellHoldingSheet` | `useExplain` below `if (!holding) return`. Closing the sheet dropped a hook. Introduced in phase 4b. |
| `ForecastBand` | `useCallback` deps of `[points.length]`, so after phase 5 made the chart width dynamic the scrubber converted pointer positions against a stale 320 — landing on the wrong day at every width but 320. Not a hook-order fault; a wrong-data one, found by the same rule. |

All three passed `typecheck`, `test` and `lint` in the phase that introduced
them, and in every phase after.

**What the finding is.** Not "three defects existed" — three defects in a
codebase this size is unremarkable. It is that the suite had no way of seeing
this *kind* of defect at all. 963 tests assert what functions return and what
source text contains. None of them renders a component twice with different
data and compares the hook sequence, because nothing in the suite renders a
component at all: the test environment is `node`, there is no DOM, and every
component test is a source-text scan.

So the coverage question "are the hooks correct?" had no instrument, and the
answer was arrived at by nobody asking. A rule that reads the call graph
statically found in one run what eleven commits of review had not, because it
was the first thing looking.

**Two things follow, both for phase 8.**

1. Ask of each gate what *class* of defect it cannot see, rather than what it
   covers. The source-text scans are cheap and have found real things, and
   their blind spot is everything about behaviour over time — hook order,
   effect cleanup, stale closures, subscription leaks.
2. A rule that reads the code is worth more than a test that reads the source,
   where one exists for the property in question. `rules-of-hooks` cost one
   dependency and one config line.

---

## Phase 9 — the Sankey, and two more engine-authored sentences

Opened by a reader's report that the ribbons looked opaque in Midnight and the
colours ran together, which is a good example of the only class of defect this
project's gates have never been able to reach: what a person sees.

### P18. A fifth of the chart was painted at two to five times its declared alpha

**Severity 2. The declared value was right; the drawing was not what the value
described.**

`strokeOpacity` was `0.55` on all ten ribbons, confirmed from
`getComputedStyle`, and the ΔE table recorded in phase 5 reproduced from the
running app to within half a unit. What neither described is a chart whose
ribbons overlap: measured on the live screen, **81.4%** of the painted area was
one ribbon deep at alpha 0.550 and **18.6%** was two to five deep, at 0.798,
0.909, 0.959 and 0.982.

*How established.* Canvas rasterisation of the live SVG over the measured card
ground, with overlap depth from the browser's own `isPointInStroke`. Calibrated
before use, per M2: an empty corner read the ground exactly, and eleven of
twelve probes agreed with the arithmetic composite to within 1.2 — the twelfth
being a stroke edge, where coverage is binary and the raster antialiases. Two
instrument errors were caught by calibration and are recorded in M4 below.

The consequence nobody had modelled: family-versus-family separation was never
the problem — overlap *raises* it, and a blend was never confusable with a
single ribbon (0 pairs under dE 10 in either theme). What overlap does is
manufacture colours that are in no palette. The seeded month painted 7
single-ribbon colours and **15 blends**, and eleven of the 231 pairs among all
22 were under dE 10, closest **3.26**. The palette held and the compositing
invented a second one that did not. Full working in `PLAN.md`.

### P19. The chart's entire content was reachable only by pointer

**Severity 2, and on its own sufficient to remove the chart.**

Measured inside the rendered SVG: **0** text nodes, no `<title>`, no `<desc>`,
**0** focusable elements, and `role="img"` with `aria-label="Where your money
went this period"` — which names the chart and carries no value. Every name,
amount and share existed only as a hover or tap reveal.

CLAUDE.md: *"No hover-only affordances. Anything reachable only on `:hover` is
unreachable on a phone."* The donut and the ranked category rows immediately
below were plain DOM with the same names and amounts already in text, so the
accessible version of this chart was the list already on the screen.

*How established.* DOM query for text and focusable descendants, plus a hover
sweep of all eleven nodes driven through the event React actually listens to.

### P20. The chart spent 93% of its area on the one thing that did not happen

**Not a defect in the code. The reason the chart was removed.**

Measured on the seeded household, this month:

| | |
| --- | --- |
| Sources | Pay €3,950 (77%), Other money in €1,180 (23%) |
| Middle | Bills €74.39 (1%), Day-to-day €297.95 (6%), **retained €4,757.66 (93%)** |
| Destinations | six leaves totalling **€372.34 — 7% of the money** |
| Largest single painted colour | **56.5%** of all painted area, one ribbon |

A Sankey earns its area on two-stage attribution — of the money from *this*
source, how much reached *that* destination, through which intermediate. That
needs a many-to-many mapping, and this one is one-to-many at both hops:
`streamLinks` tiles sources against targets proportionally, so no source is
preferentially connected to any stage and the left column carries nothing a
single "in" figure does not. A one-to-many Sankey is a tree, and a tree of
proportions is a donut drawn worse — a donut gives angle against the whole at a
glance, a Sankey gives vertical extent across a gap.

**The decisive form of it:** the retained band grows as somebody spends less of
what they earn, so the chart is least readable exactly when their finances are
healthiest. A chart that degrades as the person does better is the wrong chart.

Threshold at which it would have started working: two or more sources each above
~25%, six or more destinations with none above ~35%, and total spend above ~60%
of income. The seeded month fails all three, and it is a *good* month.

Removal, what replaced each part of it, and what was kept, are recorded in
`INVENTORY.md` under *Authorised removals* — because a removed capability
belongs in the contract it was removed from, not only in the audit.

### P21. "Still in your account" subtracted money that was still in the account

**Severity 2. The sixth instance of the same class, and the second in `src/core`.**

The retained node was named `'Still in your account'`. Its figure is
`income - spent - saved`, and `saved` is budget-book only, so money earmarked
for a pot had been *subtracted* from it — and earmarked money is exactly what
is still sitting in the account. The sentence is true only where `saved` is
zero, which is the shape of the month it was read against. That is how it
survived a phase.

*How established.* Driving the seeded app and reading the node's own hover
label: "Still in your account €4,757.66 93%", against a month whose `saved` was
zero. The defect is in the branch no screen exercised.

Fixed to `RETAINED_NAME`, which is `'Not spoken for'` — the analytics field's
own wording for the same figure, because one term used twice beats two terms
for one figure. `sankeyFlow.test.ts` holds it across the funded-pot branch and
the zero branch, verified by reverting the name, which fails both.

### P22. `saved` was structurally always zero, so the field told people their earmarked money had no job

**Severity 1. Somebody was shown something false about their own money, on
every period, for as long as the query has existed.**

Found by seeding a month that spends more than it earns — the branch of the
analytics field nobody had ever rendered — and noticing that the third stat
cell still did not appear.

The analytics selector reads pot funding as:

```sql
SELECT a.id, a.name, COALESCE(SUM(p.amount), 0)
 WHERE p.book = 'BUDGET' AND a.type = 'ENVELOPE'
   AND a.envelope_role IN ('goal', 'sinking_fund')
HAVING COALESCE(SUM(p.amount), 0) > 0
```

Putting money into a pot is `credit(BUD, envelopeId, amount)`, and `credit`
stores its amount **negated** — its own doc comment says so: *"a reduction of
an asset, or an increase in a liability, income or envelope balance."* So a
funded pot sums to a negative number, `HAVING … > 0` matches nothing, and
`saved` is zero for every period that has ever been viewed. The only way that
query could return a row is a pot being *drained*.

*How established.* Three independent measurements:

1. Funded the Holiday Travel pot with €900 through the app's own
   `assignOnDate`, which returned without error — so `assertBalanced` was
   satisfied and the entry is real.
2. The **Pots screen** showed Holiday Travel at €1,500 of €1,800, up from
   €600. The money is there and one screen can see it.
3. The analytics field showed no "set aside" cell and `retained` exactly equal
   to `income − spent`, which is only possible if `saved` is 0.

And the decisive piece of evidence is internal: the income query four lines
above negates (`-SUM(p.amount)`) for exactly the same reason, and `budgetRepo`
negates over these **same** ENVELOPE accounts in the same book. Four summing
queries in one file, three right; two queries over one account type
disagreeing, with nothing comparing them.

**What it cost.** `saved` zero means `totalOut` understated by whatever had
been put by, and `retained` overstated by the same amount — so the field's
"not spoken for" figure included money the person had deliberately earmarked.
On the seeded household that was **€235 a month of pre-existing assignments**,
invisible on every period. The figure reported in the phase 9 review — €4,758
"not spoken for" for September — was itself overstated by €235 by this defect.

It also made a whole paragraph of documentation describe something the app did
not do. The `where-it-went` explanation's second step promises that money kept
for later "is counted too, even though it has not left your account"; it was
not counted. The comments on `SankeyGraph.saved` reasoned carefully about
mixing the two books, for a figure that was always zero.

*Fixed* by negating both sums. *Guarded* by `src/app/postingSigns.test.ts`,
which asserts that **every** `SUM(p.amount)` over a credit-normal account in
`src/app` and `src/data` is negated, and that none over a debit-normal one is.
Verified by breaking it three ways — both sums reverted, and each of the two
half-edits.

**The guard was itself wrong first.** Its first version asked whether `-SUM`
appeared *anywhere* in the query block, and a deliberate revert of the SELECT
alone — leaving the HAVING negated — sailed straight through it. Caught only
because the break was actually run rather than assumed. It now counts negated
sums against total sums and requires equality. M2 at the third time of asking,
and the first time the instrument under test was a guard I had just written.

**The gap it came through.** There is **no execution test for any selector in
`src/app`**. The engines are property-tested, the components now have a
rendering gate, and the SQL that joins them is tested by nothing: it is not a
pure function, it needs a database, and no harness exists for it even though
`schema.test.ts` proves one is possible with `node:sqlite` and the real DDL.
A source scan is what was affordable today; it sees that the negation is
written, not that the query returned the right rows.

### P23. Three stat cells do not fit their labels at 390px

**Severity 2, and visible only once P22 was fixed.**

The field's stat strip holds two cells until a pot is funded, and three
afterwards. At 390 wide, three cells leave **74px** each. Measured at 11px
Space Grotesk:

```
Came in              41.6px   fits
Of that, set aside   91.8px   ellipsised to "Of that, set ..."
More than came in    98.4px   ellipsised to "More than c..."
Not spoken for       78.7px   would ellipsise; had been fitting only
                              because two cells are wider than three
```

`StatCell` truncates gracefully rather than clipping, so nothing overflowed and
the layout sweep reported zero problems — the page did not scroll sideways and
no element painted outside its box. What was lost was the meaning: "More than
c…" does not say what the figure is, in the one branch a reader most needs to
understand.

*How established.* Rendered it. The truncation is visible in a screenshot and
then measured with `scrollWidth > clientWidth` per cell, with candidate
replacements measured through a canvas `measureText` at the cell's own computed
font rather than guessed.

*Fixed* to "Came in" / "Set aside" / "Over by", with the surplus branch's
"Not spoken for" shortened to "No job yet" — which also brings the cell, the
caption beneath it and the engine's `RETAINED_NAME` to one wording, so M5's
divergence cannot start here.

**Not guarded, deliberately.** This is the computed-geometry class, which
`happy-dom` cannot reach. A character-count proxy was considered and rejected:
other screens carry `StatCell` labels up to 22 characters and are unmeasured,
so a blanket limit would fail labels that may be perfectly fine. **Those other
labels remain unmeasured and may truncate the same way** — it is on the
standing list and on the device checklist.

### The dependency audit before the removals

Recorded because the instruction was to confirm rather than assume, and because
one of the two answers was the opposite of what had been predicted.

| Symbol | Predicted | Established | Kept? |
| --- | --- | --- | --- |
| `SankeyFlow`, `SankeyLegend` | chart-only | chart-only; sole importer was `AnalyticsView` | **removed** |
| the itemised `BottomSheet` | chart-only | sole caller was `onSelectNode` | **removed** |
| `SHORTFALL_NAME` | chart-only | read only by the engine and its test — but it names a node that is *not* chart-only, below | **kept** |
| the shortfall node and `RESERVES_ID` | chart-only | **wrong.** `conservationErrors` asserts `sourceTotal === totalIn`, and without the node that fails on every deficit period. Asserted five times in `analytics.test.ts`, including over generated ledgers | **kept** |
| `drewOnReserves` | read by the deficit caption | confirmed: `AnalyticsView` reads it, and it derives from the same `shortfall` | **kept** |
| `foldSmallSlices`, `SMALL_SLICE_BP`, `OTHER_ID` | chart-only presentation | shape the graph's leaves, which `conservationErrors` walks | **kept** |
| `buildSankeyFlow`, nodes and links | keep as the conservation engine | confirmed, with a caveat: after the removal **nothing renders nodes or links**. The view reads only the six scalars | **kept, unrendered** |

The last row is the one worth arguing rather than asserting. Roughly 300 lines
of graph construction now have no consumer outside the tests, which ordinarily
means delete it — *"prefer deleting a thing to leaving it unused"*. It is kept
because `conservationErrors` walks the nodes and links on a path independent of
the scalar arithmetic, so the `retained` figure the field prints has a second
opinion behind it instead of one subtraction nobody checks, and the property
tests hold that over hundreds of generated ledgers. Deleting the graph would
delete the only cross-check on the numbers that replaced it. `src/core` is also
explicitly out of scope for restructuring on a visual change.

---

## Method

### M1. A recorded cause is a hypothesis until it is measured

Not a defect in the app. A defect in how this project reasons about defects,
found in phase 5 and worth the space because it survived longer than any code
bug has.

**What happened.** Phase 4a diagnosed the milestone-label collision in
`NetWorthTimeline` as horizontal — Space Grotesk being wider than the previous
face, against `textAnchor="end"`. That diagnosis was written into the file as a
comment addressed to a future phase, including the instruction "do not go
looking at vertical spacing", and repeated in a commit body. It was then carried
through 4b, 4c and 4d review and promoted into the phase 5 brief as a standing
instruction.

It was wrong. Phase 5 measured it before acting:

```
€10,000.00   ink box y 106.7 – 114.7
€25,000.00   ink box y 100.3 – 108.3
             overlapping by 1.58px, baselines 6.42px apart
```

Every label was anchored at the same x. Two labels anchored at the same x
cannot collide with each other because of their widths — only their y matters.
The recorded cause was not merely imprecise, it pointed away from the actual
one, and its "do not look at vertical spacing" would have ruled out the only
thing that mattered.

**Why it survived.** Because it was specific, confidently worded, and written
in the file rather than in a report. Specificity reads as evidence. Nothing
about the note distinguished "I measured this" from "I reasoned about this and
it sounds right", and once it was in the source every later reader — including
its author — treated it as settled.

**The rule.** A cause written down is a hypothesis with a good pedigree, not a
finding. Where a note in the source names a cause, it says how it was
established, and a note that cannot say is marked as a guess. The measurement
is the finding; the prose is a summary of it.

The two ribbon-opacity notes are the shape this should take: they carry the ΔE
table they were derived from, so a later reader can check the conclusion
against the numbers rather than against the confidence. They lived in
`SankeyFlow.tsx`, and when phase 9 removed that file they moved to `PLAN.md`'s
decisions section rather than going with it — **a measured decision outlives
the code it was measured on**, and the overlap finding added there is worth
more than the chart was.

**Not a one-off.** Phase 5 also carried a claim that bare `<input>`s lost the
16px iOS-zoom floor. Checking it before writing the guard showed the floor is a
base-layer rule on the elements themselves, so bare controls were never at risk
— and checking it is what turned up A1, which is considerably worse. Both cases
point the same way: the cheapest moment to test a recorded cause is immediately
before relying on it.

---

### M2. An instrument is a hypothesis too, and this one was wrong for two phases

**Method, found in phase 8 while confirming phase 8's own fixes.**

M1 says a recorded *cause* is a hypothesis until it is measured. This is the
same lesson one level down: **a recorded measurement is a hypothesis about the
instrument.**

The 44×44 sweep used through phases 7 and 8 walks outwards from an element's
centre, one pixel at a time, and stops when a hit test no longer lands on it.
Re-run after the phase 8 fixes it reported **123 of 217 controls under 44px** —
which would have been a catastrophic regression, except that every single value
was 41 or 42, and the list included the `Explain` information button, **whose
hit area is 44 by construction** (`.target` is `max(100%, 44px)`).

A uniform 2–3px shortfall across every control, including one that cannot be
short, is a reading about the ruler. The cause is the Browser pane scaling an
emulated viewport to fit: integer CSS offsets map to fractional device pixels
and the boundary lands inside. Established by measuring the same two controls
at an unscaled viewport with an exhaustive per-pixel scan instead of a walk:

```
                       box      walking probe    exhaustive scan
Explain info button    22x22    42x41            44x44
dock record button     44x44    42x41            44x44
```

**What this costs.** Phase 7 reported "401 interactive elements swept, 0 under
44px" and phase 8's audit carried that number forward. It was taken with the
walking probe. The conclusion happens to have been right — the exhaustive scan
agrees on the two controls it was checked against — but it was right by luck,
and anybody re-running the sweep under a scaled pane would have got a different
answer from the same app and had no way to tell which run to believe.

**Three things follow.**

1. **Calibrate against a known value before trusting a sweep.** A control whose
   answer is fixed by construction is free to include and turns "is the app
   right?" into "is the ruler right?" first. The Explain button is that control
   here.
2. **A uniform error is a signal about the method; a scattered one is a signal
   about the subject.** 123 failures at 41–42 is not 123 defects. The shape of
   the distribution said so before the calibration did.
3. **Record which instrument produced a number.** The two probes disagree by
   2–3px and only one of them is right. A number in a report without its
   instrument cannot be reproduced or challenged.

This is the second time in this project that a measurement was trusted because
it was written down. The first was the milestone-label cause in M1. Neither was
malicious and neither was careless — both were a reasonable thing to believe,
recorded, and then relied on.

### M3. A near miss: the wrong comment was mine, and it was two hours old

**Caught before the commit that would have carried it. Recorded because a
wrong comment outlives wrong code.**

Exposing `income`, `spent` and `saved` on `SankeyGraph`, I documented the third
one as:

> Part of `totalOut` because it left the everyday accounts, and still the
> person's money.

It has not left anything. `assign` in `ledger/entries/builders.ts` says so in
its own doc comment — *"Give money a job. Budget book only, no cash actually
moves"* — and the selector confirms the shape: `income` and `spent` come from
the FINANCIAL book, `saved` from the BUDGET book's goal and sinking-fund
envelopes. `totalOut` adds a figure from one book to a figure from the other,
deliberately and correctly, and "it left the everyday accounts" is exactly the
thing that is not true of it.

What makes it worth a numbered entry rather than a quiet fix:

- **It is M1's failure mode, authored fresh.** M1 is about a recorded cause
  read back as a fact a year later. This is the same thing at two hours old,
  written by somebody who had read the engine that morning and had every
  reason to believe it. A wrong comment does not decay into a fact; it starts
  as one.
- **Writing it is what caught it.** The claim only became checkable once it
  was a sentence. Had the three figures been exposed without documentation the
  defect would have shipped invisibly, and the next reader would have
  reconstructed the same wrong belief from the field's label.
- **It survives longer than wrong code.** No gate reads a comment. Typecheck,
  1025 tests and lint were all green over it, and would have stayed green over
  it indefinitely — it is squarely in G1's second open class, everything
  outside the module graph, which is the class this file is also in.
- **It had already produced four defects on screen.** The analytics field said
  "Went out", "Money in", and "Still in your accounts", and printed "Nothing"
  for a negative remainder. All four are the same misreading the comment made,
  reached independently, which is the evidence that the misreading is the
  natural one and has to be written down to stop.

The corrected comment now says what `saved` is not, names `assign`, and states
the two consequences that had already been got wrong — that a screen may not
say "went out" and mean both halves, and that `drewOnReserves` can be true on
a month that drew on nothing.

### M4. Two instruments failed inside one hour, and both would have inverted a finding

**Phase 9. Neither reached this file as a finding, which is the only reason
they are worth recording.**

Measuring whether the Sankey had labels, two probes gave confidently wrong
answers in opposite directions.

**The hover probe reported that no node revealed anything.** It dispatched
`pointerenter`. React attaches at the root and derives `onPointerEnter` from
native `pointerover`, so nothing was listening and all eleven nodes came back
silent. The finding it was about to produce — *"the chart has no labels at
either end, not even on hover"* — was the opposite of the truth: hovering
reveals "Food shopping €191.05 4%". Caught by asking the instrument to prove
itself against a value fixed by construction: a working hover **must** dim the
unrelated ribbons to `0.07`, which is in the source. It did not, so the
instrument was broken rather than the chart.

**The tap probe reported that all eleven nodes opened a sheet.** Every one
returned the same dialog text, which on inspection was the first-run onboarding
overlay — restored by a reload and sitting in front of everything. The real
answer is that no node opens a sheet with this data, because `onSelectNode`
only fires for the folded node. Caught by a precondition the probe should have
had from the start: assert zero dialogs are open *before* touching anything.

Two things follow, and they sharpen M2 rather than repeat it:

- **A silent instrument and a saturated one fail the same way.** One said "no"
  to everything and one said "yes" to everything, and both looked like clean
  results. A sweep whose answers are all identical is reporting on itself.
- **The calibration has to be a value the subject cannot fake.** "Does the
  hover reveal text" is the question; "does the hover dim the other ribbons to
  the 0.07 written in the source" is checkable independently of the answer.
  Every sweep needs one of the second kind.

A third, smaller: probing left the chart stuck in its dimmed state, because the
synthetic `pointerleave` was not the event React listens to either. The ΔE
sweeps had all been taken before that point, and were re-run on a reloaded page
to prove it — identical to two decimal places. **Re-run a measurement after
interacting with the thing you measured.**

### M5. A rule stated twice is two rules, and they diverge silently

**Found by accident in phase 9, which is the problem. Nothing detects this
class and no gate ever will.**

`CLAUDE.md` stated the `family="none"` exemption in two places:

> **The field rule:** *"exists for exactly one case and must stay rare: where
> it went, whose field sits directly above **a Sankey** in which every ribbon
> is already one of the six hues."*
>
> **The kit table:** *"`family="none"` for the one screen whose subject is
> every family at once."*

They read as the same rule and they are not. The first is narrower: it grounds
the exemption in a component. The second grounds it in what the screen is
about. For four phases nothing distinguished them, because the Sankey existed
and both were satisfied by the same screen.

Removing the chart separated them. The narrow statement stopped making sense —
its reason was gone — and the exemption looked like fallout of the deletion.
The broad statement was untouched and still correct, because the donut and the
category rows below the field colour every segment by family. **The rule
survived; the statement of it that named an implementation did not.**

What makes this a method finding rather than a tidy-up:

- **Nothing detects it.** Two prose statements of one rule, in one file, with
  different scopes. No typecheck, test, lint or source scan is shaped to
  compare them, and none could be without understanding what the sentences
  mean. It is squarely in G1's second open class — everything outside the
  module graph — and this file and `CLAUDE.md` are both in that class.
- **Divergence is invisible while both statements are satisfied.** The narrow
  one is *implied by* the broad one, so every check passes and every screen
  looks right, until the thing the narrow one names is deleted or changes.
  The moment of discovery is the moment of breakage, which is the worst
  possible time.
- **The one naming an implementation is the one to distrust.** A component, a
  file, a chart, a token is where a rule was first *noticed*, not usually why
  it holds. When a rule cites one, ask whether the citation is the reason or
  the anecdote.

That last heuristic is the useful half, and the sweep below shows it is not
universal — so it is a place to look first, not a verdict.

### The sweep M5 produced, and the two more it found

Rules rarely diverge alone, so every subject stated in more than one section of
`CLAUDE.md` was enumerated and each set read for agreement in **scope**, not in
sentiment. Twenty subjects, ten stated once (no divergence possible), ten in
two or three places. Seven of those ten were citations rather than
restatements — the G1 map naming `fields.test.ts` or `noBareInputs` as examples
of what a gate covers is a reference, not a second statement of a rule.

**Three were real restatements, and two of them disagreed.** Both in the same
direction, and it is the direction that has already cost this project twelve
routes: **an upper bound written as an exact count.**

| Subject | The two statements | Verdict |
| --- | --- | --- |
| `family="none"` | "above a Sankey" vs "the one screen whose subject is every family at once" | **Diverged.** M5 above. Fixed: the broad statement is the rule, and the field rule now says how the narrow one went wrong. |
| The field per screen | The field rule: *"exactly one per screen, or a reason written down"* — against **Motion**: *"there is never more than one field on a screen"* | **Diverged.** "Never more than one" is the exact weaker reading the field rule names as the mistake. It is *correct as a premise for the motion scope*, which only needs an upper bound — so the fix is to say that explicitly rather than restate the field rule. A reader meeting the motion section first learned the discredited version. |
| The hot accent | The budget: *"appears at most once per screen"* — against the describe/name rule: *"Attentional treatments do not scale … **exactly one per screen**"* | **Diverged.** "Exactly one" would demand a hot mark on every screen. Phase 8 measured **zero** painted across the whole seeded app and recorded that as correct, because all three uses are conditional on a decision existing. Fixed to "at most one per screen, and none at all is the common case". |
| 44×44 | `CLAUDE.md`: *"44×44pt **minimum** on every interactive target"* — `README.md`: *"44×44 on every interactive target, with **no exceptions**"* | **Agree.** A minimum with no exemptions is one rule stated two ways. Checked and left. |

Two of three restatements were wrong, and both were the same confusion. That is
a better argument for the sweep than the original finding was: **"at most one"
and "exactly one" are different rules that look like a wording preference**,
and this project has now got that distinction wrong three separate times — the
field, the motion premise, and the hot accent. The first cost thirteen screens
their hero surface for four phases.

The instrument was a hand-built enumeration of subjects, which is a grep and
therefore a hypothesis (M2). It can only find divergence among subjects
somebody thought to list; a rule stated twice in words that share no keyword is
invisible to it. Listed here so the next person knows what the sweep did and
did not cover.

---

## Severity 2

### A2. The information button's hit area was 44×37, and its class said 44×44

**Found in phase 7 while verifying brief §8. Pre-existing since phase 3.**

`Explain` carried `size-11 -m-[11px]`: a real 44×44 box, pulled back into a
22px layout slot by a negative margin so the glyph stayed 22px. Correct in the
markup, correct in `getBoundingClientRect`, and wrong on the screen.

Measured by walking outwards from the button's centre with
`elementFromPoint` until the hit test stopped landing on it:

```
box 44x44   hit 44x37
at centre           SPAN.flex size-[22px] …
18px above centre   BUTTON.press -m-[11px] …
18px below centre   P.text-caption text-ink-2      <- the caption, not the button
```

The negative margin makes the button overflow its slot, and the **next
sibling** — a caption paragraph, later in normal flow — paints over the bottom
seven pixels. Nothing in the markup, the types or any gate could show this. A
class that says 44 and a box that measures 44 were both true.

The general lesson is the one that generalises past this button: **an expanded
hit area needs a z-index, because expanding it means overflowing a slot and
whatever comes next in the document owns the overflow.** `.target` in
`tokens.css` carries `position: relative; z-index: 1` for exactly this reason,
and the sweep that found it is now `targets.test.ts`'s method rather than a
one-off.

The same sweep measured 401 interactive elements across sixteen screens and
found **142 of them under 44px**, including a filter chip 32px tall whose inner
button was 18px — the top and bottom seven pixels of something that plainly
looks pressable did not answer.

After this phase: **30**, and all thirty are members of a segmented control,
which cannot exceed the height of the control it is inside. See `KNOWN_CEILING`
in `targets.test.ts` for the measurement and the three ways out.

### A3. Both home-screen shortcuts opened the dashboard

**Found in phase 7. Pre-existing since the manifest was written.**

The web manifest offered two long-press shortcuts, `/?action=add` ("Add
transaction") and `/?view=triage` ("Triage queue"). Nothing in the app has ever
read `location.search` — grepped the whole of `src` for `searchParams`,
`location.search` and `URLSearchParams`: no hits before this phase.

So both shortcuts opened the app at the dashboard. Severity 2 rather than 3
because a control that silently does nothing teaches the person that they
pressed the wrong thing, and they stop using it rather than reporting it.

Fixed: `action=add` is honoured and the query stripped on the way past;
`view=triage` becomes `/#/triage`, which is the app's own routing mechanism and
needs no code.

### A4. Thirteen of sixteen screens have no field

**Found in phase 7. Pre-existing from phases 4a–4d. FIXED in phase 4e, which
was inserted before the audit for the reason in the closing note below.**

The brief's §4 and `CLAUDE.md` both say a field is the one panel a screen is
built around, **exactly one per screen**. Measured with
`document.querySelector('.field')` on each of the sixteen routes: it exists on
three — Today, What you're worth, and Invested.

The rule has been honoured as "never more than one" and not as "always one".
The other thirteen screens lead with a `Card` carrying a `Money size="figure"`,
which is the hero figure in a container the design system says is for lists and
charts.

This matters beyond consistency for two reasons:

- The hierarchy the three surfaces exist to create is absent on most screens.
  A screen whose hero figure sits on a card has one surface doing two jobs,
  which is the state phase 2 was commissioned to fix.
- Phase 7's orchestrated entrance is scoped to `.field` descendants, because
  "exactly one field per screen" is what makes "one moment per screen"
  unbreakable rather than a thing to remember. Scoped correctly, it therefore
  reaches three screens. Widening it to "the first card" would be the
  fade-and-slide-on-every-card default arriving by the back door.

Deciding which thirteen screens get a field, and what figure each one is built
around, is a phase 4 question. It should not be answered by a selector.

---

**Resolved in phase 4e.** It was not thirteen fields. Each of the thirteen was
asked whether it has one number it exists for, and six did:

| | |
| --- | --- |
| Envelopes | what is left to give a job |
| Pots | what to put by each month |
| Ahead · forecast | how long the money would last |
| Ahead · where it went | what went out in the period |
| Payoff | what goes towards the debt each month |
| When you could stop | when — the milestone the h1 is named after, which was in the fourth card down |

Seven did not, and that is now a written position rather than an omission: a
queue, a list, a calendar whose subject is *when*, a list of sketches, a
structure, settings, and prose. The reasons are in `NO_FIELD` in
`fields.test.ts`, which fails if a route is on neither list.

Measured after: nine routes with exactly one field, seven with none, and the
seven are exactly the seven.

**The note this finding was really about.** The three-surface hierarchy is the
structural change the redesign was commissioned for, and it had reached three
screens of sixteen while six phases of work went past on top of it. The audit
would have measured an app that never received its main change. What made it
findable was counting rather than looking — `document.querySelectorAll('.field')`
on each route, sixteen numbers, three of them 1.

---

## Severity 3

### A5. Seventeen hover fills are ungated, and on iOS a hover fill sticks

**Found in phase 7. Pre-existing. Not fixed — phase 8.**

`Numpad`, `SwipeRow` and `Explain` each carry `[@media(hover:hover)]` on their
hover state, and the comment in `Numpad` says why: *"No hover fill on touch —
it sticks after a tap on mobile Safari."* A tap leaves the element in `:hover`
until something else is touched, so the last thing pressed stays lit.

Three components learned that. Seventeen `hover:bg-*` declarations elsewhere
did not:

```
charts/CategoryBars.tsx:232               features/calendar/CalendarView.tsx:78, 94, 187
design/ui/Button.tsx:17, 18, 19           features/gallery/Gallery.tsx:268
design/ui/Chip.tsx:87                     features/investments/HoldingsList.tsx:69
design/ui/List.tsx:98                     features/settings/SettingsView.tsx:308
features/budget/BudgetGrid.tsx:100, 124   features/shell/SelectionBar.tsx:70, 71
features/triage/TriageView.tsx:532
```

Severity 3: it misleads about which control is active rather than stopping
anybody, and it is invisible on every machine anybody develops on.

The fix is mechanical — prefix each with `[@media(hover:hover)]:` — and one of
the seventeen is a deliberate no-op: `bg-hot hover:bg-hot` on the reset
confirm, which exists to stop the colour changing at all.

A guard for this was written during phase 7 and **removed before committing**.
It could only have asserted "no more than seventeen", and a test pinned to the
current number of defects reads as green while nothing is fixed — the opposite
of what the other guards in this project do. It goes in as
`expect(offenders).toEqual([])` when the seventeen are cleared.

---

## Severity 4

*None recorded yet.*
