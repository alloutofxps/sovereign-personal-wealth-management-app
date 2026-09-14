/* Generates the PWA icon set from one vector source.
 *
 * The mark is two bars of equal length — the two sides of an entry that must
 * balance. The upper bar is emerald (the liquid accent), the lower is zinc,
 * and a hairline sits between them where the ledger rule would be.
 *
 * Run: npm run icons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));

/* Midnight's palette, which is the app's. These were `#08090A` / `#34D8A0`
 * from before the redesign -- an icon two palettes out of date is the one
 * piece of a rebrand nobody notices, because it is never on screen next to
 * the thing it is meant to match. */
const BASE = '#0b0f22';
const LIQUID = '#4fd1a5';
const ZINC = '#a6adcb';
const RULE = '#2b3358';

/* Android's themed icons tint a single-colour glyph to the wallpaper, so the
 * monochrome variant hands them a white mark on transparency and lets the two
 * bars be told apart by the gap rather than by hue. */
const MONO = '#ffffff';

/**
 * @param {number} size   canvas size
 * @param {number} inset  fraction of the canvas kept clear at each edge
 * @param {boolean} bleed fill the whole canvas (maskable) or round the corners
 * @param {boolean} mono  one colour on transparency, for Android theming
 */
function markSvg(size, inset, bleed, mono = false) {
  const pad = size * inset;
  const width = size - pad * 2;
  const barHeight = width * 0.17;
  const gap = width * 0.13;
  const radius = barHeight / 2;
  const top = (size - (barHeight * 2 + gap)) / 2;

  const upper = mono ? MONO : LIQUID;
  const lower = mono ? MONO : ZINC;
  const rule = mono ? MONO : RULE;

  const background = mono
    ? ''
    : bleed
      ? `<rect width="${size}" height="${size}" fill="${BASE}"/>`
      : `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${BASE}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${background}
  <rect x="${pad}" y="${top}" width="${width}" height="${barHeight}" rx="${radius}" fill="${upper}"/>
  <rect x="${pad}" y="${top + barHeight + gap / 2 - size * 0.004}" width="${width}" height="${Math.max(1, size * 0.008)}" fill="${rule}"/>
  <rect x="${pad}" y="${top + barHeight + gap}" width="${width}" height="${barHeight}" rx="${radius}" fill="${lower}"/>
</svg>`;
}

const targets = [
  { file: 'icons/icon-192.png', size: 192, inset: 0.2, bleed: false },
  { file: 'icons/icon-512.png', size: 512, inset: 0.2, bleed: false },
  // Maskable: the mark must survive an aggressive circular crop, so it sits
  // inside the inner 80% and the background bleeds to every edge.
  { file: 'icons/maskable-512.png', size: 512, inset: 0.28, bleed: true },
  { file: 'icons/apple-touch-icon.png', size: 180, inset: 0.2, bleed: true },
  // Monochrome: same crop as the maskable one, no ground at all. Android
  // composites its own behind whatever colour it decides the mark should be.
  { file: 'icons/monochrome-512.png', size: 512, inset: 0.28, bleed: false, mono: true },
];

await mkdir(new URL('icons/', `file://${OUT}`), { recursive: true });

for (const { file, size, inset, bleed, mono } of targets) {
  const svg = markSvg(size, inset, bleed, mono === true);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(`${OUT}${file}`);
  console.log(`  ${file}  ${size}x${size}`);
}

await writeFile(`${OUT}favicon.svg`, markSvg(64, 0.16, false), 'utf8');
console.log('  favicon.svg');
