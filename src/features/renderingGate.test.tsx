// @vitest-environment happy-dom

/* ===========================================================================
 * THE RENDERING GATE
 * ---------------------------------------------------------------------------
 * The G1 analysis in `AUDIT.md` established that **no test in this repository
 * mounted a React component**. Not by omission — by construction: no test
 * imported a renderer or a DOM, and `vitest.config.ts` sets
 * `environment: 'node'`. Every property of a rendering was therefore outside
 * the suite, and that is the hole the three worst defects in this project went
 * through:
 *
 *   P1  the first screen anybody sees was an unnamed modal that never took
 *       focus and never trapped Tab
 *   P2  no sheet in the app had ever trapped focus on a cold open, because the
 *       effect that installs the trap read a ref one render before the portal
 *       existed and depended only on `open`
 *   P3  an empty ledger was told it had reached financial independence
 *
 * All three passed typecheck, 981 tests and lint, in every phase, every time.
 *
 * This file is **three tests, not a suite.** One per severity 1, deliberately.
 * A testing programme started at the end of a redesign is a different project;
 * what was wanted here is a foothold that proves the class is reachable, and
 * a regression test for each defect that proved it was not.
 *
 * Each one is verified by breaking it. The scaffolding — a DOM per file, a
 * store that survives it — is the cost of entry; the next test of this kind
 * costs a `render()` call.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS IN `src/features` AND NOT `src/design`
 *
 * It started in `src/design` and eslint refused it: the layering rule says
 * design may not import from features, and two of these three tests mount a
 * feature. That is the rule working — the fix is the file's address, not an
 * exemption. `features` is the top of the stack and may import everything
 * below it, which is exactly what a test spanning the two layers needs.
 *
 * ---------------------------------------------------------------------------
 * WHY `happy-dom` AND NOT `jsdom`
 *
 * It is roughly a tenth of the install and implements what a focus trap needs:
 * `activeElement`, `focus()`, `contains`, and event dispatch. Neither does
 * layout, so geometry stays a browser measurement — see M2 in `AUDIT.md` for
 * what that costs and how to calibrate it.
 * ======================================================================== */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { BottomSheet } from '@/design/ui';
import { minor, basisPoints } from '@/core/money';
import { projectFire } from '@/core/simulate';
import { FirstFlightWizard } from '@/features/onboarding/FirstFlightWizard';
import { IndependenceView } from '@/features/simulations/IndependenceView';

afterEach(cleanup);

/**
 * The shell the recede looks for.
 *
 * `setShellReceded` reaches for `#app-shell` by id and returns quietly when it
 * is not there, so the sheet works without it — but the attribute sequence is
 * part of what these tests are about, so it exists.
 */
function withShell(): HTMLElement {
  const shell = document.createElement('div');
  shell.id = 'app-shell';
  document.body.appendChild(shell);
  return shell;
}

/* ===========================================================================
 * 1. P2 — a cold-open sheet takes focus and keeps it
 * ---------------------------------------------------------------------------
 * COLD specifically. On a warm re-open — within the 260ms the sheet stays
 * mounted after closing — `present` is already true, the portal is in the
 * tree, and the effect worked. That is why the defect survived: every manual
 * check of "does the sheet take focus" that happened to re-open a sheet said
 * yes. The measurement that found it opened three sheets cold and then again
 * warm, and got false then true every time.
 *
 * A cold open here means the component mounts with `open` false and is then
 * told to open, which is what every caller in the app does.
 * ======================================================================== */

describe('a sheet opened cold takes focus and traps Tab', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        <button type="button">Behind the backdrop</button>
        <BottomSheet open={open} onClose={() => setOpen(false)} title="How much did you spend?">
          <button type="button">First inside</button>
          <button type="button">Last inside</button>
        </BottomSheet>
      </>
    );
  }

  it('moves focus inside on the first open, not only on a re-open', async () => {
    withShell();
    const { getByText, findByRole } = render(<Harness />);

    // Nothing is open, so nothing is focused inside anything.
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.click(getByText('Open it'));
    const dialog = await findByRole('dialog');

    expect(
      dialog.contains(document.activeElement),
      'focus stayed outside an aria-modal dialog on the open path every caller uses',
    ).toBe(true);
  });

  it('pulls focus back in when it is outside, which is what aria-modal promises', async () => {
    withShell();
    const { getByText, findByRole } = render(<Harness />);
    fireEvent.click(getByText('Open it'));
    const dialog = await findByRole('dialog');

    // Put focus on a control behind the backdrop, the way a browser will if
    // nothing stops it, then press Tab.
    const behind = getByText('Behind the backdrop');
    behind.focus();
    expect(dialog.contains(document.activeElement)).toBe(false);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(
      dialog.contains(document.activeElement),
      'Tab from behind the backdrop left focus on a control the person cannot see',
    ).toBe(true);
  });

  it('wraps from the last control back to the first', async () => {
    withShell();
    const { getByText, findByRole } = render(<Harness />);
    fireEvent.click(getByText('Open it'));
    const dialog = await findByRole('dialog');

    const last = getByText('Last inside');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });

  it('gives the sheet a name from its own title', async () => {
    withShell();
    const { getByText, findByRole } = render(<Harness />);
    fireEvent.click(getByText('Open it'));
    const dialog = await findByRole('dialog');

    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('How much did you spend?');
  });
});

