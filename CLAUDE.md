# Sovereign — working rules

A local-first, zero-knowledge, double-entry personal wealth platform. Everything
happens on the device: no servers, no accounts, and **no network requests, ever**.

These are the rules that outlive any one task. The design spec lives in
`design-refs/DESIGN-BRIEF.md`; the pre-redesign feature contract lives in
`design-refs/INVENTORY.md`.

---

## Before every commit

```bash
npm run typecheck && npm test -- --run && npm run lint
```

All three must be green. Report the test count; **it must never go down**. Never
delete or skip a test to make the suite pass — if behaviour genuinely changed,
update the test and say so in the commit body.

---

## Layering

```
core  ←  content  ←  data  ←  app  ←  design  ←  features
```

Imports point leftwards only. Enforced by eslint, and it is not advisory.

- `src/core/**` — pure engines. No React, no DOM, no I/O. Deterministic and
  fully unit-tested. **Do not refactor it for a visual change.**
- `src/content/**` — the words. Explanations, and the sums behind them written
  out in the person's own figures. It sits directly above `core` because it
  needs to name a `Minor` and nothing else: it may not know that a database, a
  React tree or a screen exists. That is what keeps the copy reviewable on its
  own and stops a screen's state leaking into a sentence.
- `src/data/**` — SQLite/OPFS, repositories, migrations, the live-query bus.
- `src/app/**` — hooks and selectors that join core to data. If a screen needs a
  value the core does not expose, **add a selector here** — never reach into
  `src/core` from a component.
- `src/design/**` — tokens and primitives. Knows nothing about finance.
- `src/features/**` — screens and sheets. May not import `src/data` directly.

## Chunk quarantine

Analytics, investments, accounts, budget, the field manual and the gallery each
stay out of the opening bundle. The comments in `AppShell.tsx` naming what may
not be imported above a given line are load-bearing — respect them.

**The barrel-leak pattern has cost this project a bundle budget twice.** A
re-export from an eagerly-imported barrel drags the whole module graph into
first paint. `src/features/manual/chapters/slugs.ts` exists solely to break one
of these: it has no imports at all, so a first-paint screen can name a chapter
without pulling six chapters and three engines in behind it. Do not "tidy" it
into the chapter barrel.

---

## Money

- Every amount is an integer in minor units, carried as the branded `Minor` type.
  No floats, anywhere, for money.
- **No component may hardcode a currency symbol.** Amounts reach the screen only
  through `<Money>` / `useMoney`, which take the symbol from config via a
  centralised `Intl.NumberFormat`. There is a test that enforces this.
- The ledger is single-currency; `assertLedgerCurrency` is the one gate.
- Both books (FINANCIAL and BUDGET) must balance independently.
  **`assertBalanced` is what runs on every write** — it refuses any entry whose
  lines do not sum to zero in each book it touches. The ten-property engine,
  I1–I10, is *not* in the app bundle and is not called from the running app:
  it is the second opinion the property tests hold the ledger to, over
  generated sequences of entries. This file claimed I1–I10 ran on every write
  for six phases; the note at the foot of `src/core/ledger/index.ts` said
  otherwise, in writing, the whole time. The code was right.
- **Projections are derived on the fly, never stored.**
- **Net worth is never projected forward.** The dashed line on that chart is a
  comparison against a past savings rate, not a forecast. This refusal is
  deliberate; do not add a forward projection to it.

---

## Design

### Colour encodes category, never sentiment

Six families — housing, food, transport, obligation, leisure, health. Housing is
the same hue in the donut, the envelope tile, the transaction row's icon square
and the calendar dot. That consistency is what makes colour an index a person
can navigate by, and it is what lets the explanatory prose come out of the
screens. Bind a family with one class (`.cat-housing`) and let the tile, field,
icon square, ring and bar segment all inherit it.

Never reassign a category's hue. Never use a category colour to mean "good" or
"bad".

### The hot accent budget

`--color-hot` appears **at most twice per screen**: the record button, and the
single dot marking the one thing that needs a decision. A third occurrence is a
bug. It is a fill and a marker — **never small text**, because it does not clear
AA as type on any of our grounds.

### Describe every instance; name only the one that needs a decision

The budget above only holds if you know which treatments may repeat. This is
that rule, and it generalises well past the two screens it came from:

- **Descriptive treatments scale.** A ring, a hatched band, a category hue, a
  bar. They state a fact about one item, and every item may carry one. Four
  envelopes over budget get four completed rings; three tight weeks get three
  hatched bands. Suppressing the second one would be hiding a fact.
