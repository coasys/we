import type { ThemeRole } from '@we/schema-shared';

/**
 * Which rung of the ladder a stored role value sits on.
 *
 * The string says it, so nothing needs to be remembered alongside it. It matters because the rungs
 * behave differently under everything else a theme can change: a `token` follows the hue sliders and
 * the light/dark polarity, a `lightness` pin (the form the built-in presets use) follows hue and
 * saturation but holds its lightness against a polarity flip, and a `custom` colour follows nothing
 * at all. Only the last is really "opting out", and the editor should say so rather than making it
 * the silent default.
 */
export type RoleTier = 'auto' | 'token' | 'lightness' | 'relative' | 'custom';

export function roleTier(value: string | undefined): RoleTier {
  if (!value) return 'auto';
  if (/^var\(--we-color-[a-z]+-\d+\)$/.test(value.trim())) return 'token';
  if (/^hsl\(\s*var\(--we-color-[a-z]+-hue\)/.test(value.trim())) return 'lightness';
  // A value expressed *against another role* — "a step lighter than the surface". It survives more
  // than any other pin: a change to the role it references carries through, and because the thing
  // it mixes toward inverts with the theme, so does the direction.
  if (/^color-mix\(/.test(value.trim())) return 'relative';
  return 'custom';
}

/** What to show beside the swatch: the token's name, or the rung. */
export function roleTierLabel(value: string | undefined): string {
  const tier = roleTier(value);
  if (tier === 'token') return /var\(--we-color-([a-z]+-\d+)\)/.exec(value!)![1];
  if (tier === 'lightness') return 'theme tint';
  if (tier === 'relative') return 'relative to another role';
  if (tier === 'custom') return 'custom';
  return 'auto';
}

/**
 * The `roles` value to store after setting one role — `undefined` once nothing is pinned.
 *
 * An empty object would persist as `"roles":{}`, which reads as "this theme pins roles" to anything
 * inspecting it and never becomes false again.
 */
export function nextRoles(
  current: Partial<Record<ThemeRole, string>> | undefined,
  role: ThemeRole,
  value: string | undefined,
): Partial<Record<ThemeRole, string>> | undefined {
  const next = { ...(current ?? {}) };
  if (value === undefined) delete next[role];
  else next[role] = value;
  return Object.keys(next).length ? next : undefined;
}

/**
 * The surface stack a polarity needs, for the Light/Dark buttons.
 *
 * Flipping the multiplier inverts the whole scale, and the four surface roles do not survive that
 * intact: `page` is neutral-50 and `surface` is neutral-0, so in dark the card lands *below* the
 * page it sits on, and the sunken well lands above both. Every dark interface does the reverse —
 * depth is carried by light, because there is no darker left to go.
 *
 * So the Dark button pins the stack, matching what the `dark` preset does. Light clears the pins
 * instead of writing its own: the parametric defaults are already right in that direction, and a
 * theme with no pins is one the hue and lightness sliders still fully control.
 *
 * Clobbering a hand-tuned stack is the intended behaviour rather than a regrettable side effect —
 * a stack tuned for one polarity is not merely stale after a flip, it is inverted, and silently
 * keeping it is what produces a "dark" theme with white cards.
 */
const neutralAt = (lightness: number) =>
  `hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) ${lightness}%)`;

export const DARK_SURFACES: Partial<Record<ThemeRole, string>> = {
  page: neutralAt(10),
  surface: neutralAt(14),
  surfaceSunken: neutralAt(8),
  surfaceRaised: neutralAt(19),
};

export function surfacesForPolarity(
  polarity: 'light' | 'dark',
  current: Partial<Record<ThemeRole, string>> | undefined,
): Partial<Record<ThemeRole, string>> | undefined {
  const next = { ...(current ?? {}) };
  if (polarity === 'dark') Object.assign(next, DARK_SURFACES);
  else for (const role of Object.keys(DARK_SURFACES) as ThemeRole[]) delete next[role];
  return Object.keys(next).length ? next : undefined;
}
