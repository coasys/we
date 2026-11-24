// Source consumers need the ambient Vite asset declaration; a runtime import cannot load a .d.ts.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./global.d.ts" />
import type { BundleTheme, ThemeOverrides } from '@we/schema-shared';

import pjBold from './assets/PlusJakartaSans-Bold.woff2?inline';
import pjExtraBold from './assets/PlusJakartaSans-ExtraBold.woff2?inline';
import pjMedium from './assets/PlusJakartaSans-Medium.woff2?inline';
import pjRegular from './assets/PlusJakartaSans-Regular.woff2?inline';
import pjSemiBold from './assets/PlusJakartaSans-SemiBold.woff2?inline';

/**
 * Acorn's own look, as a WE theme — the palette, type and geometry of the real app, read from
 * lightningrodlabs/acorn v14.0.0 (`web/src/variables.scss`, `styles.ts`).
 *
 * Acorn is light only: a warm off-white page (`#f7f5f3`), white cards, and the ultramarine
 * (`#344cff`) it draws links, selections and the high-priority glow in. Achieved outcomes go
 * forest green (`#15841d`), not-achieved smalls bronze (`#a89958`), in-breakdown pumpkin
 * (`#c4631e`) — the success, warning and danger families carry those. The greys are its warm
 * greys, off `neutralHue` 68 rather than WE's cool default.
 *
 * The type is Plus Jakarta Sans — Acorn's body face — carried as five static weights under the
 * SIL Open Font License, so nothing is fetched. Its display face is Gilroy ExtraBold, which is
 * proprietary; headings take Plus Jakarta Sans at 800, which is what Acorn's own fallback stack
 * already does. Body is its Medium (500); controls and eyebrows Bold and ExtraBold, as its
 * buttons and small-caps labels are.
 *
 * One side, light: a theme with no `dark` wears its base on every display setting, and the
 * app has no dark look to copy.
 */
