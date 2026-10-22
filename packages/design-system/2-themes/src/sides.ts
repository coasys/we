/**
 * The light and dark sides of a theme (`ThemeOverrides.light` / `.dark`), folded into its base.
 *
 * Everything that applies a theme takes the result: one set of parameters, the base with the side
 * worn laid over it. Role pins merge key by key — a side pinning `page` keeps the base's `accent` —
 * and everything else the side names replaces the base's. The side blocks themselves never reach
 * the CSS.
 */
import type { ThemeOverrides } from './overrides';

export type ThemeSideName = 'light' | 'dark';

/** The sides a theme carries, in a fixed order. Empty for a theme with one look. */
export function themeSides(overrides: ThemeOverrides): ThemeSideName[] {
  return (['light', 'dark'] as const).filter((side) => !!overrides[side]);
}

/** The theme as worn on `side`: its base, with that side laid over it when it has one. */
export function withThemeSide(overrides: ThemeOverrides, side: ThemeSideName | undefined): ThemeOverrides {
  const { light, dark, ...base } = overrides;
  const chosen = side === 'light' ? light : side === 'dark' ? dark : undefined;
  if (!chosen) return base;
  return {
    ...base,
    ...chosen,
    ...(base.roles || chosen.roles ? { roles: { ...base.roles, ...chosen.roles } } : {}),
  };
}