- **Attentional treatments do not scale.** A hot dot, a named label, an action
  strip. They say *look here*, and saying it four times says it nowhere. Exactly
  one per screen, on the single thing a person could act on next.

So being over budget is described — the ring completes, the wording turns from
"left of" to "over of", both in the envelope's own category hue — and the hot
mark goes on the action that fixes the worst one, not on the states. This
deliberately diverges from the reference sheet, which puts a dot on the
over-budget tile: that works for its one-over example and breaks at four.

### A tone prop and a colour class are not interchangeable

A primitive that owns its colour — `Money` and its `tone`, and anything that
follows it — emits exactly one colour utility. Passing a second one through
`className` puts two utilities of equal specificity on one element, and the
cascade is then decided by the order Tailwind happens to emit them in, not by
the order they were written. Tailwind emits `text-ink` after
`text-[var(--tile-ink)]`, so **the override loses, silently, with nothing wrong
in the markup to see.**

Every hero figure on a field rendered ink-black for a whole phase because of
this. It was not visible in a diff, in a type error or in a lint run; it took
sampling the computed colour to find.

The fix is a tone, never a class: if a figure should take the colour of what it
sits in, that is `tone="inherit"`. `toneNotOverridden.test.ts` fails any element
that carries both a `tone` prop and a colour utility in `className`.

### Three surfaces, deliberately unlike each other

- `.field` — large, flat, category-coloured, no border, no shadow. **Exactly one
  per screen**, at the top, carrying the number that screen exists for.
- `.card` — surface fill, hairline, tight contact shadow. Lists and charts.
- `.tile` — category-coloured, small, no shadow, in a grid of siblings.

Radii are hierarchical: the bigger the object, the rounder it is. One radius on
everything is what makes a screen read as a kit of identical boxes.

### One field per screen, or a reason written down

"Exactly one per screen" was honoured as "never more than one" and not as
"always one". It existed on **three of sixteen routes**; the other thirteen led
with a `Card` carrying their hero figure, which is one surface doing two jobs —
the state the three-surface hierarchy was introduced to fix.

Nine routes have one now. The other seven are on a list, each with an argument
rather than a label, and `fields.test.ts` fails if a route is on neither list,
if an owner stops drawing one, or if one appears anywhere else.

The question every screen has to answer is **is there one number this screen
exists for**, and "no" is a real answer:

- **Yes:** Today, What you're worth, Invested, Envelopes, Pots, Payoff, Ahead's
  forecast and where-it-went panes, When you could stop.
- **No:** Review (a queue — the count is a property of the stack, and a field
  pushes the first row off the fold), the whole record (a list), the calendar
  (two figures of the same kind; the screen is about *when*), What if (a list of
  sketches with no figure until one is open), Categories (a structure),
  Settings, and the manual (prose).

A field where the answer is no is worse than none: it promotes one figure out of
several equals, or puts a number above a screen whose subject is not a number.

**The hue is not a free choice.** Five of the nine take the hue their own chapter
of the field manual already carries, so the contents page and the screens agree:
`two-books` → food → Envelopes, `pots` → health → Pots, `cards` → obligation →
Payoff, `selling` → transport → Invested, `safe-to-spend` → housing → Today.
Ahead's forecast shares Today's housing because it is the same cash one step
further out; When you could stop shares Invested's transport because it is that
screen's own future.

`family="none"` exists for exactly one case and must stay rare: where it went,
whose field sits directly above a Sankey in which every ribbon is already one of
the six hues. A seventh above them would be a colour statement about nothing.
Reach for it only where a hue would be *wrong*, never where one is hard to pick.

**`Field` is the surface and nothing else.** Eight components in six files were
also called `Field` — each a label above a control — so `<Field label="How
often">` read like the panel from the kit and no guard could tell them apart.
They are `Labelled` now, and the surface has no `label` prop on purpose.

### The kit, and when each piece applies

Everything in `src/design/ui` is here. Reach for one of these before writing a
`className` that draws a box, and if none of them fits, **add one and add it to
this list in the same commit** — four of these arrived a phase or more after
the primitives phase, each because a class string had been copied into five
files before anybody named it.

