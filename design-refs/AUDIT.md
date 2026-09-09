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

*None recorded yet. Phase 8 sweeps for these.*

---

## Severity 3

*None recorded yet.*

---

## Severity 4

*None recorded yet.*
