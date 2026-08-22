import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { animation as animationTokens } from '../src/animation.js';
import type { border as borderTokens } from '../src/border.js';
import type { color as colorTokens } from '../src/color.js';
import type { component as componentTokens } from '../src/component.js';
import type { font as fontTokens } from '../src/font.js';
import type { layout as layoutTokens } from '../src/layout.js';
import { role as roleTokens } from '../src/role.js';
import type { shadow as shadowTokens } from '../src/shadow.js';
import type {
  avatarSize as avatarSizeTokens,
  componentHeight as componentHeightTokens,
  radius as radiusTokens,
  size as sizeTokens,
} from '../src/size.js';
import type { space as spaceTokens } from '../src/space.js';
import type { zIndex as zIndexTokens } from '../src/z-index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateCSS() {
  const outputDir = path.resolve(__dirname, '../dist/css');

  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Import the compiled tokens dynamically
    const indexFile = path.resolve(__dirname, '../dist/index.js');
    const tokens = await import(`file://${indexFile}`);
    const {
      animation,
      border,
      color,
      component,
      font,
      layout,
      shadow,
      size,
      radius,
      avatarSize,
      componentHeight,
      space,
      zIndex,
    } = tokens;

    // Generate CSS files — pure string builders (exported for tests), written here
    const files: Record<string, string> = {
      'animation.css': generateAnimationCSS(animation),
      'border.css': generateBorderCSS(border),
      'color.css': generateColorCSS(color),
      'component.css': generateComponentCSS(component),
      'font.css': generateFontCSS(font),
      'layout.css': generateLayoutCSS(layout),
      'shadow.css': generateShadowCSS(shadow),
      'size.css': generateSizeCSS(size, radius, avatarSize, componentHeight),
      'space.css': generateSpaceCSS(space),
      'z-index.css': generateZIndexCSS(zIndex),
    };
    for (const [name, css] of Object.entries(files)) fs.writeFileSync(path.join(outputDir, name), css);

    // Generate combined index file
    generateCombinedCSS(outputDir);

    console.log('CSS files generated successfully');
  } catch (error) {
    console.error('❌ Failed to generate CSS:', error);
    throw error;
  }
}

