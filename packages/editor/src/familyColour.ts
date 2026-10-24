/**
 * A colour picked for a family, as the settings that make it — not as a pin.
 *
 * A theme states a family as a hue, a saturation and a fill lightness, and everything else follows
 * from those: the tint, the text, the border, the states, the side a two-sided theme turns to, and
 * the corrections that keep its label readable. A picker hands back one colour. Stored as that
 * colour, the family would stop following the theme; stored as the three numbers that produce it,
 * it keeps doing all of that and still lands on what was picked.
 *
 * Saturation is a share of what the hue can hold at that lightness (`maxChromaFor`), which is what
 * the setting means everywhere, so the conversion is exact inside the gamut.
 */
import { maxChromaFor, oklchToRgb, parseColor, rgbToOklch } from '@we/design-utils';
import type { ThemeOverrides } from '@we/schema-shared';
import { capitalise, type ChromaticFamily, COLOR_FAMILIES, type PaletteHue } from '@we/tokens';

/** How far a palette hue may be moved from the colour it is named for. */
export const PALETTE_HUE_REACH = 20;

export interface FamilyColour {
  hue: number;
  /** 0–100, a share of the chroma the hue can hold at this lightness. */
  saturation: number;
  /** 0–100, where the fill sits. */
  lightness: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** The signed distance from `from` to `to` round the wheel, -180 to 180. */
const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * A colour as a family's settings. A palette hue is held within `PALETTE_HUE_REACH` of its name, so
 * "red" can be any red and never orange. A grey keeps the family's hue, having none of its own.
 */
export function colourToFamily(colour: string, family: ChromaticFamily, current?: number): FamilyColour | null {
  const rgba = parseColor(colour);
  if (!rgba) return null;
  const { l, c, h } = rgbToOklch(rgba);
  const named = COLOR_FAMILIES[family].hue;
  let hue = c < 0.01 ? (current ?? named) : h;
  if (COLOR_FAMILIES[family].kind === 'palette')
    hue = named + clamp(turn(named, hue), -PALETTE_HUE_REACH, PALETTE_HUE_REACH);
  hue = Math.round((hue + 360) % 360);
  const lightness = clamp(Math.round(l * 100), 5, 95);
  const ceiling = maxChromaFor(lightness / 100, hue);
  const saturation = clamp(Math.round((c / (ceiling || 1)) * 100), 0, 100);
  return { hue, saturation, lightness };
}

/** The colour a family's settings make, as a hex — what the theme draws before any correction. */
export function familyToColour({ hue, saturation, lightness }: FamilyColour): string {
  const l = lightness / 100;
  const { r, g, b } = oklchToRgb(l, (saturation / 100) * maxChromaFor(l, hue), hue);
  const hex = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * The settings for a picked colour, as a patch for the theme.
 *
 * The fill and its label are unpinned (`''`) — a base preset may pin either, and `dark` pins both —
 * so the fill is the one just picked and its label is chosen against it rather than left as a
 * label chosen for some other colour.
 */
export function familyPatch(
  theme: ThemeOverrides,
  family: ChromaticFamily,
  colour: FamilyColour,
): Partial<ThemeOverrides> {
  const roles = { ...theme.roles, [family]: '', [`on${capitalise(family)}`]: '' } as ThemeOverrides['roles'];
  if (COLOR_FAMILIES[family].kind === 'palette') {
    const hues = { ...theme.palette?.hues, [family as PaletteHue]: { ...colour } };
    return { palette: { ...theme.palette, hues }, roles };
  }
  return {
    [`${family}Hue`]: colour.hue,
    [`${family}Saturation`]: colour.saturation,
    [`${family}Lightness`]: colour.lightness,
    roles,
  } as Partial<ThemeOverrides>;
}

/** Back to what the theme and its preset say for the family, with no pick and no pin of its own. */
export function familyResetPatch(theme: ThemeOverrides, family: ChromaticFamily): Partial<ThemeOverrides> {
  const roles = { ...theme.roles } as Record<string, string>;
  delete roles[family];
  delete roles[`on${capitalise(family)}`];
  const keptRoles = Object.keys(roles).length ? (roles as ThemeOverrides['roles']) : undefined;
  if (COLOR_FAMILIES[family].kind === 'palette') {
    const hues = { ...theme.palette?.hues };
    delete hues[family as PaletteHue];
    const palette = { ...theme.palette, hues: Object.keys(hues).length ? hues : undefined };
    return { palette, roles: keptRoles };
  }
  return {
    [`${family}Hue`]: undefined,
    [`${family}Saturation`]: undefined,
    [`${family}Lightness`]: undefined,
    roles: keptRoles,
  } as Partial<ThemeOverrides>;
}

/** Whether two colours are far enough apart to say so — a distance in OKLab, about two shades. */
export function visiblyDifferent(a: string, b: string): boolean {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return false;
  const x = rgbToOklch(pa);
  const y = rgbToOklch(pb);
  const ab = (p: { c: number; h: number }) => [
    p.c * Math.cos((p.h * Math.PI) / 180),
    p.c * Math.sin((p.h * Math.PI) / 180),
  ];
  const [xa, xb] = ab(x);
  const [ya, yb] = ab(y);
  return Math.hypot(x.l - y.l, xa - ya, xb - yb) > 0.02;
}

/**
 * A theme's saturations moved from `from` to `to` — the whole theme, or the palette alone — every
 * family that has its own scaled by the same ratio.
 *
 * A family picked as a colour holds a saturation of its own, which outranks the theme's, so moving
 * the theme's alone left every picked family where it was and the slider read as broken. Scaled from
 * where each stood when the slider was taken (`start`), not from the last frame, so a drag there and
 * back lands where it began. Neutral is left alone: it is the greys, with a control of its own.
 */
export function scaledSaturations(
  start: ThemeOverrides,
  from: number,
  to: number,
  scope: 'theme' | 'palette',
): Partial<ThemeOverrides> {
  const scale = (value: number) => Math.round(clamp(from > 0 ? (value * to) / from : to, 0, 100));
  const hues = start.palette?.hues
    ? Object.fromEntries(
        Object.entries(start.palette.hues).map(([hue, own]) => [
          hue,
          own?.saturation === undefined ? own : { ...own, saturation: scale(own.saturation) },
        ]),
      )
    : undefined;
  if (scope === 'palette') return { palette: { ...start.palette, saturation: to, ...(hues && { hues }) } };
  const patch: Record<string, unknown> = { saturation: to };
  for (const family of ['accent', 'success', 'warning', 'danger'] as const) {
    const own = start[`${family}Saturation`];
    if (own !== undefined) patch[`${family}Saturation`] = scale(own);
  }
  if (start.palette) {
    const own = start.palette.saturation;
    patch.palette = { ...start.palette, ...(own !== undefined && { saturation: scale(own) }), ...(hues && { hues }) };
  }
  return patch as Partial<ThemeOverrides>;
}
