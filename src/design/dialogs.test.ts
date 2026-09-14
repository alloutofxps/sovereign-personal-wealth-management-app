/* ===========================================================================
 * THE DIALOG CONTRACT
 * ---------------------------------------------------------------------------
 * Phase 8 found two dialogs failing the same three-part contract, in different
 * ways, and neither was visible to any gate:
 *
 *  · `BottomSheet`'s focus effect read `sheetRef.current` and depended on
 *    `[open]`. On the render where `open` first becomes true, `present` is
 *    still false, so the portal is not in the tree and the ref is null: the
 *    effect returned before moving focus AND before installing the Tab
 *    handler, and never re-ran. Measured, three sheets, cold open versus
 *    re-open inside the 260ms exit window: false → true every time. So on the
 *    only path that normally runs, `aria-modal="true"` was telling assistive
 *    technology the page was inert while the browser was still free to move
 *    focus into it.
 *
 *  · `FirstFlightWizard` — the first screen anybody sees — had `role="dialog"
 *    aria-modal="true"` and no name, no focus move and no trap at all. The
 *    first three tabbable elements in the document were on the dashboard
 *    behind it.
 *
 * A source scan cannot check "focus is inside the dialog"; that was measured
 * in the browser and is written down above. What it can check is that the
 * three mechanisms are present and wired to the right things, which is what
 * went missing. Both, not either.
 * ======================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const SHEET = readFileSync(join(SRC, 'design', 'ui', 'BottomSheet.tsx'), 'utf8');
const WIZARD = readFileSync(join(SRC, 'features', 'onboarding', 'FirstFlightWizard.tsx'), 'utf8');

/** The body of the effect that owns focus, from its comment to its deps. */
function focusEffect(source: string): string {
  const at = source.indexOf('previouslyFocused');
  expect(at, 'the focus effect is gone').toBeGreaterThan(-1);
  const close = source.indexOf('}, [', at);
  return source.slice(at, source.indexOf(']);', close) + 3);
}

describe('BottomSheet owns focus from the render the portal exists', () => {
  it('depends on `present`, not only on `open`', () => {
    const deps = /}, \[([^\]]*)\]\);/.exec(focusEffect(SHEET));
    expect(deps, 'the focus effect has no dependency array').not.toBeNull();
    const listed = deps![1]!.split(',').map((d) => d.trim());
    expect(listed).toContain('open');
    expect(
      listed,
      '`open` alone runs the effect one render before the portal exists, so it returns early and never re-runs',
    ).toContain('present');
  });

  it('still returns early when there is no element, rather than throwing', () => {
    expect(SHEET).toMatch(/const sheet = sheetRef\.current;\s*\n\s*if \(!sheet\) return;/);
  });

  it('installs the Tab handler in the same effect as the focus move', () => {
    const body = focusEffect(SHEET);
    // If these ever separate, one of them can run while the other does not,
    // which is the shape of the defect this file exists for.
    expect(body).toMatch(/\.focus\(\)/);
    expect(body).toMatch(/addEventListener\('keydown'/);
    expect(body).toMatch(/event\.key !== 'Tab'/);
  });

  it('hands focus back to whatever opened it', () => {
    expect(focusEffect(SHEET)).toMatch(/previouslyFocused\?\.focus\?\.\(\)/);
  });
});

describe('the sheet can be closed without a gesture', () => {
  /*
   * The drag handle was a `div` with pointer handlers. Dismissal was a swipe,
   * a backdrop tap, or Escape — and `CLAUDE.md`'s own rule is that every swipe
   * action also exists as a real focusable button, because a swipe is
   * unreachable by keyboard and by switch control. Escape is not available to
   * switch control either.
   */
  it('makes the handle a real button with a name', () => {
    const handle = SHEET.slice(SHEET.indexOf('The handle owns the gesture'));
    const tag = handle.slice(0, handle.indexOf('>'));
    expect(tag, 'the handle is not a button').toMatch(/<button/);
    expect(tag).toMatch(/aria-label=\{dismissible \? 'Close'/);
    expect(tag).toMatch(/onClick=/);
  });

  it('does not close on the click that ends a drag', () => {
    // A press that travelled is the end of a gesture `endDrag` already ruled
    // on; only a press that went nowhere is a press of the close button.
    expect(SHEET).toMatch(/if \(travelled\.current\) return;/);
    expect(SHEET).toMatch(/travelled\.current = true/);
    expect(SHEET).toMatch(/travelled\.current = false/);
  });
});

describe('the first-run overlay is a dialog rather than looking like one', () => {
  const tag = WIZARD.slice(WIZARD.indexOf('role="dialog"') - 420, WIZARD.indexOf('role="dialog"') + 220);

  it('has an accessible name', () => {
    expect(
      tag,
      'a role=dialog with aria-modal and no name announces as "dialog" and nothing else',
    ).toMatch(/aria-label="[^"]{4,}"|aria-labelledby=/);
  });

  it('can hold focus', () => {
    expect(tag).toMatch(/tabIndex=\{-1\}/);
    expect(tag).toMatch(/ref=\{dialogRef\}/);
  });

  it('takes focus on arrival and on every step', () => {
    // Keyed on the step index, because each step replaces the whole body and
    // landing on the container is what gets the new one read out.
    expect(WIZARD).toMatch(/dialogRef\.current\?\.focus\(\);\s*\n\s*\}, \[index\]\);/);
  });

  it('keeps Tab inside itself', () => {
    expect(WIZARD).toMatch(/event\.key !== 'Tab'/);
    expect(WIZARD).toMatch(/dialog\.contains\(document\.activeElement\)/);
  });
});

describe('the storage warning looks at both fields', () => {
  const SHELL = readFileSync(join(SRC, 'features', 'shell', 'AppShell.tsx'), 'utf8');

  /*
   * `durable` is "in OPFS rather than in RAM"; `persisted` is "the browser has
   * promised not to delete it". The bar was gated on the first alone, so the
   * only state it warned about was the one where data goes on a tab close, and
   * it stayed silent on the one where data goes on a low-disk moment.
   *
   * Measured in phase 8: `navigator.storage.persisted()` false, `[role=status]`
   * empty on all sixteen routes, and the seeded database destroyed between two
   * sessions with no warning at any point.
   */
  it('warns when storage is not durable', () => {
    expect(SHELL).toMatch(/if \(!storage\.durable\) return storage\.explanation;/);
  });

  it('also warns when the browser has not promised to keep the data', () => {
    expect(SHELL, 'the evictable case was the silent one').toMatch(/if \(!storage\.persisted\)/);
  });

  it('says nothing when there is nothing to say', () => {
    const fn = SHELL.slice(SHELL.indexOf('function storageWarning'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/return null;/);
  });

  it('names the fix rather than only the worry', () => {
    expect(SHELL).toMatch(/Settings can ask it to/);
  });
});
