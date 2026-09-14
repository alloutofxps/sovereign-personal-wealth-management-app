/* ===========================================================================
 * 44×44
 * ---------------------------------------------------------------------------
 * A sweep of every focusable element on all sixteen screens found 142 targets
 * under 44px. None of them looked wrong: they were the sizes somebody had
 * chosen, and the hit area is invisible.
 *
 * This is the static half of that sweep. It reads each pressable tag, works
 * out the box it pins on itself, and requires `.target` or `.target-y` on
 * anything that pins itself small. It cannot measure a hit area -- the suite
 * runs under node with no DOM, and the two things the browser sweep found that
 * no static check could are worth writing down:
 *
 *   · `Explain` had a 44×44 box, a class saying 44, and a hit area of 44×37,
 *     because the negative margin made it overflow its slot and the caption
 *     paragraph after it painted over the bottom seven pixels. See A2 in
 *     AUDIT.md. That is why `.target` carries a z-index.
 *   · A `Chip` is 32px tall and the button inside it was 18px, so the top and
 *     bottom of something that plainly looks pressable did not answer. Nothing
 *     about either element's own classes was wrong.
 *
 * So this guard stops the 142 coming back, and the browser sweep stays the
 * thing that finds a new kind. Both, not either.
 * ======================================================================== */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Tailwind's spacing scale is 4px a step. */
const STEP = 4;
const MINIMUM = 44;

function files(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, found);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Every opening tag in a file, as the text from `<` to its own `>`.
 *
 * Brace-aware, because a JSX attribute holds arbitrary expressions and a `>`
 * inside one (`onClick={() => x > 1}`) is not the end of the tag. Quote-aware
 * for the same reason.
 */
function openingTags(source: string): { line: number; name: string; body: string }[] {
  const out: { line: number; name: string; body: string }[] = [];
  for (const match of source.matchAll(/<([A-Za-z][A-Za-z0-9]*)/g)) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote: string | null = null;
    while (i < source.length) {
      const c = source[i]!;
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      } else if (c === '>' && depth === 0) {
        break;
      }
      i += 1;
    }
    out.push({
      line: source.slice(0, match.index).split('\n').length,
      name: match[1]!,
      body: source.slice(match.index, i),
    });
  }
  return out;
}

/** The extent this tag pins on one axis in px, or null if it pins none. */
function pinned(body: string, axis: 'y' | 'x'): number | null {
  const both = /\bsize-(\d+)\b/.exec(body);
  if (both) return Number(both[1]) * STEP;
  const letter = axis === 'y' ? 'h' : 'w';
  const direct = new RegExp(`\\b(?:min-)?${letter}-(\\d+)\\b`).exec(body);
  return direct ? Number(direct[1]) * STEP : null;
}

/** Padding on one axis, both sides. Counted, so `h-6 py-3` is 48 and passes. */
function padding(body: string, axis: 'y' | 'x'): number {
  const both = /\bp-(\d+)\b/.exec(body);
  if (both) return Number(both[1]) * STEP * 2;
  const side = new RegExp(`\\bp${axis === 'y' ? 'y' : 'x'}-(\\d+)\\b`).exec(body);
  return side ? Number(side[1]) * STEP * 2 : 0;
}

function isPressable(name: string, body: string): boolean {
  if (name === 'button' || name === 'a') return true;
  return body.includes('onClick') || body.includes('role="button"');
}

/** These are not pressable boxes and `Input` does not model them. */
const NOT_A_PRESSABLE_BOX = /type\s*=\s*["'{]?\s*(checkbox|radio|range|file|hidden)\b/;

/**
 * The one shape that cannot reach 44 and the reason it cannot.
 *
 * A member of a segmented control is bounded by the height of the control it
 * is inside. `Tabs` is a 38px track — 30px tabs in 4px of padding — and it is
 * a scroll container, so a hit area cannot overflow it either: overflow clips
 * at the padding box, which puts a hard ceiling of 38px on any target in
 * there. Reaching 44 means the strip becomes 52px, which is a visible change
 * to the app's most prominent navigation control and not a phase 7 decision.
 *
 * Measured: 30×N, against WCAG 2.2 AA's 24×24 floor (2.5.8, met) and AAA's
 * 44×44 (2.5.5, not met). A mis-tap selects a neighbouring pane, which is
 * reversible and visible.
 */
const KNOWN_CEILING = [join('design', 'ui', 'Tabs.tsx')];

describe('every pressable target is 44px or asks for a hit area', () => {
  const offenders: string[] = [];
  let pressables = 0;

  for (const file of files(SRC)) {
    const source = readFileSync(file, 'utf8');
    const relative = file.slice(SRC.length);
    for (const { line, name, body } of openingTags(source)) {
      if (!isPressable(name, body)) continue;
      if (NOT_A_PRESSABLE_BOX.test(body)) continue;
      pressables += 1;
      if (/\btarget(?:-y)?\b/.test(body)) continue;
      if (KNOWN_CEILING.some((known) => relative.endsWith(known))) continue;

      const height = pinned(body, 'y');
      const width = pinned(body, 'x');
      if (height !== null && height + padding(body, 'y') < MINIMUM) {
        offenders.push(`${relative}:${line}  pins ${height + padding(body, 'y')}px tall`);
      } else if (height === null && width !== null && width + padding(body, 'x') < MINIMUM) {
        offenders.push(`${relative}:${line}  pins ${width + padding(body, 'x')}px wide`);
      }
    }
  }

  it('finds pressable tags at all, or it is guarding nothing', () => {
    expect(pressables).toBeGreaterThan(100);
  });

  it('leaves no pressable element pinning itself under 44px without a hit area', () => {
    expect(
      offenders,
      'add `target` (or `target-y` inside another pressable thing) — see THE HIT AREA in tokens.css',
    ).toEqual([]);
  });
});

describe('nothing is reachable only with a pointer', () => {
  /**
   * A `hover:` variant that changes *visibility* hides an affordance from
   * every phone, every keyboard and every switch control. Colour and border
   * changes on a control that is already visible are decoration and fine.
   */
  const REVEALS = /hover:(?:opacity-(?:[1-9]\d|100)|visible|block|flex|grid|inline)/;

  it('uses no hover variant that reveals something', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((row, index) => {
          if (REVEALS.test(row)) offenders.push(`${file.slice(SRC.length)}:${index + 1}`);
        });
    }
    expect(offenders, 'an affordance behind :hover does not exist on a phone').toEqual([]);
  });

  it('keeps the swipe row’s buttons reachable by focus rather than by pointer', () => {
    const swipe = readFileSync(join(SRC, 'design', 'ui', 'SwipeRow.tsx'), 'utf8');
    // Hidden until focused, not until hovered. A gesture alone is unreachable
    // by keyboard and by switch control, so the buttons are the real control.
    expect(swipe).toMatch(/focus-within:opacity-100/);
    expect(swipe).not.toMatch(/hover:opacity-100/);
  });
});
