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
  /** A de-emphasised accent — accent-tinted fills, selected rows, subtle highlights. */
  accentMuted: 'var(--we-color-primary-100)',
  /**
   * The accent at text contrast — an accented heading, an accent-coloured icon on a surface.
   *
   * Distinct from `accent` because that one is sized for a *fill*, where the text sits on top of it
   * and `accentText` supplies the contrast. Used as a foreground on an ordinary surface the same
   * value is often too light to read, which is why templates reached past it for primary-600/700.
   * A theme with a pale accent has to move this further than `accent` to stay legible; one with a
   * dark accent may set them equal. Only a second role can say either.
   */
  accentStrong: 'var(--we-color-primary-700)',

  /** Hover tint on a surface (menu items, list rows, ghost buttons). */
  surfaceHover: 'var(--we-color-neutral-100)',
  /** Pressed tint on a surface. */
  surfaceActive: 'var(--we-color-neutral-200)',

  /**
   * The scrim behind a modal or drawer.
   *
   * One value, deliberately: the six hardcoded black alphas this replaces differed by accident
   * rather than by decision, and a scrim that varies by which overlay opened it reads as a bug.
   * Alpha is baked in because a scrim is a finished colour, not a base to tint from.
   */
  overlay: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 4% / 60%)',

  /**
   * The colour shadows are built from — opaque, with the consumer supplying alpha:
   * `color-mix(in srgb, var(--we-role-shadow-color) 12%, transparent)`.
   *
   * Opaque rather than pre-alpha'd because the nine primitives that hardcoded `rgba(0,0,0,…)`
   * used seven different alphas for genuinely different elevations, and collapsing those would
   * flatten the hierarchy. What was never a decision is the *hue*: a black shadow is invisible on
   * a near-black surface, which is why a dark theme has to reach for elevation-by-lightness
   * instead. Pinning this lets a theme tint or lighten shadows rather than work around them.
   */
  shadowColor: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 4%)',

  /** The focus ring. `--we-ring-color` resolves to this, so the two cannot drift. */
  focus: 'var(--we-color-primary-500)',

  /** Tinted surfaces behind status content (alerts, badges, destructive confirmations). */
  dangerSurface: 'var(--we-color-danger-50)',
  successSurface: 'var(--we-color-success-50)',
  warningSurface: 'var(--we-color-warning-50)',

  /**
   * Status as a *foreground* — the error under a field, the warning icon, the "connected" tick.
   *
   * The surfaces above cover a tinted panel and nothing else, so every status message in the repo
   * reached for a scale position instead, and they disagreed: danger text appeared as danger-400,
   * -500 and -600 in three neighbouring files. Splitting foreground from surface also lets a theme
   * do the thing a single value cannot — keep a status legible against its own tint, where the two
   * must move in opposite directions as the theme darkens.
   */
  dangerText: 'var(--we-color-danger-600)',
  successText: 'var(--we-color-success-600)',
  warningText: 'var(--we-color-warning-600)',
} as const;

export type RoleToken = keyof typeof role;
