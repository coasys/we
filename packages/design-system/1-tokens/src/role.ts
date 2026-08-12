/**
 * SEMANTIC ROLE TOKENS
 *
 * Colour tokens are scale positions (`neutral-0` … `neutral-1000`); roles are what a component
 * *means* by a colour — "page background", "raised surface", "muted text". A component that writes
 * `bg="neutral-0"` meaning "surface" is right only by convention, and stays right in dark mode only
 * because the whole scale inverts uniformly. Roles name the intent so a theme can redesign a
 * relationship the uniform inversion cannot express — most importantly elevation, which inverts in
 * dark (raised surfaces get lighter instead of casting shadows).
 *
 * Every role defaults to a parametric expression over the scale, so every existing and
 * user-authored theme keeps working untouched; a theme overrides individual roles via
 * `ThemeOverrides.roles` in `@we/themes` (emitted as `--we-role-*` custom properties).
 */

export const role = {
  /** The page/app background behind everything. */
  page: 'var(--we-color-neutral-50)',
  /** Default surface (cards, panels). */
  surface: 'var(--we-color-neutral-0)',
  /** A surface elevated above its parent. Light themes pair it with shadow; dark themes lighten it. */
  surfaceRaised: 'var(--we-color-neutral-0)',
  /** A surface recessed below its parent (wells, input troughs). */
  surfaceSunken: 'var(--we-color-neutral-100)',
  /** Primary text. */
  text: 'var(--we-color-neutral-900)',
  /** Secondary/muted text. */
  textMuted: 'var(--we-color-neutral-500)',
  /** Tertiary/faint text (placeholders, disabled labels). */
  textFaint: 'var(--we-color-neutral-400)',
  /** Text on inverted surfaces (e.g. tooltips). */
  textInverse: 'var(--we-color-neutral-0)',
  /** Default border/divider. */
  border: 'var(--we-color-neutral-200)',
  /** Emphasised border (focus-adjacent, strong separation). */
  borderStrong: 'var(--we-color-neutral-500)',
  /** The accent (interactive emphasis). */
  accent: 'var(--we-color-primary-500)',
  /** Text/icon colour on top of the accent. */
  accentText: 'var(--we-color-neutral-0)',
} as const;

export type RoleToken = keyof typeof role;