| | What it is for | Not for |
| --- | --- | --- |
| `Field` | The one panel a screen is built around, holding its hero figure. `family="none"` for the one screen whose subject is every family at once | Anything below the fold; any screen with no single hero figure — see the list above |
| `Card` | A list, a chart, a group of controls | A consequence — that is `Outcome` |
| `Tile` | One of a grid of category-coloured siblings | A single object with no siblings |
| `QuietTile` | The one slot that is about everything rather than a category | Anything with a family |
| `Outcome` | What the button below it will do, previewed before it is pressed | Anything pressable |
| `OutcomeRow` | One label-and-amount line of that arithmetic | A transaction — that is `Row` |
| `Row` | A transaction, with its category square | A form field |
| `StatStrip` / `StatCell` | The two to four figures that qualify a field's hero number | Anything on a card: the cell lifts off a *coloured* ground and is invisible on a surface |
| `MiniBar` | One proportion, under the thing it is a proportion of | A chart |
| `PillRow` | A window of time, where the whole strip is one choice | Switching panes — that is `Tabs` |
| `Ring` | A proportion, with an optional second mark for pace | A count |
| `Sparkline` | The shape of a series, at the size of a word | Anything that needs an axis |
| `Input` / `Textarea` | **All** text entry | A checkbox, radio, range or file picker |
| `Money` | **All** amounts | — |

Two rules with teeth behind them:

- **`Outcome` is sunken and has no border.** A sheet is already a surface;
  drawing a hairline box inside one is a second edge two inches from the first.
  The exception is a **selectable option**, which keeps its border — a border is
  what says *pressable* in a run of flat text, and a sunken fill on a control
  makes it read as inert. Getting that distinction wrong in either direction is
  how a system turns back into a kit.
- **No bare `<input>` or `<textarea>` in a feature.** The label beside a
  hand-written field is a `<span>` with no `htmlFor`, so a screen reader
  announces an unnamed edit box — WCAG 3.3.2 and 4.1.2. It was twenty-five
  places. `noBareInputs.test.ts` holds the line. Checkboxes, radios, ranges and
  file pickers stay bare on purpose: `Input` models a text field and none of
  that shape fits a slider or a tick.

### No prose in components

No explanatory paragraph may live in a `src/features` component. Explanations
live in `src/content/explain/` and surface behind an `<Explain>` button. Enforced
by `noProseInFeatures.test.ts`.

Copy standard: second person, active voice, present tense, reading age ~12.
Spell the arithmetic out with real numbers. Never explain the interface —
explain the money. The field manual (`src/features/manual/chapters/**`) is the
one exemption: it is long-form reference and is meant to be prose.

**A sentence an engine builds is as testable as the number it builds it from,
and needs testing just as much.** `describeFeeDrag` shipped saying "−€174.44
*less* than the same money in a tracker" to everybody whose funds were cheaper
than the comparison — most people holding index trackers. The figure it
interpolated was correct to the cent. What was wrong was the word in front of
it: `versusBaseline` is signed, and the sentence assumed a direction. 879 tests
passed over a line that told anybody with cheap funds they were doing badly.

So: where a `describe*` function's wording depends on a sign, a threshold, a
count or a plural, there is a test per branch, and each one is written to fail
against the old wording before it is kept. A test that only asserts the amount
appears in the string is not a test of the sentence.

### No tracked-out uppercase micro-labels

`.eyebrow` and `text-micro uppercase tracking-[…]` are gone. Section headings
are sentence-case `.section-title`. Before restyling a label, ask whether it
should exist at all — most of them repeat what the content beneath already says.

---

## Motion

CSS and the Web Animations API. No animation library: one cost 40 kB gzipped of
the opening bundle to do what `BottomSheet`, `SwipeRow`, `Tabs` and `Toasts`
now do in hand-written pointer physics, and a library has to guess what a drag
means where these know.

- **At most one orchestrated moment per screen, and it is the field's.** No
  card, tile or row animates in — a fade-and-slide on every container is the
  generated default and it costs the screen the one thing an entrance is for,
  which is saying where to look first. Every entrance is scoped to `.field`
  descendants, because there is never more than one field on a screen, so the
  scope makes the budget unbreakable rather than something to remember.
  `motion.test.ts` holds it.
- **Every keyframe declares only a `from`.** A keyframe list with no 100% entry
  takes the element's own computed style as the destination, so the resting
  state lives in the component where a reader can see it, there is no second
  copy in a stylesheet to drift from it, and every animation ends exactly where
  the screen would be with motion off. It is also why the ring can sweep to an
  offset computed from its own radius without the CSS knowing the number.
- **Reduced motion has to zero the delays, not only the durations.** A part
  held at `opacity: 0` by `animation-fill-mode: backwards` stays invisible for
  its delay however short the animation has been made. Measured: without
  `animation-delay: 0s !important` the second field part still waited 70ms and
  the ring 120ms. A script-created animation is not reachable by that block at
  all, which is a reason to prefer CSS rather than a footnote to it.
- **The figures do not count up.** It was the brief's first suggestion and it
  is the one animation that would put a number on screen that is not the
  person's money. Proportions are honest to animate — a ring filling to a
  position never claims a different position on the way — and digits are not.
