/**
 * Stand-in imagery, as offline data URIs.
 *
 * Real photographs would be better subjects — a media grid is judged on how photographs sit in it —
 * but a fixture that fetches them is a fixture that fails without a network and drifts when a URL
 * rots, and committing megabytes of JPEG to make six templates render is a bad trade. These are
 * flat gradients: honest about being placeholders, deterministic, and varied enough in hue and
 * value to show tile spacing, aspect handling and overlay contrast, which is what the grid layout
 * is actually being judged on.
 *
 * Swap in real assets before judging anything about *photographic* treatment — saturation, how a
 * dark overlay sits on a bright image — which these cannot answer.
 */
const gradient = (from: string, to: string, w = 800, h = 800) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`,
  )}`;

/** Six plates, in a deliberate spread of hue and lightness. */
export const PLATES = [
  gradient('#2b4c7e', '#567ebb'),
  gradient('#7e2b4c', '#bb5678'),
  gradient('#2b7e5c', '#56bb8e'),
  gradient('#7e6b2b', '#bba956'),
  gradient('#4c2b7e', '#7856bb'),
  gradient('#7e3f2b', '#bb7056'),
];

/** Wide plate, for a video thumbnail or cover. */
export const WIDE = [
  gradient('#1f3a5f', '#4a7fb5', 1280, 720),
  gradient('#5f1f3a', '#b54a7f', 1280, 720),
  gradient('#1f5f3a', '#4ab57f', 1280, 720),
  gradient('#5f4a1f', '#b5a04a', 1280, 720),
];
