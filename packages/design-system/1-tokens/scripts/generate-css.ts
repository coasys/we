import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { animation as animationTokens } from '../src/animation.js';
import type { border as borderTokens } from '../src/border.js';
import type { color as colorTokens } from '../src/color.js';
import { CHROMA_CEILING, RAMP, STATE_STEPS } from '../src/color.js';
import type { component as componentTokens } from '../src/component.js';
import type { font as fontTokens } from '../src/font.js';
import type { layout as layoutTokens } from '../src/layout.js';
import { role as roleTokens, ROLE_ALIASES, ROLE_RELATIVE_FALLBACK } from '../src/role.js';
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
  /* Themeable: a theme sets --we-theme-border-width to move every stroke at once. */
  --we-border-width: var(--we-theme-border-width, ${border.width});

  /* Semantic border radius alias (override in themes) */
  --we-border-radius: var(--we-radius-400);

  /* Border Colors */
${aliasVars(['--we-border-color', '--we-border-color-strong'])}

  /* Focus ring color — resolves to the focus role, so a theme pinning that role moves the ring
     with it. There is deliberately no separate theme key: two ways to say one thing is how they
     drift, and the role is the one that belongs to the vocabulary. */
${aliasVars(['--we-ring-color'])}
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
        /*
          Where this step lands between the theme's floor and ceiling.

          `t` is the fraction of the way up the ramp, and polarity decides which end the scale's own
          numbering starts from — light counts up from the floor, dark counts down from the ceiling.
          Both are folded into two internal numbers so the whole thing stays one multiply-add that
          CSS can evaluate, but neither is authored: a theme says `polarity`, `lightnessFloor` and
          `lightnessCeiling`, which are the three things somebody can actually picture.
        */
        `  --we-color-lightness-${key}: calc(var(--we-color-lightness-floor) + (${parseFloat(value) / 100} - var(--we-color-ramp-offset)) * var(--we-color-ramp-direction) * (var(--we-color-lightness-ceiling) - var(--we-color-lightness-floor)));`,
    )
    .join('\n');

  const colorTypes = ['neutral', 'primary', 'success', 'warning', 'danger'];
  const colorPalettes = colorTypes
    .map((type) => {
      const paletteVars = Object.keys(color.lightness)
        .map((lightnessKey) => {
          const saturationVar =
            type === 'neutral' ? 'var(--we-color-neutral-saturation)' : 'var(--we-color-saturation)';
          /*
            The taper is computed in CSS, from the lightness this step actually renders at.

            It used to be baked here from the step's *base* lightness, on the reasoning that
            `min(L, 1−L)` is unchanged when the ramp flips. That is true only for an exact
            reflection, and stopped being true the moment a theme could state its own floor and
            ceiling: `neutral-0` has a base lightness of 1 (taper 0) and renders near-*black* in a
            dark theme, where the taper should be about 0.4. The whole ramp came out with its colour
            inverted — nothing at the dark end, too much at the light end — which is a flat grey
            where a violet-grey belonged.

            Doing it in CSS needs the lightness to be unitless, since `calc()` cannot divide a
            percentage into the number a chroma has to be. `oklch()` takes either, so the ramp emits
            numbers and the taper reads them.
          */
          /*
            Saturation as a fraction of what this hue can hold, not of a flat constant.

            `--we-color-<family>-chroma-max` is published by `applyThemeVars`, which measures the
            sRGB boundary for the hue the theme actually chose. The fallback is the flat ceiling,
            which is what the static CSS has to use before any theme is applied — and what an
            unthemed page keeps.
          */
          const l = `var(--we-color-lightness-${lightnessKey})`;
          // max(0, …) because a ceiling above 1 puts the top of the ramp past white, where the
          // taper would otherwise go negative and take the chroma with it.
          const taper = `2 * max(0, min(${l}, 1 - ${l}))`;
          const chroma = `calc(${saturationVar} / 100 * var(--we-color-${type}-chroma-max, ${CHROMA_CEILING}) * ${taper})`;
          return `  --we-color-${type}-${lightnessKey}: oklch(var(--we-color-lightness-${lightnessKey}) ${chroma} var(--we-color-${type}-hue));`;
        })
        .join('\n');

      return `  /* ${type.charAt(0).toUpperCase() + type.slice(1)} Colors */
${paletteVars}`;
    })
    .join('\n\n');

  const css = `/* COLOR TOKENS - Generated from JS tokens */

:root {
  /* Color System Configuration */
  /* Unitless, so the chroma taper can be arithmetic on them. What a theme *states* is still a
     percentage — themeParametersToStyle converts on the way out. A backtick in this comment would end the
     template literal it lives in, which is the fifth time that has happened in this repo. */
  --we-color-lightness-floor: ${parseFloat(color.config.lightnessFloor) / 100};
  --we-color-lightness-ceiling: ${parseFloat(color.config.lightnessCeiling) / 100};
  --we-color-ramp-offset: ${RAMP[color.config.polarity].offset};
  --we-color-ramp-direction: ${RAMP[color.config.polarity].direction};
  --we-state-hover: ${STATE_STEPS[color.config.polarity].hover};
  --we-state-active: ${STATE_STEPS[color.config.polarity].active};
  --we-color-saturation: ${color.config.saturation};
  --we-color-neutral-saturation: ${color.config.neutralSaturation};

  /* Color Hues */
${hueVars}

  /* Lightness Scale */
${lightnessVars}

${colorPalettes}

  /* Base Colors */
  --we-color-white: oklch(var(--we-color-lightness-0) 0 var(--we-color-neutral-hue));
  --we-color-black: oklch(var(--we-color-lightness-1000) 0 var(--we-color-neutral-hue));

  /* Semantic Roles — intent over scale position. Defaults are parametric expressions
     so every theme keeps working untouched; themes may pin individual roles
     (ThemeOverrides.roles in @we/themes → --we-role-*). */
${roleVars}

  /* Focus Colors */
${aliasVars(['--we-color-focus'])}
  /* Themeable width, like --we-border-width: a focus ring is a stroke, and a theme that
     thickens its borders and cannot thicken its rings looks half-converted. */
  --we-focus-ring-width: var(--we-theme-focus-ring-width, 2px);
${aliasVars(['--we-focus-outline'])}

  /* Gradient */
  --we-gradient-primary: linear-gradient(135deg, oklch(var(--we-color-lightness-500) ${GRADIENT_CHROMA} calc(var(--we-color-primary-hue) - 25)) 0%, oklch(var(--we-color-lightness-500) ${GRADIENT_CHROMA} calc(var(--we-color-primary-hue) + 25)) 100%);
}

@supports not (color: oklch(from red calc(l + 0.1) c h)) {
  :root {
${roleFallbackVars}
  }
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

/**
 * Emit named aliases from the shared list — see ROLE_ALIASES.
 *
 * Taken from there rather than written out here, because the same names have to be re-declared by
 * `themeParametersToStyle` for a scoped theme to reach them, and two lists that must agree is how
 * five of them came to be emitted and none restated.
 */
function aliasVars(names: string[]): string {
  return names.map((name) => `  ${name}: ${ROLE_ALIASES[name]};`).join('\n');
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

const GRADIENT_CHROMA = `calc(min(var(--we-color-saturation) * 0.0035, 0.18) * 0.8)`;

const roleVars = Object.entries(roleTokens)
  .map(([key, value]) => `  --we-role-${camelToKebab(key)}: ${value};`)
  .join('\n');

/*
  Every relative-colour role, restated for a browser that cannot read one.

  Worth having because the failure mode is not "slightly off" — it is a declaration the parser drops
  entirely, leaving cards with no background and captions with no colour. See the note on
  ROLE_RELATIVE_FALLBACK for what each entry degrades to and why.
*/
const roleFallbackVars = Object.entries(ROLE_RELATIVE_FALLBACK)
  .map(([key, value]) => `    --we-role-${camelToKebab(key)}: ${value};`)
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
  /*
    Every step carries the theme's spacing scale.

    Multiplied here rather than left to `fontScale`, which moved spacing as a side effect: the steps
    are in `rem` and `fontScale` sets the root font size, so the only way to ask for a denser layout
    was to also shrink the text. `0` stays `0` — scaling nothing is still nothing, and a `calc()`
    there would turn a plain zero into a length for no reason.
  */
  const spaceVars = Object.entries(space)
    .map(([key, value]) =>
      parseFloat(String(value)) === 0
        ? `  --we-space-${key}: ${value};`
        : `  --we-space-${key}: calc(${value} * var(--we-theme-spacing-scale, 1));`,
    )
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
