import { readFileSync } from 'node:fs';

import type { BundleBrand } from '@we/schema-shared';

/**
 * The Coasys mark: the Coasys logo, in a mint that deepens to green.
 *
 * Drawn as an image, so its colours are written out rather than read from the theme, and chosen to
 * hold on a light page and a dark one. The desktop icon is `assets/icon.svg`: the same logo on Glow's
 * indigo, as a rounded tile like WE's, named by `seeds/coasys.seed.json` and rendered into every
 * desktop size by `@we/brand`.
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
  // The site's first screen, as a page of the app's own (`about.ts`); the Markdown stays for a build
  // that cannot open pages.
  aboutPage: 'about',
  about: ABOUT,
};
