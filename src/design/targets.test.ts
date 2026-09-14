/* ===========================================================================
 * 44×44
 * ---------------------------------------------------------------------------
 * A sweep of every focusable element on all sixteen screens found 142 targets
 * under 44px. None of them looked wrong: they were the sizes somebody had
 * chosen, and the hit area is invisible.
 *
 * This is the static half of that sweep, and the half is worth being precise
 * about. It reads each pressable tag, works out the box it *pins* on itself,
 * and requires `.target` or `.target-y` on anything that pins itself small.
 *
 * It therefore does not see a control whose height comes from its text — a tab,
 * an inline link — because there is no number in the markup to compare against
 * 44. Flagging those would mean estimating a line height, and an estimate
 * standing in for a measurement is what M1 in AUDIT.md exists to warn about.
 * Applying `.target` to all 54 of them unconditionally was the alternative and
 * is worse: the utility brings a full-size pseudo-element, and on a container
 * with nested interactive children it would cover them. A measured 44px is not
 * worth an unmeasured dead button.
 *
 * What covers those is the browser sweep in the comment below, plus a direct
 * assertion on any structure a fix depends on — see the segmented control at
 * the foot of this file.
 *
 * The two things the browser sweep found that no static check could:
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

/* There is no exemption list, and that is deliberate.
 *
 * `Tabs` was on one for a day. A member of a segmented control is bounded by
 * the height of the control it sits in, and the control is a scroll container,
 * so the hit area was clipped at 38px and the only apparent way out was a
 * taller strip. The way out was to move the scrolling to a wrapper: the track
 * keeps its 38px box and the wrapper carries the 3px of padding a 44px target
 * needs. Nothing in the app cannot reach 44.
 *
 * So an empty exemption list would be worse than none, because the next thing
 * added to it would inherit a precedent that was itself a missed fix.
 */
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

/* ===========================================================================
 * THE SEGMENTED CONTROL
 * ---------------------------------------------------------------------------
 * `Tabs` reaches 44px by a structure rather than by a number, so the number is
 * not what there is to check. Three things hold it up, and losing any one of
 * them puts the strip silently back to a 30px target:
 *
 *  · The scroll container is a WRAPPER, not the track. `overflow-x: auto`
 *    forces the other axis to `auto` too, so whichever element scrolls clips
 *    its children vertically at its own padding box.
 *  · That wrapper carries 3px of vertical padding for the hit area to overflow
 *    into, and -3px of margin so the padding costs the layout nothing.
 *  · The track carries `w-max min-w-full`, because a background on the scroll
 *    container used to cover the scrolled-out tabs for free and now has to be
 *    asked to.
 * ======================================================================== */

describe('the segmented control keeps the structure its 44px depends on', () => {
  const TABS = readFileSync(join(SRC, 'design', 'ui', 'Tabs.tsx'), 'utf8');

  it('puts the scrolling on a wrapper rather than on the track', () => {
    const scroller = TABS.indexOf('ref={scrollRef}');
    const track = TABS.indexOf('role="tablist"');
    expect(scroller, 'the wrapper is gone').toBeGreaterThan(-1);
    expect(track, 'the track is gone').toBeGreaterThan(-1);
    expect(scroller, 'the track must be inside the scroller').toBeLessThan(track);

    // And the track must not scroll, or it clips again.
    const trackTag = TABS.slice(track, TABS.indexOf('>', TABS.indexOf('className', track)));
    expect(trackTag).not.toMatch(/overflow-x-auto/);
  });

  it('gives the wrapper the padding a 44px target needs, and takes it back', () => {
    const scroller = TABS.slice(TABS.indexOf('ref={scrollRef}'), TABS.indexOf('role="tablist"'));
    expect(scroller).toMatch(/overflow-x-auto/);
    // 30px tab + 4px of track padding either side = 38px; 44 needs 3px more.
    expect(scroller, 'no room for the hit area to overflow into').toMatch(/py-\[3px\]/);
    expect(scroller, 'the padding has to cost the layout nothing').toMatch(/-my-\[3px\]/);
  });

  it('keeps the track’s fill under the tabs when they scroll', () => {
    const track = TABS.slice(TABS.indexOf('role="tablist"'), TABS.indexOf('{indicator'));
    expect(track, 'w-max is what makes the fill as wide as the tabs').toMatch(/w-max/);
    expect(track, 'min-w-full is what keeps flex-1 sharing the space').toMatch(/min-w-full/);
  });

  it('asks for the hit area on the tab itself', () => {
    expect(TABS.slice(TABS.indexOf('role="tab"'))).toMatch(/'target press relative/);
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

  /**
   * A tap leaves the element in `:hover` on iOS until something else is
   * touched, so the last thing pressed stays lit. `Numpad` found that and its
   * comment says so; `[@media(hover:hover)]` is the gate, and 57 declarations
   * across 37 files did not have it.
   *
   * Every hover style, not only the background fills. A sticky underline or a
   * sticky text colour is the same mechanism with a quieter symptom, and a rule
   * with an exception for the quiet ones is a rule nobody can check.
   *
   * Asserted empty rather than pinned to a count. A guard that says "no more
   * than seventeen" reads green while nothing is fixed.
   */
  it('gates every hover style behind a device that has a pointer', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((row, index) => {
          // Hide the gated ones and the media query's own text, then see what
          // `hover:` is left standing on its own.
          const bare = row
            .replace(/\[@media\(hover:hover\)\]:hover:/g, ' ')
            .replace(/@media\s*\(\s*hover\s*:\s*hover\s*\)/g, ' ');
          if (bare.includes('hover:')) {
            offenders.push(`${file.slice(SRC.length)}:${index + 1}  ${row.trim().slice(0, 58)}`);
          }
        });
    }
    expect(offenders, 'an ungated hover style sticks after a tap on iOS').toEqual([]);
  });

  it('keeps the swipe row’s buttons reachable by focus rather than by pointer', () => {
    const swipe = readFileSync(join(SRC, 'design', 'ui', 'SwipeRow.tsx'), 'utf8');
    // Hidden until focused, not until hovered. A gesture alone is unreachable
    // by keyboard and by switch control, so the buttons are the real control.
    expect(swipe).toMatch(/focus-within:opacity-100/);
    expect(swipe).not.toMatch(/hover:opacity-100/);
  });
});
