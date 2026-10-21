import { readFileSync } from 'node:fs';

import type { BundleTheme } from '@we/schema-shared';
import type { FixtureTheme } from '@we/template-fixtures';

/**
 * Coasys: Josh's theme, with a light and a dark side.
 *
 * Two hues — a mint primary (160) over a violet-grey neutral (278) — and generous rounding: cards
 * at 20px, controls as pills. The sides differ only where light and dark must: polarity, the
 * lightness range, and the three roles the design pins (the page, the accent and the ink on it).
 * Everything else — text levels, borders, status colours — is WE's own derivation from these.
 *
 * The base carries the dark side whole, so a host that cannot wear a side still draws the look
 * the design leads with.
 */
const DARK = {
  polarity: 'dark',
  lightnessFloor: '16%',
  lightnessCeiling: '104%',
  roles: { page: 'oklch(18.5% 0.04 278)', accent: 'oklch(85% 0.12 160)', onAccent: 'oklch(20% 0.045 278)' },
};

const LIGHT = {
  polarity: 'light',
  lightnessFloor: '0%',
  lightnessCeiling: '100%',
  roles: { page: 'oklch(98% 0.012 278)', accent: 'oklch(55% 0.14 160)', onAccent: 'oklch(99% 0.005 278)' },
};

export const coasysTheme: FixtureTheme = {
  id: 'coasys-theme',
  name: 'Coasys',
  icon: 'hexagon',
  overrides: {
    schemaVersion: 6,
    primaryHue: 160,
    saturation: 60,
    neutralHue: 278,
    neutralSaturation: 22,
    surfaceRadius: '20px',
    controlRadius: '999px',
    inputRadius: '14px',
    avatarRadius: '999px',
    ...DARK,
    light: LIGHT,
    dark: DARK,
  },
};

/**
 * Bricolage Grotesque, carried rather than fetched: a theme that loaded a font from a server would
 * tell that server who is using it and when, so the sanitiser drops any font that is not a `data:` URL.
 * The Latin subset, as coasys.org serves it, with every weight from 300 to 800 in one variable file.
 *
 * Licence: SIL Open Font License 1.1 — Mathieu Triay. https://fonts.google.com/specimen/Bricolage+Grotesque
 */
const BRICOLAGE = readFileSync(new URL('./assets/BricolageGrotesque-latin.woff2', import.meta.url)).toString('base64');

const GLOW_CSS = `@font-face {
  font-family: 'Bricolage Grotesque';
  font-style: normal;
  font-weight: 300 800;
  font-display: swap;
  src: url('data:font/woff2;base64,${BRICOLAGE}') format('woff2');
}`;

/**
 * Coasys Glow: Nico's look, from coasys.org — deep indigo, mint, and Bricolage Grotesque.
 *
 * Dark only, as the site is. Its colours are pinned rather than derived, because they are the site's
 * own: the page `#131533`, the chrome and the wells a step darker, cards and raised surfaces a step
 * and two lighter, borders in the same family, and mint on a dark ink for anything pressed. Text
 * keeps the site's three levels, the faintest lifted a little (`#8d90b3` to `#9497ba`) so a
 * placeholder on a card still clears the contrast bar.
 *
 * The site's haze and glowing cards need component hooks a theme cannot reach from its CSS yet; they
 * arrive with those.
 */
export const glowTheme: BundleTheme = {
  id: 'coasys-glow',
  name: 'Coasys Glow',
  icon: 'sparkle',
  overrides: {
    schemaVersion: 6,
    polarity: 'dark',
    primaryHue: 155,
    saturation: 70,
    neutralHue: 275,
    neutralSaturation: 35,
    lightnessFloor: '12%',
    lightnessCeiling: '100%',
    surfaceRadius: '22px',
    controlRadius: '999px',
    inputRadius: '14px',
    avatarRadius: '999px',
    fontFamily: "'Bricolage Grotesque', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    roles: {
      page: '#131533',
      chrome: '#0d0f26',
      surfaceSunken: '#0d0f26',
      surface: '#1b1e45',
      surfaceRaised: '#22265a',
      border: '#2f3468',
      borderStrong: '#373b63',
      text: '#ffffff',
      textMuted: '#c7c9dc',
      textFaint: '#9497ba',
      accent: '#88f3b4',
      accentText: '#88f3b4',
      onAccent: '#0f1230',
    },
  },
  css: GLOW_CSS,
};