- **`will-change` goes on `[data-presenting]`, never on the element.** A
  permanent one holds a full-screen compositor layer for the whole session, and
  it is also what makes the shell the containing block for every `fixed`
  descendant. `BottomSheet` sets the attribute one frame ahead of the
  transform: a hint that arrives in the same frame has nothing left to prepare,
  which is how this optimisation is usually written and then quietly does not
  apply.

## PWA and native-readiness

The app must stay wrappable (Capacitor / PWABuilder) without a rewrite.

- **Same-origin everything.** `Cross-Origin-Embedder-Policy: require-corp` is
  set in `vercel.json` and `public/_headers`. A Google Fonts `<link>` — or any
  CDN — is blocked outright. Self-host or inline. This is also what keeps
  `crossOriginIsolated` true, without which SQLite's OPFS VFS has no fallback.
- **No `vh` / `dvh` anywhere.** In an iOS home-screen app with a translucent
  status bar, `100dvh` comes back one status-bar inset short of the real web
  view. `html`, `body` and `#app-shell` are pinned with `position: fixed;
  inset: 0`. The comment in `tokens.css` has the full story; keep it.

  The guard used to check those three selectors, which were the three places
  somebody had already fixed. Six `dvh` survived inside the shell, and one was
  the same defect one level down: the sheet sized itself `calc(100dvh - 3.5rem)`
  inside a parent that is `fixed inset-0` and therefore already the viewport,
  so a tall sheet stopped a status bar lower than asked. `tokens.test.ts` now
  reads every file in `src`, comments stripped.
- **`backdrop-filter` unprefixed only.** Writing the standard and `-webkit-`
  properties as a pair makes the production minifier collapse them to the
  prefixed one alone, which Chromium does not support — the dock shipped with
  no blur at all. The build adds prefixes from its own targets.
- **44×44pt minimum** on every interactive target, info buttons included. Pad
  the hit area; do not grow the glyph. `.target` in `tokens.css` does it with a
  pseudo-element, so the layout box stays the glyph's size and no per-site
  arithmetic is needed; `.target-y` grows only the vertical axis, for a control
  inside another pressable thing where 44px sideways would reach into its
  parent.

  Two things this cost, both of them measured rather than noticed:

  - **An expanded hit area needs a z-index.** Expanding means overflowing a
    layout slot, and whatever comes next in the document owns the overflow.
    `Explain` had a 44×44 box, a class that said 44, and a hit area of 44×37,
    because the caption paragraph after it painted over the bottom seven
    pixels. See A2 in `AUDIT.md`.
  - **A scroll container clips it.** `overflow-x: auto` forces the other axis
    to `auto` as well, so a pill strip cuts its own children's hit areas back
    to the pills' drawn height. The fix is a `py`/`-my` pair on the container:
    padding for the overflow to land in, negative margin to give it back to the
    layout.

  A class saying 44 is not a target measuring 44. `targets.test.ts` holds the
  static half; the browser sweep in its header comment is what finds a new
  kind.
- **No hover-only affordances.** Anything reachable only on `:hover` is
  unreachable on a phone.
- **Status bar follows the theme** — `default` under Daylight,
  `black-translucent` under Midnight, set in the same pre-paint script as
  `theme-color`.
- Keep OPFS and the SQLite worker. Do not make any core flow depend on an API
  absent from WKWebView (Web Bluetooth, Web Share Target, Background Sync).

## Accessibility

Every affordance that exists today stays. Add more, remove none.

- `focus-visible` rings on everything interactive.
- Every swipe action also exists as a real focusable button — a swipe is
  unreachable by keyboard and by switch control.
- `role="progressbar"` on pacing bars and the onboarding progress.
- Sheets trap focus and hand it back on close; `aria-modal` alone does not stop
  Tab leaving.
- `prefers-reduced-motion` disables all motion.
- Inputs stay at 16px minimum, or iOS zooms the viewport on focus.
- Compute contrast, never eyeball it. `tokens.test.ts` asserts AA for every
  ink-on-surface pair in both themes.

---

## Code style

- Comments explain **why**, not what. Match the density and voice of the file
  you are in. A comment recording a decision that was expensive to reach is
  worth more than the code it sits above — do not delete one to tidy up.
- No `any`, no `@ts-expect-error`, no disabled lint rules to get past a problem.
  Fix the problem.
- No `TODO`, no `FIXME`, no placeholder copy, no stubbed implementations.
- Prefer deleting a thing to leaving it unused.

## Attribution

End commit messages with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