const acornOverrides: ThemeOverrides = {
  schemaVersion: 7,
  polarity: 'light',
  // The ultramarine, at the edge of what oklch holds — its real chroma (0.26) is past a
  // slider's 100, so the fill lightness states the colour and saturation saturates it.
  accentHue: 268,
  accentSaturation: 100,
  accentLightness: 53,
  // Achieved green #15841d.
  successHue: 143,
  successSaturation: 70,
  successLightness: 50,
  // Its amber range — smalls bronze #a89958, high-priority sun #ffc400.
  warningHue: 85,
  warningSaturation: 80,
  warningLightness: 60,
  // Uncertain-scope red #ff5d36, its warning text #c52700 — fill and text split the difference.
  dangerHue: 30,
  dangerSaturation: 85,
  dangerLightness: 58,
  // The warm greys the page and its borders are mixed from.
  neutralHue: 68,
  neutralSaturation: 12,
  saturation: 85,
  // Its vivid tag set — turquoise, carrot, sun, belize, grape — over the defaults where they
  // share a hue.
  palette: {
    hues: {
      red: { hue: 10 },
      orange: { hue: 25 },
      yellow: { hue: 45 },
      teal: { hue: 186 },
      blue: { hue: 215 },
      purple: { hue: 285 },
    },
  },
  surfaceRadius: '10px',
  controlRadius: '10px',
  inputRadius: '10px',
  avatarRadius: '999px',
  iconWeight: 'light',
  shadowIntensity: 'subtle',
  // Empty create buttons really are disabled. Keep their labels readable without enabling them.
  disabledOpacity: 0.9,
  surfaceOpacity: 1,
  surfaceBlur: 0,
  glowIntensity: 'none',
  // A named subtree must not inherit the Coasis page's aurora through transparent areas.
  surfaceImages: {
    page: 'linear-gradient(transparent, transparent)',
    chrome: 'linear-gradient(transparent, transparent)',
  },
  fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontFaces: [
    { family: 'Plus Jakarta Sans', src: pjRegular, weight: '400' },
    { family: 'Plus Jakarta Sans', src: pjMedium, weight: '500' },
    { family: 'Plus Jakarta Sans', src: pjSemiBold, weight: '600' },
    { family: 'Plus Jakarta Sans', src: pjBold, weight: '700' },
    { family: 'Plus Jakarta Sans', src: pjExtraBold, weight: '800' },
  ],
  typeStyles: {
    body: { weight: 500 },
    // Gilroy's stand-in — see the note above.
    heading: { weight: 800 },
    control: { weight: 700 },
    badge: { weight: 700 },
    label: { weight: 600 },
    // Its small-caps grey labels ("Uncertain Scope", the table headers).
    overline: { weight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text-muted' },
  },
  roles: {
    page: '#f7f5f3',
    chrome: '#f7f5f3',
    // Exact Acorn ultramarine, including the button's interactive states.
    accent: '#344cff',
    accentHover: '#293edb',
    accentActive: '#2133b8',
    onAccent: '#ffffff',
    accentText: '#344cff',
    accentSoft: '#e9ecff',
    surface: '#ffffff',
    surfaceRaised: '#ffffff',
    surfaceSunken: '#fbfbf9',
    field: '#ffffff',
    border: '#ede7e7',
    borderStrong: '#c3bfba',
    text: '#222222',
    textMuted: '#4d4d4d',
    textFaint: '#9d9d9d',
    // Its pale-silver shadow (#c7beb4), warm like everything else it drops one under.
    shadowColor: 'oklch(82% 0.01 80)',
  },
};

export const acornTheme: BundleTheme = {
  id: 'acorn',
  name: 'Acorn',
  icon: 'acorn',
  overrides: acornOverrides,
  // Longhand colour declarations survive CSSOM sanitisation (var() shorthands do not).
  // The layout overrides beat the module part's inline row defaults, only within this theme.
  // The host confines this sheet to the Acorn theme boundary, including named view roots.
  css: `
    [data-acorn-view='table'] [role='table'],
    [data-acorn-outcome] {
      border-width: 1px;
      border-style: solid;
      border-top-color: var(--we-role-border);
      border-right-color: var(--we-role-border);
      border-bottom-color: var(--we-role-border);
      border-left-color: var(--we-role-border);
    }
    [data-acorn-view='table'] [role='table'] {
      background-color: var(--we-role-surface);
      border-radius: 10px;
      box-shadow: 0 4px 20px #c7beb433;
      overflow: hidden;
      min-height: 60vh;
    }
    [data-acorn-view='table'] [role='row'] { gap: 0 !important; padding: 0 !important; }
    [data-acorn-view='table'] [role='columnheader'],
    [data-acorn-view='table'] [role='cell'] {
      padding: 8px 12px;
      align-self: stretch;
      border-right-width: 1px;
      border-right-style: solid;
      border-right-color: var(--we-role-border);
    }
    [data-acorn-view='table'] [role='row']:has([role='columnheader']) {
      background-color: var(--we-role-surface-sunken);
    }
    [data-acorn-view='table'] [role='row']:hover { background-color: var(--we-role-accent-soft); }
    [data-acorn-view='table'] [role='cell'] { overflow-wrap: normal; }
    [data-acorn-view='map'] .we-graph__card-shape {
      background-color: var(--we-role-surface);
      color: var(--we-role-text);
      border-radius: 10px;
      padding: 20px;
    }
    [data-acorn-view='map'] .we-graph__node--card:not(.we-graph__node--selected):not(.we-graph__node--hovered) .we-graph__card-shape {
      box-shadow: 0 8px 28px #c7beb480;
    }
    [data-acorn-outcome] {
      padding: 20px !important;
      flex-direction: column !important;
      align-items: stretch !important;
      border-left-width: 3px;
      border-left-color: var(--we-role-accent);
      box-shadow: 0 6px 20px #c7beb455;
    }
  `,
};
