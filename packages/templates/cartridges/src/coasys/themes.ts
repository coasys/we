import { readFileSync } from 'node:fs';

import type { BundleTheme } from '@we/schema-shared';
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
    schemaVersion: 7,
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

/**
 * Bricolage Grotesque, carried rather than fetched: a theme that loaded a font from a server would
 * tell that server who is using it and when, so a theme's typefaces are `data:` URLs.
 * The Latin subset, as coasys.org serves it, with every weight from 300 to 800 in one variable file.
 *
 * Licence: SIL Open Font License 1.1 — Mathieu Triay. https://fonts.google.com/specimen/Bricolage+Grotesque
 */
const BRICOLAGE = readFileSync(new URL('./assets/BricolageGrotesque-latin.woff2', import.meta.url)).toString('base64');

/**
 * The site's three orbs, as gradients on the page rather than blurred circles: a teal haze behind
 * the top, violet in the bottom-right corner, and a deeper indigo bottom-left. Their strength is the
 * site's own, its opacity times its gradient's alpha, so they read as haze, not as balls.
 */
const ORBS = [
  'radial-gradient(45vmax 40vmax at 32% -12%, rgba(117, 255, 190, 0.15), transparent 70%)',
  'radial-gradient(50vmax 45vmax at 104% 112%, rgba(109, 38, 183, 0.24), transparent 70%)',
  'radial-gradient(40vmax 36vmax at -8% 110%, rgba(37, 40, 125, 0.3), transparent 70%)',
].join(', ');

/** The chrome keeps the faintest trace of the same haze, so the rail and the tree are not a flat cut-out. */
const CHROME_HAZE = 'radial-gradient(40vmax 40vmax at 0% 0%, rgba(117, 255, 190, 0.05), transparent 70%)';

/**
 * Every colour family's tint, as the site draws its pills and banners: the family's own fill, about a
 * sixth of the way over the surface. Derived in the family's hue alone, a tint on this indigo came
 * out a deep maroon or violet; mixed into the surface, it is the site's pastel haze, cool and quiet.
 * Only the fills are pinned — the text on them is still chosen and corrected against them.
 */
const TINTED_FAMILIES = [
  'accent',
  'success',
  'warning',
  'danger',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'purple',
  'pink',
] as const;
const TINTS = Object.fromEntries(
  TINTED_FAMILIES.map((family) => [
    `${family}Soft`,
    `color-mix(in oklab, var(--we-role-${family}) 16%, var(--we-role-surface))`,
  ]),
);

/**
 * Coasys Glow: Nico's look, from coasys.org — deep indigo, mint pastels, and Bricolage Grotesque.
 *
 * Dark only, as the site is. The surfaces are pinned, because they are the site's own: the page
 * `#131533` must not drift, the chrome and the wells a step darker, cards and raised surfaces a step
 * and two lighter, borders in the same family. Text keeps the site's three levels, the faintest
 * lifted a little (`#8d90b3` to `#9497ba`) so a placeholder on a card still clears the contrast bar.
 *
 * The colours are settings, not pins, so the corrections reach them: mint for the accent and
 * success, the site's orange for warnings. The palette is the site's pastels — its purple, its blue
 * (WE's cyan, at 220), its orange and its mint — and every other hue lifted to sit beside them.
 * The site has no red; danger is a pastel a little redder than the warning orange, so the two can
 * still be told apart.
 *
 * Headings are light (300), controls 600, badges and eyebrows 700 with the site's tracking. Shadows
 * are flat, as the site's cards are, and a glow is strong: a highlighted card is ringed and lit in
 * its own colour. A secondary button is the site's 1.5px outline.
 */
export const glowTheme: BundleTheme = {
  id: 'coasys-glow',
  name: 'Coasys Glow',
  icon: 'sparkle',
  overrides: {
    schemaVersion: 7,
    polarity: 'dark',
    accentHue: 156,
    accentSaturation: 63,
    accentLightness: 88,
    successHue: 156,
    successSaturation: 63,
    successLightness: 88,
    warningHue: 50,
    warningSaturation: 97,
    warningLightness: 84,
    dangerHue: 28,
    dangerSaturation: 90,
    dangerLightness: 78,
    saturation: 70,
    neutralHue: 277,
    neutralSaturation: 35,
    lightnessFloor: '20%',
    lightnessCeiling: '100%',
    palette: {
      lightness: 12,
      hues: {
        purple: { hue: 311, saturation: 99, lightness: 84 },
        cyan: { hue: 220, saturation: 93, lightness: 87 },
        orange: { hue: 50, saturation: 97, lightness: 84 },
        green: { hue: 156, saturation: 63, lightness: 88 },
      },
    },
    surfaceRadius: '22px',
    controlRadius: '999px',
    inputRadius: '14px',
    avatarRadius: '999px',
    borderWidth: '1px',
    shadowIntensity: 'flat',
    glowIntensity: 'strong',
    fontFamily: "'Bricolage Grotesque', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    monoFontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
    fontFaces: [{ family: 'Bricolage Grotesque', src: `data:font/woff2;base64,${BRICOLAGE}`, weight: '300 800' }],
    typeStyles: {
      heading: { weight: 300, letterSpacing: '-0.01em' },
      control: { weight: 600, letterSpacing: '0.01em' },
      badge: { weight: 700, letterSpacing: '0.02em' },
      // Eyebrows a step up from the default 12px, so the tree's "Space" and the first steps read at a glance.
      overline: { size: '200', weight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'text-faint' },
    },
    surfaceImages: { page: ORBS, chrome: CHROME_HAZE },
    components: {
      button: { variants: { outline: { borderWidth: '1.5px', border: 'text-muted' } } },
      // d12's tree: rows rounded at 10px with the sidebar's 8px/10px padding (style.css `.nav-item`),
      // and the one you are on lifted to --surface-2 with a 3px mint bar on its leading edge.
      tree: {
        radius: '10px',
        padding: '200 10px',
        variants: { selected: { fill: 'surfaceRaised', text: 'text', border: 'accent', borderWidth: '3px' } },
      },
    },
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
      onAccent: '#0f1230',
      // The site's mint text is its button mint, at full strength. Derived, accent text came out a
      // paler, greyer step of the same hue, which read as faded beside the buttons. Pinned to the
      // fill rather than to a colour, so it still follows the accent when somebody moves it.
      accentText: 'var(--we-role-accent)',
      ...TINTS,
    },
  },
};
