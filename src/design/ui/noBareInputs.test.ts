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

/**
 * Is this tag inside a `<label>`?
 *
 * Looks back for an opening `<label` with no `</label>` between it and here.
 * Crude, and the alternative is a JSX parser for one question.
 */
function wrappedInLabel(source: string, at: number): boolean {
  const before = source.slice(0, at);
  const open = before.lastIndexOf('<label');
  if (open === -1) return false;
  return !before.slice(open).includes('</label>');
}

/** From `<` to the `>` that closes it, ignoring any inside braces or quotes. */
function wholeTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i]!;
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    } else if (c === '>' && depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
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

/* ===========================================================================
 * AND THE EXEMPT ONES STILL NEED A NAME
 * ---------------------------------------------------------------------------
 * The exemption above is from `Input`, not from WCAG 4.1.2. It was written
 * about the primitive — `Input` models a text field and none of a slider, a
 * tick or a file picker fits that shape — and it was read as an exemption from
 * everything.
 *
 * Phase 8 swept the accessible name of every interactive element on all
 * sixteen routes and inside eleven sheets, computing it the way assistive
 * technology does: aria-label, then aria-labelledby, then label[for], then a
 * wrapping label, then title. Exactly two controls came back with nothing:
 *
 *   settings/DataAndSecurity.tsx  <input type="file" class="sr-only">
 *   triage/ImportSheet.tsx        <input type="file" class="sr-only">
 *
 * Both `sr-only`: invisible and fully exposed to AT, so the name is not a
 * nicety — it is the whole of what the control announces.
 * ======================================================================== */

describe('every input carries a name, exempt from the primitive or not', () => {
  const files = sourceFiles(SRC).filter((file) => !PRIMITIVES.some((p) => file.endsWith(p)));

  it('finds no input without a name a screen reader could read', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

      for (const match of code.matchAll(/<input\b/g)) {
        // The whole tag, brace-aware. A non-greedy match to the first `>`
        // stops inside `onChange={(e) => …}` and hides every attribute after
        // it, which is how five named controls looked unnamed on the first
        // run of this check.
        const tag = wholeTag(code, match.index);
        // These three have no accessible name of their own and need none: a
        // submit or reset button is named by its value, and a hidden input is
        // not exposed at all.
        if (/\btype\s*=\s*["']?(submit|reset|hidden)\b/.test(tag)) continue;

        const named =
          /aria-label\s*=/.test(tag) ||
          /aria-labelledby\s*=/.test(tag) ||
          // An `id` can only be naming it through a `label[for]`, which is the
          // association `Input` itself uses.
          /\bid\s*=/.test(tag) ||
          /placeholder\s*=/.test(tag) ||
          // A `<label>` wrapping the control names it, which is the
          // association the runtime sweep counted and these five use.
          wrappedInLabel(code, match.index);

        if (!named) {
          const line = code.slice(0, match.index).split('\n').length;
          offenders.push(`${relative(file)}:${line}  ${tag.replace(/\s+/g, ' ').slice(0, 56)}`);
        }
      }
    }

    expect(
      offenders,
      'An input with no aria-label, no id and no placeholder announces as an ' +
        'unnamed control. `sr-only` makes it worse, not exempt.',
    ).toEqual([]);
  });
});
