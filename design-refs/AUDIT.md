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

The two Sankey notes in `SankeyFlow.tsx` are the shape this should take: they
carry the ΔE table they were derived from, so a later reader can check the
conclusion against the numbers rather than against the confidence.

**Not a one-off.** Phase 5 also carried a claim that bare `<input>`s lost the
16px iOS-zoom floor. Checking it before writing the guard showed the floor is a
base-layer rule on the elements themselves, so bare controls were never at risk
— and checking it is what turned up A1, which is considerably worse. Both cases
point the same way: the cheapest moment to test a recorded cause is immediately
before relying on it.

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

**Found in phase 7. Pre-existing from phases 4a–4d. Not fixed — out of a
motion phase's scope, and recorded here rather than acted on.**

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
