import type { FixtureTheme } from '@we/template-fixtures';

/**
 * Coasys: Josh's theme, with a light and a dark side.
 *
 * Two hues — a mint primary (160) over a violet-grey neutral (278) — and generous rounding: cards
 * at 20px, controls as pills. The sides differ only where light and dark must: polarity, the
 * lightness range, and the roles pinned: the page, the accent and the ink on it from the design, and
 * the chrome — the rail and the tree — one step below the page in its hue. Left to the neutral ramp,
 * the chrome came out grey (`#151620`) beside a blue page (`#0f1024`), in Josh's renders as here.
 * Everything else — text levels, borders, status colours — is WE's own derivation from these.
 *
 * The base carries the dark side whole, so a host that cannot wear a side still draws the look
 * the design leads with.
 */
const DARK = {
  polarity: 'dark',
  lightnessFloor: '16%',
  lightnessCeiling: '104%',
  roles: {
    page: 'oklch(18.5% 0.04 278)',
    chrome: 'oklch(16% 0.04 278)',
    accent: 'oklch(85% 0.12 160)',
    onAccent: 'oklch(20% 0.045 278)',
  },
};

const LIGHT = {
  polarity: 'light',
  lightnessFloor: '0%',
  lightnessCeiling: '100%',
  roles: {
    page: 'oklch(98% 0.012 278)',
    chrome: 'oklch(96% 0.016 278)',
    accent: 'oklch(55% 0.14 160)',
    onAccent: 'oklch(99% 0.005 278)',
  },
};

export const coasysTheme: FixtureTheme = {
  id: 'coasys-theme',
  name: 'Coasys',
  icon: 'hexagon',
  overrides: {
    schemaVersion: 6,
    accentHue: 160,
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
