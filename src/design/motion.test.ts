/* ===========================================================================
 * THE MOTION BUDGET
 * ---------------------------------------------------------------------------
 * "One orchestrated moment per screen, not a fade-and-slide on every card" is
 * a rule that decays the same way the hot-accent budget would without a test:
 * every individual addition is defensible, and the screen ends up with nine.
 *
 * There is exactly one field per screen, which is what makes the budget
 * checkable rather than a matter of judgement. An entrance scoped to `.field`
 * descendants cannot be applied twice on one screen; an entrance scoped to
 * `.card` is applied five times whatever anybody intended. So this asserts the
 * scope rather than counting animations.
 *
 * It also holds three things that were expensive to get right and are
 * invisible when they go wrong:
 *
 *  · Reduced motion has to zero the delays, not only the durations. A part
 *    held at `opacity: 0` by `backwards` fill stays invisible for its delay
 *    however short the animation has been made.
 *  · The keyframes have only a `from`, so the resting state lives in the
 *    component and cannot drift from a copy in the stylesheet.
 *  · `will-change` on the shell and the timer that releases it are two numbers
 *    in two files that have to agree.
 * ======================================================================== */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const CSS = readFileSync(join(SRC, 'design', 'tokens.css'), 'utf8');
const SHEET = readFileSync(join(SRC, 'design', 'ui', 'BottomSheet.tsx'), 'utf8');

/** Every `animation:` / `animation-name:` declaration with its selector. */
function animationRules(): { selector: string; declaration: string }[] {
  const found: { selector: string; declaration: string }[] = [];
  // Selectors are the text between the previous `}` (or `{` of a block) and
  // the `{` that opens the rule carrying the declaration.
  for (const match of CSS.matchAll(/animation(?:-name)?:\s*([^;]+);/g)) {
    const before = CSS.slice(0, match.index);
    const open = before.lastIndexOf('{');
    const start = Math.max(before.lastIndexOf('}', open), before.lastIndexOf('{', open - 1));
    found.push({
      selector: before.slice(start + 1, open).trim(),
      declaration: match[1]!.trim(),
    });
  }
  return found;
}

/**
 * Animations that are not entrances and are not on the budget.
 *
 * A keyframe list is how a spinner spins and how a skeleton pulses. Those are
 * states rather than arrivals — they say "this is still happening", they are
 * not a screen introducing itself — so the one-moment rule does not reach
 * them. Neither is in `tokens.css` today; the list exists so that adding one
 * is a decision rather than a test failure somebody deletes a line to fix.
 */
const NOT_AN_ENTRANCE = /^(@keyframes|\.privacy-veil)/;

describe('the entrance is scoped to the one field', () => {
  const entrances = animationRules().filter((rule) => !NOT_AN_ENTRANCE.test(rule.selector));

  it('animates something, or this test is guarding nothing', () => {
    expect(entrances.length).toBeGreaterThan(0);
  });

  it('puts every entrance inside a field', () => {
    const stray = entrances.filter((rule) => !rule.selector.includes('.field'));
    expect(stray, 'an entrance outside the field is a second moment on the screen').toEqual([]);
  });

  it('never animates a card, a tile or a row in', () => {
    for (const rule of entrances) {
      expect(rule.selector, 'fade-and-slide on every container is the generated default').not.toMatch(
        /\.card|\.tile|\.row\b|\.demo/,
      );
    }
  });
});

