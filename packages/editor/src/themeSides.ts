/**
 * Editing a theme's sides — the base, and a `light` or `dark` block holding what differs on the
 * other side — as patches for `updateEditingOverrides`, which spreads a patch over the stored theme
 * and drops a key whose value is undefined.
 *
 * Pure, so the theme panel stays a view of them and the rules can be tested without one.
 */
import {
  basePolarity,
  rangeForPolarity,
  surfacesForPolarity,
  type ThemeOverrides,
  type ThemeSideName,
  withThemeSide,
} from '@we/schema-shared';

export type SidesChoice = ThemeSideName | 'both';

const opposite = (side: ThemeSideName): ThemeSideName => (side === 'dark' ? 'light' : 'dark');

/** What the theme is now: one side, or both. */
export function sidesOf(theme: ThemeOverrides): SidesChoice {
  return theme[opposite(basePolarity(theme))] ? 'both' : basePolarity(theme);
}

/**
 * Settings written to one side of a two-sided theme: as the side block, holding only what differs
 * from the base — a value equal to the base's, or cleared, falls back to it, so the base still
 * reaches that side for everything it has not said differently. Role pins are compared one by one
 * for the same reason. With no side, the settings go to the base as they are.
 */
export function writePatch(
  theme: ThemeOverrides,
  side: ThemeSideName | null,
  settings: Partial<ThemeOverrides>,
): Partial<ThemeOverrides> {
  if (!side) return settings;
  const base = withThemeSide(theme, undefined);
  const block: Record<string, unknown> = { ...theme[side] };
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'roles') {
      const baseRoles = (base.roles ?? {}) as Record<string, string>;
      const own = Object.entries((value ?? {}) as Record<string, string>).filter(([r, v]) => v !== baseRoles[r]);
      if (own.length) block.roles = Object.fromEntries(own);
      else delete block.roles;
    } else if (value === undefined || JSON.stringify(value) === JSON.stringify(base[key as keyof ThemeOverrides])) {
      delete block[key];
    } else {
      block[key] = value;
    }
  }
  return { [side]: block } as Partial<ThemeOverrides>;
}

/**
 * The patch that makes a theme `choice`: one side only, or both.
 *
 * - **One side to the other** turns the same look: the side's polarity, the lightness range its
 *   base preset (or the built-in) uses there, and the surface pins dropped so the stack is drawn as
 *   every preset's is.
 * - **To both** adds a block for the other side, starting from that turn.
 * - **From both to one** keeps that side: the base's own, dropping the block, or the other folded
 *   into the base, which is what somebody who chose it would expect to keep.
 *
 * Undefined when the theme already is `choice`.
 */
export function sidesPatch(theme: ThemeOverrides, choice: SidesChoice): Partial<ThemeOverrides> | undefined {
  const base = basePolarity(theme);
  const other = opposite(base);
  const current = sidesOf(theme);
  if (choice === current) return undefined;
  if (choice === 'both') {
    return { [other]: { polarity: other, ...rangeForPolarity(other, theme.themeName) } } as Partial<ThemeOverrides>;
  }
  if (current === 'both') {
    if (choice === base) return { [other]: undefined } as Partial<ThemeOverrides>;
    const folded = withThemeSide(theme, choice);
    const patch: Record<string, unknown> = { ...folded, light: undefined, dark: undefined };
    for (const key of Object.keys(theme)) if (!(key in folded)) patch[key] = undefined;
    return patch as Partial<ThemeOverrides>;
  }
  return {
    polarity: choice,
    ...rangeForPolarity(choice, theme.themeName),
    roles: surfacesForPolarity(choice, theme.roles),
  };
}
