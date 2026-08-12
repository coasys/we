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

  const css = `/* ANIMATION TOKENS - Generated from JS tokens */

:root {
  /* Transition Speeds */
${transitionVars}
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
}`;

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

function generateCombinedCSS(outputDir: string) {
  // The webfont fetches live in their own opt-in file: the token variables must
  // work offline (local-first app), so the main entry makes no network requests.
  // A host that wants the hosted faces imports '@we/tokens/css/fonts' alongside.
  const fontsCSS = `/* @we/tokens webfonts — opt-in, network-fetching. Import alongside ./index.css. */

@import url('https://fonts.googleapis.com/css2?family=DM+Sans&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Mozilla+Text:wght@200..700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Boldonse&family=Mozilla+Text:wght@200..700&display=swap');
`;
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
