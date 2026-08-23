import type { ThemeRole } from '@we/schema-shared';
import { role } from '@we/schema-shared';

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
  if (/^(color-mix\(|oklch\(from\s)/.test(value.trim())) return 'relative';
  return 'custom';
}

/**
 * Which role each derived role is measured *from*, read out of the defaults themselves.
 *
 * Parsed rather than listed, so it cannot drift from what the roles actually do — a role that starts
 * or stops being relative changes this by changing itself.
 *
 * It exists because "auto" was hiding a relationship people need to see. Every surface in the
 * elevation stack is a fixed distance from `page`, so moving the page moves all three — which is the
 * point, and is baffling if nothing says so. It reads as being unable to change the page without
 * also changing the cards.
 */
const DERIVED_FROM: Partial<Record<ThemeRole, ThemeRole>> = Object.fromEntries(
  Object.entries(role)
    .map(([name, value]) => {
      const match = /^oklch\(from var\(--we-role-([a-z-]+)\)/.exec(String(value));
      if (!match) return null;
      return [name, match[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
    })
    .filter((entry): entry is [string, string] => entry !== null),
);

/** Sentence-case a role name for display — `surfaceRaised` → `Surface raised`. */
function roleLabel(role: string): string {
  const spaced = role.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * What to show beside the swatch: the token's name, or the rung.
 *
 * `role` is optional and only changes the "auto" case, where naming what the value follows is the
 * difference between a relationship being visible and being a surprise. Setting the role explicitly
 * is what detaches it — which the reset button beside it then offers to undo.
 */
export function roleTierLabel(value: string | undefined, role?: ThemeRole): string {
  const tier = roleTier(value);
  if (tier === 'auto' && role && DERIVED_FROM[role]) return `follows ${roleLabel(DERIVED_FROM[role]!)}`;
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