// Helper functions for CSS generation
export function generateAnimationCSS(animation: typeof animationTokens) {
  const transitionVars = Object.entries(animation.transition)
    .map(([key, value]) => `  --we-transition-${key}: ${value};`)
    .join('\n');

  const reducedVars = Object.keys(animation.transition)
    .map((key) => `    --we-transition-${key}: 0ms !important;`)
    .join('\n');

  const css = `/* ANIMATION TOKENS - Generated from JS tokens */

:root {
  /* Transition Speeds */
${transitionVars}
}

/*
  Somebody who has asked their operating system for less motion has asked everything, including a
  theme they installed. This is the one place \`!important\` is correct in this system, and the
  reason is mechanical rather than stylistic: a theme's \`animationSpeed\` is applied as an *inline*
  style on the document element, and nothing but \`!important\` outranks an inline style. Without it
  the preference would be honoured by the default theme and quietly discarded by every other one.

  Zeroing the duration tokens covers every transition in the system, since they all read one.
  \`animation\` is stopped separately: a theme's own keyframes do not go through the tokens.
*/
@media (prefers-reduced-motion: reduce) {
  :root {
${reducedVars}
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;

  return css;
}

export function generateBorderCSS(border: typeof borderTokens) {
  const css = `/* BORDER TOKENS - Generated from JS tokens */

:root {
  /* Border Width */
  --we-border-width: ${border.width};

  /* Semantic border radius alias (override in themes) */
  --we-border-radius: var(--we-radius-400);

  /* Border Colors */
  --we-border-color: var(--we-color-neutral-100);
  --we-border-color-strong: var(--we-color-neutral-200);

  /* Focus ring color — resolves to the focus role, so a theme pinning that role moves the ring
     with it. Themes may still override this variable directly (ThemeOverrides.ringColor). */
  --we-ring-color: var(--we-role-focus);
}`;

  return css;
}

export function generateColorCSS(color: typeof colorTokens) {
  const hueVars = Object.entries(color.hues)
    .map(([key, value]) => {
      // neutral-hue inherits from primary-hue by default so neutral surfaces tint to match the primary color
      if (key === 'neutral') return `  --we-color-${key}-hue: var(--we-color-primary-hue);`;
      return `  --we-color-${key}-hue: ${value};`;
    })
    .join('\n');

  const lightnessVars = Object.entries(color.lightness)
    .map(
      ([key, value]) =>
        `  --we-color-lightness-${key}: calc((${value} - var(--we-color-subtractor)) * var(--we-color-multiplier));`,
    )
    .join('\n');

  const colorTypes = ['neutral', 'primary', 'success', 'warning', 'danger'];
  const colorPalettes = colorTypes
    .map((type) => {
      const paletteVars = Object.keys(color.lightness)
        .map((lightnessKey) => {
          const saturationVar =
            type === 'neutral' ? 'var(--we-color-neutral-saturation)' : 'var(--we-color-saturation)';
          return `  --we-color-${type}-${lightnessKey}: hsl(var(--we-color-${type}-hue) ${saturationVar} var(--we-color-lightness-${lightnessKey}));`;
        })
        .join('\n');

      return `  /* ${type.charAt(0).toUpperCase() + type.slice(1)} Colors */
${paletteVars}`;
    })
    .join('\n\n');

  const css = `/* COLOR TOKENS - Generated from JS tokens */

:root {
  /* Color System Configuration */
  --we-color-multiplier: ${color.config.multiplier};
  --we-color-subtractor: ${color.config.subtractor};
  --we-color-saturation: ${color.config.saturation};
  --we-color-neutral-saturation: ${color.config.neutralSaturation};

  /* Color Hues */
${hueVars}

  /* Lightness Scale */
${lightnessVars}

${colorPalettes}

  /* Base Colors */
  --we-color-white: hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) var(--we-color-lightness-0));
  --we-color-black: hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) var(--we-color-lightness-1000));

  /* Semantic Roles — intent over scale position. Defaults are parametric expressions
     so every theme keeps working untouched; themes may pin individual roles
     (ThemeOverrides.roles in @we/themes → --we-role-*). */
${roleVars}

  /* Focus Colors */
  --we-color-focus: var(--we-color-primary-500);
  --we-focus-outline: 0 0 0 2px var(--we-color-focus);

  /* Gradient */
  --we-gradient-primary: linear-gradient(135deg, hsl(calc(var(--we-color-primary-hue) - 25) var(--we-color-saturation) var(--we-color-lightness-500)) 0%, hsl(calc(var(--we-color-primary-hue) + 25) var(--we-color-saturation) var(--we-color-lightness-500)) 100%);
}

/*
  Forced-colors mode (Windows High Contrast, and its equivalents).

  Somebody in this mode has asked the operating system to replace every colour with a small,
  guaranteed-legible set, usually because the alternative is not readable for them. The right
  response is not to theme it — it is to stop competing with it and fix what flattening breaks.

  What breaks is anything distinguished by *background alone*: the browser replaces the fill, so a
  filled button, a selected row and a plain surface all end up the same colour with nothing between
  them. Giving those a border in a system colour restores the boundary the fill was carrying. The
  role variables are deliberately left alone — they still resolve, and \`forced-color-adjust\` is
  what actually decides what paints.
*/
@media (forced-colors: active) {
  :root {
    --we-role-focus: Highlight;
    --we-ring-color: Highlight;
    --we-role-border: CanvasText;
    --we-role-border-strong: CanvasText;
  }

  we-button::part(base),
  we-input::part(base),
  we-textarea::part(base),
  we-select::part(base),
  we-tag::part(base),
  we-badge::part(base),
  we-alert::part(base),
  we-modal::part(base),
  we-drawer::part(base),
  we-menu::part(base) {
    border: 1px solid CanvasText;
  }

  /* A focus ring drawn as a box-shadow disappears here — shadows are not painted. */
  :focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }
}
`;

  return css;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

const roleVars = Object.entries(roleTokens)
  .map(([key, value]) => `  --we-role-${camelToKebab(key)}: ${value};`)
  .join('\n');

export function generateComponentCSS(component: typeof componentTokens) {
  const scrollbarVars = Object.entries(component.scrollbar)
    .map(([key, value]) => `  --we-scrollbar-${camelToKebab(key)}: ${value};`)
    .join('\n');

  const css = `/* COMPONENT TOKENS - Generated from JS tokens */