describe('the keyframes name a start and let the layout name the end', () => {
  it('declares no `to` and no 100% stop', () => {
    for (const block of CSS.matchAll(/@keyframes\s+([a-z-]+)\s*\{/g)) {
      const open = CSS.indexOf('{', block.index! + block[0].length - 1);
      // Keyframe bodies nest one level, so the close is the second `}`.
      let depth = 0;
      let end = open;
      for (let i = open; i < CSS.length; i += 1) {
        if (CSS[i] === '{') depth += 1;
        if (CSS[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = CSS.slice(open, end);
      expect(body, `@keyframes ${block[1]} pins its destination`).not.toMatch(/\bto\s*\{|100%\s*\{/);
      expect(body, `@keyframes ${block[1]} has no start to animate from`).toMatch(/\bfrom\s*\{/);
    }
  });
});

describe('reduced motion stops the waiting as well as the moving', () => {
  const block = CSS.slice(
    CSS.indexOf('@media (prefers-reduced-motion: reduce)'),
    CSS.indexOf('@layer components'),
  );

  it('zeroes the delays, not only the durations', () => {
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block, 'a zero-duration animation still waits out its delay').toMatch(
      /animation-delay:\s*0s\s*!important/,
    );
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-delay:\s*0s\s*!important/);
  });

  it('reaches pseudo-elements too, which is where a stagger usually hides', () => {
    expect(block).toMatch(/\*::before/);
    expect(block).toMatch(/\*::after/);
  });
});

describe('the shell is promoted for the length of the recede and no longer', () => {
  function shellRule(selector: string): string {
    const at = CSS.indexOf(selector);
    expect(at, `${selector} is missing from tokens.css`).toBeGreaterThan(-1);
    const open = CSS.indexOf('{', at);
    return CSS.slice(open, CSS.indexOf('}', open));
  }

  it('declares no permanent will-change on the shell', () => {
    expect(
      shellRule('#app-shell {'),
      'a permanent will-change holds a full-screen compositor layer all session',
    ).not.toMatch(/will-change/);
  });

  it('promotes it under [data-presenting] instead', () => {
    expect(shellRule('#app-shell[data-presenting] {')).toMatch(/will-change:\s*transform/);
  });

  it('drops the dock’s blur for the duration', () => {
    const rule = shellRule('#app-shell[data-presenting] .glass {');
    expect(rule).toMatch(/backdrop-filter:\s*none/);
    // Without an opaque ground the dock spends the movement as flat
    // translucency, which is the fog the saturation boost exists to avoid.
    expect(rule).toMatch(/background:\s*var\(--color-surface\)/);
  });

  it('sets the attribute a frame before the transform, not with it', () => {
    const setter = SHEET.slice(SHEET.indexOf('function setShellReceded'));
    const body = setter.slice(0, setter.indexOf('\n}'));
    const presenting = body.indexOf("setAttribute('data-presenting'");
    const frame = body.indexOf('requestAnimationFrame');
    const receded = body.lastIndexOf("setAttribute('data-receded'");
    expect(presenting).toBeGreaterThan(-1);
    expect(frame, 'the hint has to land in an earlier frame than the transform').toBeGreaterThan(
      presenting,
    );
    expect(receded).toBeGreaterThan(frame);
  });

  it('starts the release timer inside the frame, not beside it', () => {
    const setter = SHEET.slice(SHEET.indexOf('function setShellReceded'));
    const body = setter.slice(0, setter.indexOf('\n}'));
    const frame = body.indexOf('requestAnimationFrame');
    const timer = body.indexOf('setTimeout(');
    expect(frame).toBeGreaterThan(-1);
    expect(timer).toBeGreaterThan(-1);

    // Measured with a MutationObserver, with the timer outside the frame: the
    // layer was released at 454ms and the transform started at 717ms. The two
    // are 16ms apart in a visible page and unbounded apart in a hidden one,
    // because `requestAnimationFrame` does not fire there and `setTimeout`
    // does. The release has to measure from the movement, not from the hint.
    expect(timer, 'the release must be scheduled from inside the frame').toBeGreaterThan(frame);

    // And inside its braces, not merely after the call.
    const open = body.indexOf('{', frame);
    let depth = 0;
    let close = open;
    for (let i = open; i < body.length; i += 1) {
      if (body[i] === '{') depth += 1;
      if (body[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(timer).toBeLessThan(close);
  });

  it('writes the latest intent rather than the value a frame closed over', () => {
    const setter = SHEET.slice(SHEET.indexOf('function setShellReceded'));
    const body = setter.slice(0, setter.indexOf('\n}'));
    // Two sheets opening and closing inside one frame queue two callbacks, and
    // the second has to win. A captured argument makes that ordering luck.
    expect(body).toMatch(/setAttribute\('data-receded', String\(recedeTarget\)\)/);
  });

  it('lets a superseded recede do nothing rather than something late', () => {
    const setter = SHEET.slice(SHEET.indexOf('function setShellReceded'));
    const body = setter.slice(0, setter.indexOf('\n}'));
    // Both deferred steps check the generation. Measured before this: three
    // sheets mounting in one frame started three release timers, and a single
    // `clearTimeout` could cancel one of them.
    const checks = body.match(/generation !== recedeGeneration/g) ?? [];
    expect(checks.length, 'the frame and the timer both have to check').toBe(2);
  });

  it('releases the layer no sooner than the transition ends', () => {
    const declared = /const RECEDE_MS = (\d+);/.exec(SHEET);
    expect(declared, 'RECEDE_MS is gone from BottomSheet').not.toBeNull();

    const shell = CSS.slice(CSS.indexOf('#app-shell {'));
    const transform = /transform\s+(\d+)ms\s+var\(--ease-sheet\)/.exec(shell);
    expect(transform, 'the shell no longer transitions transform').not.toBeNull();

    expect(
      Number(declared![1]),
      'the timer and the transition are two numbers that have to agree',
    ).toBe(Number(transform![1]));
  });

  it('asks for no layer at all when motion is switched off', () => {
    const setter = SHEET.slice(SHEET.indexOf('function setShellReceded'));
    const body = setter.slice(0, setter.indexOf('\n}'));
    expect(body, 'reduced motion should not pay for a compositor layer').toMatch(
      /prefers-reduced-motion: reduce/,
    );
  });
});
