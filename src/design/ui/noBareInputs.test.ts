/* ===========================================================================
 * NO BARE TEXT-ENTRY CONTROLS
 * ---------------------------------------------------------------------------
 * A `<input type="text">` written by hand in a feature is not a shortcut, it is
 * an unlabelled field.
 *
 * Twenty-one of them had grown across the app, each sitting inside a local
 * `Field` wrapper that renders the label as a bare `<span>`:
 *
 *     <Field label="What is it called?">
 *       <input type="text" value={name} className="w-full rounded-md …" />
 *     </Field>
 *
 * There is no `htmlFor` and no `id` anywhere in that. Tapping the label does
 * not focus the field, and a screen reader announces an edit box with no name —
 * WCAG 3.3.2 and 4.1.2, in twenty-one places. `Input` and `Textarea` generate
 * the id, wire the label to it, and wire `aria-describedby` to the hint or the
 * error so a message is announced rather than left as decoration beside a box.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT CLAIM
 *
 * Not the iOS zoom. `tokens.css` puts `font-size: max(16px, var(--text-body))`
 * on the `input`, `textarea` and `select` elements themselves, so a bare
 * control clears the 16px threshold exactly as the primitive does. Nor the
 * focus ring: `:focus-visible` is a base-layer rule and applies to everything.
 * Both were checked before this guard was written, because a guard justified by
 * a defect it does not actually prevent is worse than no guard.
 *
 * What is genuinely lost is the label association, the error wiring, and the
 * fill and border drifting from the rest of the app's fields.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ALLOWED, AND WHY
 *
 * Checkboxes, radios, ranges and file pickers stay bare. `Input` models a text
 * field: it has a label above a bordered box with a message under it, and none
 * of that shape fits a slider or a tick. They are different controls, not
 * unstyled versions of this one, and pretending otherwise would produce a
 * component whose props contradict each other.
 *
 * Those nine remain hand-written on purpose. If a `Checkbox` or a `Slider`
 * primitive is ever wanted, it is a new component and a new rule here — not a
 * flag on this one.
 * ======================================================================== */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The primitives themselves, which have to contain the element they wrap.
 *
 * `Numpad` is here because it is a keypad rather than a text field: it renders
 * its own buttons and a hidden control, and routing it through `Input` would
 * mean an on-screen keyboard opening over the keypad.
 */
const PRIMITIVES = [
  join('design', 'ui', 'Input.tsx'),
  join('design', 'ui', 'Textarea.tsx'),
  join('design', 'ui', 'Numpad.tsx'),
  join('design', 'ui', 'Select.tsx'),
];

/** Control types `Input` does not model. See the header. */
const NOT_A_TEXT_FIELD = /type\s*=\s*["'{]?\s*(checkbox|radio|range|file|color|submit|reset|button|hidden)\b/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) found.push(full);
  }
  return found;
}

const relative = (file: string) => file.slice(SRC.length + 1).split(sep).join('/');

describe('text entry goes through the primitive', () => {
  const files = sourceFiles(SRC).filter(
    (file) => !PRIMITIVES.some((p) => file.endsWith(p)),
  );

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no hand-written text input or textarea', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

      // The whole opening tag, so `type` is found wherever it sits in it.
      for (const match of code.matchAll(/<(input|textarea)\b[\s\S]*?\/?>/g)) {
        const tag = match[0];
        if (match[1] === 'input' && NOT_A_TEXT_FIELD.test(tag)) continue;
        const line = code.slice(0, match.index).split('\n').length;
        offenders.push(`${relative(file)}:${line}  <${match[1]} …>`);
      }
    }

    expect(
      offenders,
      'Use <Input> or <Textarea>. A bare field has no label association: the ' +
        'label beside it is a span, so a screen reader announces an unnamed box',
    ).toEqual([]);
  });
});
