import { readFileSync } from 'node:fs';

import type { BundleBrand } from '@we/schema-shared';

/**
 * The Coasys mark: a filled hexagon in the accent, Phosphor's `hexagon` as the designs draw it.
 *
 * There is no logo file in either design repo yet, so this is the mark the designs use until there
 * is. Drawn as an image, so its colours are written out rather than read from the theme: a mint that
 * deepens to green, which holds on a light page and a dark one.
 *
 * One file, `assets/mark.svg`, read here into the bundle and named by `seeds/coasys.seed.json` as the
 * desktop icon, so the app and its installer cannot drift apart.
 */
export const COASYS_MARK = readFileSync(new URL('./assets/mark.svg', import.meta.url), 'utf-8').trim();

const ABOUT = `# Coasys

Coasys is where a community keeps its conversations, calls and the work that comes out of them —
on devices its members run, not on someone else's servers.

Everything you write is signed by a key that is yours. Spaces you share are held by the people in
them, and you can take your keys and your private spaces with you whenever you choose.

Coasys runs on [WE](https://github.com/coasys/we), an open interface layer for community software,
and [AD4M](https://github.com/coasys/ad4m), the agent-centric data layer beneath it.`;

export const coasysBrand: BundleBrand = {
  name: 'Coasys',
  mark: COASYS_MARK,
  about: ABOUT,
};
