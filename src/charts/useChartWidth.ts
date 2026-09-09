/* ===========================================================================
 * HOW WIDE THE CHART ACTUALLY IS
 * ---------------------------------------------------------------------------
 * Four charts hard-coded `WIDTH = 320` and let the viewBox scale to fit. That
 * is fine for shape and wrong for everything measured in pixels.
 *
 * On a 390pt phone the drawing is scaled by 390/320 = 1.22, and on a 430pt one
 * by 1.34. So a 1px hairline renders at 1.34px, an 8px label at 10.7px, and the
 * six-pixel padding that keeps a label off the edge becomes eight — none of
 * which is what was designed, and all of which changes with the device.
 *
 * `vector-effect="non-scaling-stroke"` fixes the strokes on their own, and
 * every stroked element in these files now carries it. It does nothing for
 * text, for spacing, or for the label-collision arithmetic in
 * `NetWorthTimeline`, which computes in viewBox units and therefore has to know
 * what a viewBox unit is worth.
 *
 * Measuring the container is the only thing that fixes all of it: the viewBox
 * becomes the real pixel width, the scale factor becomes 1, and a pixel means
 * a pixel again.
 *
 * ---------------------------------------------------------------------------
 * WHY IT STARTS AT 320 RATHER THAN AT NOTHING
 *
 * The first render happens before layout, so there is no width to read yet.
 * Returning 0 would divide by zero in every scale; returning nothing would mean
 * every chart needs a loading branch it does not otherwise need. 320 is the
 * width these charts were designed at, so the first frame is the old behaviour
 * and the second is correct — and on a phone the two are one paint apart.
 * ======================================================================== */

import { useEffect, useRef, useState } from 'react';

/**
 * Advance width of one character, as a share of the font size, in the app's
 * own face.
 *
 * Charts compute layout in viewBox units and run under node in the test suite,
 * where there is no engine to ask for a real measurement. This is the estimate
 * they use instead, and it is measured rather than guessed: with
 * `getComputedTextLength` on real labels, Space Grotesk came to 4.32-4.44 units
 * per character at `fontSize="8"` and 5.39 at `fontSize="10"`. Both are 0.54.
 *
 * Digits, a currency symbol and a comma are what these labels are made of, and
 * they are close to uniform in a face with tabular figures — which is why one
 * number works at all. It would not for running prose.
 */
export const CHAR_WIDTH_EM = 0.54;

/** Rough width of a label, for layout that has to happen without a DOM. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_EM;
}

/** What the charts were drawn at, and the width used until layout says otherwise. */
export const FALLBACK_WIDTH = 320;

export function useChartWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    /*
     * `ResizeObserver` is absent under node, where these components are
     * rendered by the test suite. Falling back to the design width keeps the
     * tests measuring the geometry they were written against rather than
     * throwing on a missing global.
     */
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      // Rounded, because a fractional viewBox width puts every coordinate in
      // the drawing on a fractional pixel and softens every hairline in it.
      if (measured > 0) setWidth(Math.round(measured));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