:root {
  /* Scrollbar Styles */
${scrollbarVars}
}`;

  return css;
}

export function generateFontCSS(font: typeof fontTokens) {
  const fontFamilyVars = Object.entries(font.family)
    .map(([key, value]) => `  --we-font-family-${key}: ${value};`)
    .join('\n');

  const fontSizeVars = Object.entries(font.size)
    .filter(([key]) => key !== 'base')
    .map(([key, value]) => `  --we-font-size-${key}: ${value};`)
    .join('\n');

  const fontWeightVars = Object.entries(font.weight)
    .map(([key, value]) => `  --we-font-weight-${key}: ${value};`)
    .join('\n');

  const lineHeightVars = Object.entries(font.lineHeight)
    .map(([key, value]) => `  --we-line-height-${key}: ${value};`)
    .join('\n');

  const letterSpacingVars = Object.entries(font.letterSpacing)
    .map(([key, value]) => `  --we-letter-spacing-${key}: ${value};`)
    .join('\n');

  const css = `/* FONT TOKENS - Generated from JS tokens */

:root {
  /* Font Family Palette */
${fontFamilyVars}

  /* Active font family — used by all components; themes can override this */
  --we-font-family: var(--we-font-family-base);

  /* Active code face. Read by we-code, we-markdown and we-html, all of which asked for it long
     before anything declared it. */
  --we-font-mono: var(--we-font-family-mono);

  /* Font Sizes */
  --we-font-base-size: ${font.size.base};
${fontSizeVars}

  /* Font Weights */
${fontWeightVars}

  /* Line Heights */
${lineHeightVars}

  /* Letter Spacing */
${letterSpacingVars}
}`;

  return css;
}

export function generateLayoutCSS(layout: typeof layoutTokens) {
  const layoutVars = Object.entries(layout)
    .map(([key, value]) => `  --we-layout-${key}: ${value};`)
    .join('\n');

  const css = `/* LAYOUT TOKENS - Generated from JS tokens */

:root {
  /* Layout width constraints */
${layoutVars}
}`;

  return css;
}

export function generateShadowCSS(shadow: typeof shadowTokens) {
  const shadowVars = Object.entries(shadow)
    .map(([key, value]) => `  --we-shadow-${key}: ${value};`)
    .join('\n');

  const css = `/* SHADOW TOKENS - Generated from JS tokens */

:root {
  /* Box Shadows */
${shadowVars}
}`;

  return css;
}

export function generateSizeCSS(
  size: typeof sizeTokens,
  radius: typeof radiusTokens,
  avatarSize: typeof avatarSizeTokens,
  componentHeight: typeof componentHeightTokens,
) {
  const sizeVars = Object.entries(size)
    .map(([key, value]) => `  --we-size-${key}: ${value};`)
    .join('\n');

  const radiusVars = Object.entries(radius)
    .map(([key, value]) => `  --we-radius-${key}: ${value};`)
    .join('\n');

  const avatarVars = Object.entries(avatarSize)
    .map(([key, value]) => `  --we-avatar-size-${key}: ${value};`)
    .join('\n');

  const componentHeightVars = Object.entries(componentHeight)
    .map(([key, value]) => `  --we-component-height-${key}: ${value};`)
    .join('\n');

  const css = `/* SIZE TOKENS - Generated from JS tokens */

