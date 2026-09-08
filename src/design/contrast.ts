/* ===========================================================================
 * CONTRAST
 * ---------------------------------------------------------------------------
 * WCAG 2.1 relative luminance and contrast ratio, so the palette can be
 * checked by arithmetic rather than by looking at it.
 *
 * This exists because the palette shipped with a comment claiming a colour was
 * "AA on --color-base at 12px+" when it was 2.82:1 — not AA at any size. A
 * claim like that is invisible until somebody with ordinary eyesight tries to
 * read a row subtitle in daylight, and by then it is in every screen.
 *
 * The thresholds are the normative ones. 4.5:1 for body text; 3:1 for large
 * text (18.66px bold or 24px regular) and for non-text things that carry
 * meaning — a bar, a dot, an icon. Our base reading size is 14.5px, so the
 * body threshold is the one that applies to nearly everything.
 * ======================================================================== */

/** Body text, and anything below 18.66px bold / 24px regular. */
export const AA_TEXT = 4.5;
/** Large text, and non-text marks that carry meaning (WCAG 1.4.11). */
export const AA_LARGE = 3;

/** `#rgb` or `#rrggbb` to three channels in 0..1. */
function channels(hex: string): [number, number, number] {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, always >= 1, order-independent. */
export function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