/* ===========================================================================
 * 2. P1 — the first screen anybody sees
 * ---------------------------------------------------------------------------
 * `FirstFlightWizard` had `role="dialog" aria-modal="true"` and no name, no
 * focus move and no trap at all. Measured on a fresh database, the first three
 * tabbable elements in the document were `Add a bill`, `Add a payment` and
 * `Home` — the dashboard, behind an opaque overlay that had just told
 * assistive technology the rest of the page was inert.
 *
 * The wizard writes to the database on finish, so the repositories are stubbed
 * out. What is under test is the dialog contract, not the writes.
 * ======================================================================== */

vi.mock('@/data/repositories/onboardingRepo', () => ({
  markOnboardingComplete: () => Promise.resolve(),
  isOnboardingComplete: () => Promise.resolve(false),
}));

describe('the first-run overlay is a dialog in behaviour, not only in markup', () => {
  it('has a name, takes focus, and brings Tab back in', async () => {
    const behind = document.createElement('button');
    behind.textContent = 'On the dashboard behind it';
    document.body.appendChild(behind);

    const { findByRole } = render(<FirstFlightWizard onFinished={() => {}} />);
    const dialog = await findByRole('dialog');

    expect(
      dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby'),
      'an aria-modal dialog with no name announces as "dialog" and nothing else',
    ).toBeTruthy();

    expect(
      dialog.contains(document.activeElement),
      'focus was on document.body, outside a region declared inert',
    ).toBe(true);

    behind.focus();
    expect(dialog.contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(
      dialog.contains(document.activeElement),
      'Tab reached the dashboard behind an opaque overlay',
    ).toBe(true);
  });
});

/* ===========================================================================
 * 3. P3 — an empty ledger is not financial independence
 * ---------------------------------------------------------------------------
 * `targetFor(0)` is 0 and `reached` was `invested >= target`, so `0 >= 0`. The
 * screen said "Enough to stop, living as you do now — You are there" above
 * "What it takes €0".
 *
 * There is an engine test for this in `forecast.test.ts`. This is the *screen*
 * test, and it exists because the first fix was only half a fix: after the
 * hero was corrected the milestone pills still read "already there", since
 * `reached` was now false and they fell through to `describeWhen(0)`. The
 * engine was right and the screen was still wrong, which is the one thing an
 * engine test cannot tell you.
 *
 * Verified by breaking both sides, and the result is worth writing down:
 * reverting the milestone pill fails this test, and reverting the ENGINE fix
 * does not. The view now checks `isUnknown` before it looks at `reached`, so
 * it is defended independently of the engine — which is right, and means the
 * two need their own tests rather than one standing in for the other. The
 * engine arm lives in `forecast.test.ts` and was verified there.
 * ======================================================================== */

vi.mock('@/app/forecast/useForecast', () => ({
  useForecast: () => ({ data: null, error: null }),
}));

describe('an empty ledger is not told it can stop working', () => {
  it('claims nothing on any surface of the screen', async () => {
    // The engine's own answer for an empty ledger, so the test and the app are
    // reading the same input.
    const empty = projectFire({
      invested: minor(0),
      monthlyContribution: minor(0),
      annualSpending: minor(0),
      realReturn: basisPoints(500),
      withdrawalRate: basisPoints(400),
    });
    expect(empty.milestones.every((x) => x.target === 0)).toBe(true);

    const { container } = render(<IndependenceView />);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');

    expect(text, 'the screen exists to answer this and it must not guess').toContain(
      'When you could stop',
    );
    expect(text, 'a false claim about somebody’s money').not.toMatch(/You are there/);
    expect(text, 'the milestone pill made the same claim after the hero was fixed').not.toMatch(
      /already there/i,
    );
    expect(text).not.toMatch(/\bReached\b/);
    expect(text).toMatch(/Not yet known|Nothing to go on/);
  });
});