:root {
  /* Component Sizes */
${sizeVars}

  /* Border Radius Sizes */
${radiusVars}

  /* Avatar Sizes */
${avatarVars}

  /* Component Heights */
${componentHeightVars}
}`;

  return css;
}

export function generateSpaceCSS(space: typeof spaceTokens) {
  const spaceVars = Object.entries(space)
    .map(([key, value]) => `  --we-space-${key}: ${value};`)
    .join('\n');

  const css = `/* SPACE TOKENS - Generated from JS tokens */

:root {
  /* Spacing Values */
${spaceVars}
}`;

  return css;
}

export function generateZIndexCSS(zIndex: typeof zIndexTokens) {
  const zIndexVars = Object.entries(zIndex)
    .map(([key, value]) => `  --we-z-${key}: ${value};`)
    .join('\n');

  const css = `/* Z-INDEX TOKENS - Generated from JS tokens */\n\n:root {\n  /* Stacking Layers */\n${zIndexVars}\n}`;

  return css;
}

/**
 * Copy the woff2 files next to the stylesheet that names them.
 *
 * `fonts.css` refers to them relatively (`./fonts/dm-sans-latin.woff2`), so a bundler resolves them
 * against the emitted stylesheet and serves them from the app's own origin — which is what lets the
 * Electron host's CSP stay at `font-src 'self' data:` with no exception for a font CDN.
 */
function copyFontFiles(outputDir: string) {
  const source = path.resolve(__dirname, '../src/fonts');
  const target = path.join(outputDir, 'fonts');
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(source)) {
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
}

function generateCombinedCSS(outputDir: string) {
  /*
    The typefaces, carried rather than fetched.

    These were three `@import url('https://fonts.googleapis.com/…')` lines, and the file's own
    comment already knew why that was uncomfortable — "the token variables must work offline
    (local-first app), so the main entry makes no network requests". The fonts were the exception,
    and being opt-in did not make them optional: `@we/app-shell` imports this, so every WE user
    fetched them, which meant every launch told Google who was starting the app and when.

    It is also a correctness problem rather than only a privacy one. `DM Sans` is
    `--we-font-family-base`, so a launch with no network — the ordinary case for a local-first
    desktop app — rendered the entire interface in the fallback `sans-serif`.

    Latin and Latin Extended subsets only, matching what Google served: about 92KB for all three,
    against roughly 400KB for every subset including Cyrillic and Vietnamese. `unicode-range` is
    kept verbatim so the browser still picks per character.

    Licences: DM Sans (Colophon Foundry, Jonny Pinhorn) and Boldonse (Manuel Corradine) under the
    SIL Open Font License 1.1; Mozilla Text (Mozilla) likewise.
  */
  const fontsCSS = `/* @we/tokens webfonts — vendored, no network. Import alongside ./index.css. */

/* DM Sans — latin */
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/dm-sans-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* DM Sans — latin-ext */
@font-face {
  font-family: 'DM Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/dm-sans-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

/* Mozilla Text — latin */
@font-face {
  font-family: 'Mozilla Text';
  font-style: normal;
  font-weight: 200 700;
  font-display: swap;
  src: url('./fonts/mozilla-text-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Mozilla Text — latin-ext */
@font-face {
  font-family: 'Mozilla Text';
  font-style: normal;
  font-weight: 200 700;
  font-display: swap;
  src: url('./fonts/mozilla-text-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

/* Boldonse — latin */
@font-face {
  font-family: 'Boldonse';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/boldonse-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* Boldonse — latin-ext */
@font-face {
  font-family: 'Boldonse';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/boldonse-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
`;
  copyFontFiles(outputDir);

  fs.writeFileSync(path.join(outputDir, 'fonts.css'), fontsCSS);

  const indexCSS = `/* @we/tokens CSS variables - Main Entry Point */

/* Design token variables */
@import './animation.css';
@import './border.css';
@import './color.css';
@import './component.css';
@import './font.css';
@import './layout.css';
@import './shadow.css';
@import './size.css';
@import './space.css';
@import './z-index.css';
`;

  fs.writeFileSync(path.join(outputDir, 'index.css'), indexCSS);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateCSS();
}
