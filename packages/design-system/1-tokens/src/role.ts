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
  /**
   * Secondary/muted text — captions, labels, metadata.
   *
   * neutral-600 rather than -500 because -500 measured 4.24:1 on a card, and WCAG AA wants 4.5 for
   * body-sized text. The half-step darker is the smallest change that clears it in every built-in
   * theme, and `contrast.test.ts` is what says so.
   */
  textMuted: 'var(--we-color-neutral-600)',
  /** Tertiary/faint text (placeholders, disabled labels). */
  textFaint: 'var(--we-color-neutral-400)',
  /**
   * Text on an inverted surface — a tooltip, a filled status button.
   *
   * A *fixed* lightness rather than a scale position, for the same reason `overlay` and
   * `shadowColor` are: the scale flips with the theme, so `neutral-0` here read as near-white in a
   * light theme and near-black in a dark one — inverting along with the surface it is supposed to
   * contrast against, which is the one thing it must not do. It is paired with `surfaceInverse`,
   * and the two hold their relationship in both polarities.
   *
   * Hue and saturation stay parametric, so it still follows a theme's neutral tint.
   */
  onInverse: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 98%)',

  /**
   * A surface deliberately opposite to the page — the tooltip, and anything else that must read as
   * "not part of the document".
   *
   * Like `onInverse`, pinned in lightness so it does not flip. The tooltip hardcoded `#222` for
   * exactly this reason and the dark theme carried a CSS override to undo it in dark mode; both are
   * gone, and a theme can now move the pair together.
   */
  surfaceInverse: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 13%)',
  /** Default border/divider. */
  border: 'var(--we-color-neutral-200)',
  /** Emphasised border (focus-adjacent, strong separation). */
  borderStrong: 'var(--we-color-neutral-500)',
  /** The accent (interactive emphasis). */
  accent: 'var(--we-color-primary-500)',
  /**
   * Text and icons placed *on* an accent fill. Named for what it sits on, not what it is.
   *
   * A fixed lightness, like `onInverse` and for the same reason: as `neutral-0` it inverted with the
   * theme, so a primary button in a dark theme got near-*black* text on a mid-blue fill. A label on
   * a fill has to contrast with the fill, and the fill does not follow the neutral ramp.
   *
   * Near-white suits an accent dark enough to carry it. A theme whose accent is bright pins the
   * dark end instead — `dark`, `cyberpunk` and `timeline` all do, because white on their accent
   * measures between 2.7 and 3.6:1.
   */
  onAccent: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 98%)',
  /** A de-emphasised accent — accent-tinted fills, selected rows, subtle highlights. */
  accentMuted: 'var(--we-color-primary-100)',
  /**
   * The accent at text contrast — an accented heading, an accent-coloured icon on a surface.
   *
   * Distinct from `accent` because that one is sized for a *fill*, where the text sits on top of it
   * and `onAccent` supplies the contrast. Used as a foreground on an ordinary surface the same
   * value is often too light to read, which is why templates reached past it for primary-600/700.
   * A theme with a pale accent has to move this further than `accent` to stay legible; one with a
   * dark accent may set them equal. Only a second role can say either.
   */
  accentText: 'var(--we-color-primary-700)',
  /**
   * Hover and pressed states for an accent *fill* — the primary button, chiefly.
   *
   * `surfaceHover` / `surfaceActive` already exist for the neutral case and these are the same
   * argument: a theme that pins `accent` but leaves its states on the scale gets a button that
   * jumps to an unrelated colour under the pointer, because the pin and the scale no longer agree
   * about what the accent is.
   */
  accentHover: 'var(--we-color-primary-600)',
  accentActive: 'var(--we-color-primary-700)',

  /** Hover tint on a surface (menu items, list rows, ghost buttons). */
  surfaceHover: 'var(--we-color-neutral-100)',
  /** Pressed tint on a surface. */
  surfaceActive: 'var(--we-color-neutral-200)',

  /**
   * The filled neutral of a *control* — a slider track, a switch track, a progress trough, a
   * scrollbar thumb, a secondary button, a count chip.
   *
   * Added because all of those were borrowing `surfaceActive`, which is a *pressed state*: of its
   * dozen uses only two were ever a press. That made the name a lie and, worse, coupled two things
   * a theme wants to move independently — darkening your pressed state should not darken every
   * slider on the page. The default is the value they were all borrowing, so nothing moves.
   */
  controlSurface: 'var(--we-color-neutral-200)',

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
  // Green and yellow carry far more luminance than red at the same step, so -600 measured 3.0 and
  // 3.7 against their own tints where danger-600 measured comfortably over 4.5. These are the
  // lowest steps that clear AA in every built-in theme.
  successText: 'var(--we-color-success-800)',
  warningText: 'var(--we-color-warning-700)',
} as const;

export type RoleToken = keyof typeof role;
