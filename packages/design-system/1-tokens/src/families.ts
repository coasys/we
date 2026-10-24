/**
 * The colour families — the one list every colour-family-shaped thing is generated from.
 *
 * ## Why a registry
 *
 * A family (the accent, danger, a palette hue) used to be spelt out by hand in eight places: the
 * hues, the ramps, the roles, the contrast derivation's lists, the contrast suite, the theme
 * editor, the validator and the docs. Adding one meant finding all eight, and the audit that led
 * here found them out of step. So a family is one entry, and the ramp, its roles
 * (`<family>`, `on-<family>`, `<family>-soft`, `<family>-text`, `<family>-border`, hover and
 * pressed), the variables a theme restates, its settings and its place in the contrast derivation
 * all come from it.
 *
 * ## Two kinds
 *
 * - **Semantic** families carry a meaning the app relies on: the accent (what is interactive,
 *   selected or focused) and the three statuses. Status uses these, never the palette.
 * - **Palette** hues carry no meaning of their own. They tell things apart — tags, categories,
 *   avatars, chart series, "AI is purple" — and the template decides what each stands for. Ten,
 *   about 36° apart on the OKLCH hue circle, so neighbours stay distinct in every theme; ten is
 *   about the most people can tell apart as categories.
 *
 * Neutral is a family too, but not one of these: it is the greys everything else sits on, with its
 * own hue and saturation, and its roles (`neutral`, `on-neutral`, …) are built from the surface and
 * text roles rather than from a fill. See `role.ts`.
 */
import type { ColorLightnessToken } from './color.js';

export interface ColorFamily {
  kind: 'semantic' | 'palette';
  /** Default OKLCH hue angle. */
  hue: number;
  /**
   * Default fill lightness, 0–1: where this hue is most itself. Absolute rather than a ramp step,
   * because a fill does not invert with the theme — see FILL_LIGHTNESS in `color.ts`.
   */
  fill: number;
  /**
   * The most chroma the fill asks for before a theme is applied and measures the real gamut
   * boundary for its hue (`applyThemeVars` publishes `--we-color-<family>-fill-chroma-max`).
   */
  fillChroma: number;
  /** The ramp steps the tinted fill, the coloured text and the coloured border take. */
  soft: ColorLightnessToken;
  text: ColorLightnessToken;
  border: ColorLightnessToken;
}

export const SEMANTIC_FAMILIES = ['accent', 'success', 'warning', 'danger'] as const;
export const PALETTE_HUES = [
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

export type SemanticFamily = (typeof SEMANTIC_FAMILIES)[number];
export type PaletteHue = (typeof PALETTE_HUES)[number];
/** A family with a fill — every family but neutral. */
export type ChromaticFamily = SemanticFamily | PaletteHue;
/** Every family a `tone` can name. */
export type ToneName = 'neutral' | ChromaticFamily;

/** A palette hue's defaults: its lightness is where that hue reads as itself, so yellow is light. */
const paletteHue = (hue: number, fill: number): ColorFamily => ({
  kind: 'palette',
  hue,
  fill,
  fillChroma: 0.2,
  soft: '100',
  text: '700',
  border: '300',
});

export const COLOR_FAMILIES: Record<ChromaticFamily, ColorFamily> = {
  // The figures the semantic families had before the registry, so nothing renders differently.
  accent: { kind: 'semantic', hue: 288, fill: 0.55, fillChroma: 0.2663, soft: '100', text: '700', border: '300' },
  success: { kind: 'semantic', hue: 145, fill: 0.75, fillChroma: 0.2365, soft: '50', text: '700', border: '300' },
  warning: { kind: 'semantic', hue: 90, fill: 0.76, fillChroma: 0.1558, soft: '50', text: '700', border: '300' },
  danger: { kind: 'semantic', hue: 17, fill: 0.62, fillChroma: 0.2491, soft: '50', text: '700', border: '300' },
  red: paletteHue(25, 0.6),
  orange: paletteHue(55, 0.7),
  yellow: paletteHue(95, 0.84),
  lime: paletteHue(125, 0.8),
  green: paletteHue(150, 0.68),
  teal: paletteHue(185, 0.66),
  cyan: paletteHue(215, 0.7),
  blue: paletteHue(255, 0.58),
  purple: paletteHue(300, 0.58),
  pink: paletteHue(345, 0.66),
};

export const CHROMATIC_FAMILIES = [...SEMANTIC_FAMILIES, ...PALETTE_HUES] as readonly ChromaticFamily[];
export const TONES = ['neutral', ...CHROMATIC_FAMILIES] as readonly ToneName[];

/** `accent` → `Accent`, for building role names like `onAccent` and `accentSoft`. */
export const capitalise = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The variable a family's saturation is read from.
 *
 * Each family has its own, so a theme can quieten its warnings without quietening its accent. A
 * semantic family falls back to the theme's `saturation`; a palette hue to the palette's own
 * saturation, then to the theme's — so a theme can make its categories pastel and keep a vivid
 * accent.
 */
export const familySaturationVar = (family: ChromaticFamily): string => `--we-color-${family}-saturation`;

export const familySaturationDefault = (family: ChromaticFamily): string =>
  COLOR_FAMILIES[family].kind === 'palette'
    ? 'var(--we-color-palette-saturation, var(--we-color-saturation))'
    : 'var(--we-color-saturation)';

/**
 * Where a family's fill sits, 0–100, as an expression: the theme's setting for it if there is one,
 * else the family's default — a palette hue's default shifted by the palette's lightness setting.
 */
export const familyFillLightness = (family: ChromaticFamily): string => {
  const { kind, fill } = COLOR_FAMILIES[family];
  const percent = Math.round(fill * 1000) / 10;
  const fallback = kind === 'palette' ? `calc(${percent} + var(--we-color-palette-lightness, 0))` : `${percent}`;
  return `var(--we-${family}-lightness, ${fallback})`;
};
