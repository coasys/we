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

/**
 * The elevation stack, as a relationship rather than three more scale positions.
 *
 * `page` names a step on the scale; the other three are *a constant perceptual distance from it*.
 * That is the only formulation that survives the light/dark inversion, and the reason is worth
 * stating because the obvious alternative looks fine and is not:
 *
 * As scale positions (`page` = neutral-50, `surface` = neutral-0) the whole scale flips together, so
 * their *order* flips too — in dark, a card lands below the page it sits on and a sunken well lands
 * above both. The stack is upside down, and it does not look broken, it looks flat, so what somebody
 * concludes is that the theme is poor rather than inverted.
 *
 * Writing it as a fixed lightness offset in HSL does not fix it either: HSL lightness is a
 * coordinate, not a brightness, so the same five points is 3.6 L* near black and 6.3 L* in the
 * mid-dark range. One constant cannot serve themes sitting at different places on that curve.
 *
 * OKLCH lightness *is* perceptual, so `calc(l + 0.045)` means the same visible step everywhere, at
 * any hue. The relative form also inherits `c` and `h` from whatever `page` resolves to, so a theme
 * that tints its neutrals gets a tinted stack for free — which the scale positions did not do, and
 * which three hand-pinned presets were approximating by eye.
 *
 * Only the *relationship* is in OKLCH. The ramp underneath is still HSL: how the fourteen scale
 * steps are spaced is a separate decision, and one that changes how every theme looks.
 *
 * Two themes still pin their stacks and both have a reason. `black` sits at the sRGB floor, where a
 * +0.045 step and the page round to the same 8-bit value — no formula can help there. `channels`
 * wants its page and its cards identical, separating them with borders, which is a design.
 */
export const role = {
  /** The page/app background behind everything. The stack below is measured from this. */
  page: 'var(--we-color-neutral-50)',
  /** Default surface (cards, panels) — one step above the page, in both polarities. */
  surface: 'oklch(from var(--we-role-page) calc(l + 0.045) c h)',
  /** A surface elevated above its parent. Light themes pair it with shadow; dark themes lighten it. */
  surfaceRaised: 'oklch(from var(--we-role-page) calc(l + 0.1) c h)',
  /**
   * A surface recessed below its parent (wells, input troughs).
   *
   * Measured from `page`, not from `surface`, although it is semantically recessed into a surface:
   * in a light theme `surface` is clamped at white, so a step down from it lands *above* the page
   * and the well disappears. Measuring from the page keeps the three in order at both ends.
   */
  surfaceSunken: 'oklch(from var(--we-role-page) calc(l - 0.035) c h)',
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
  onInverse:
    'oklch(98% calc(min(var(--we-color-neutral-saturation) * 0.0035, 0.18) * 0.0400) var(--we-color-neutral-hue))',

  /**
   * A surface deliberately opposite to the page — the tooltip, and anything else that must read as
   * "not part of the document".
   *
   * Like `onInverse`, pinned in lightness so it does not flip. The tooltip hardcoded `#222` for
   * exactly this reason and the dark theme carried a CSS override to undo it in dark mode; both are
   * gone, and a theme can now move the pair together.
   */
  surfaceInverse:
    'oklch(13% calc(min(var(--we-color-neutral-saturation) * 0.0035, 0.18) * 0.2600) var(--we-color-neutral-hue))',
  /** Default border/divider. */
  border: 'var(--we-color-neutral-200)',
  /** Emphasised border (focus-adjacent, strong separation). */
  borderStrong: 'var(--we-color-neutral-500)',
  /**
   * The accent (interactive emphasis) — a filled button, a selected disc.
   *
   * 700 rather than a mid step, and the reason is a rule worth stating: a filled control wants to
   * be *away* from the middle of the ramp. At 600 the fill lands near 50% lightness, where neither
   * a near-white nor a near-black label clears AA — `black` measured 3.83:1 and `channels` 4.10:1
   * with the derivation already picking the better of the two. There is no label that rescues a fill
   * in that band; the fill has to move.
   */
  accent: 'var(--we-color-primary-700)',
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
  onAccent: 'oklch(100% 0 var(--we-color-neutral-hue))',
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
   *
   * Steps *from* the accent rather than steps on the scale, which is what makes the label safe. The
   * label is chosen against the worst of rest/hover/pressed — it has to stay readable through a
   * click — so three independent scale positions meant three chances to drift somewhere no single
   * label reaches. `black` did exactly that: its rest state was fine and its pressed state at 78.5%
   * lightness dragged the whole choice down to Lc 35. Tied to the fill, they move with it, including
   * when the fill is itself derived out of the middle of the ramp.
   */
  accentHover: 'oklch(from var(--we-role-accent) calc(l - 0.05) c h)',
  accentActive: 'oklch(from var(--we-role-accent) calc(l - 0.09) c h)',

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
  overlay:
    'oklch(4% calc(min(var(--we-color-neutral-saturation) * 0.0035, 0.18) * 0.0800) var(--we-color-neutral-hue) / 60%)',

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
  shadowColor:
    'oklch(4% calc(min(var(--we-color-neutral-saturation) * 0.0035, 0.18) * 0.0800) var(--we-color-neutral-hue))',

  /** The focus ring. `--we-ring-color` resolves to this, so the two cannot drift. */
  focus: 'var(--we-color-primary-500)',

  /**
   * Status as a *fill* — the destructive button, a filled badge, a solid status dot.
   *
   * The vocabulary was asymmetric without these: `accent` had a fill, hover, pressed, foreground,
   * tint and text-weight variant, while danger had a foreground and a tint. So a theme could
   * completely restyle the primary button and could not touch the *delete* button, which was
   * hardcoded to `danger-500` — themeable only through the hue that owns it, which is not the same
   * as being able to say "make destructive actions look like this".
   */
  // 700, matching `accent`, and for the same reason: a filled control near the middle of the ramp
  // has no readable label at either end. `cyberpunk` measured 4.42:1 with the derivation already
  // picking the better of the two.
  danger: 'var(--we-color-danger-700)',
  dangerHover: 'oklch(from var(--we-role-danger) calc(l - 0.05) c h)',
  dangerActive: 'oklch(from var(--we-role-danger) calc(l - 0.09) c h)',
  success: 'var(--we-color-success-700)',
  warning: 'var(--we-color-warning-700)',

  /**
   * Text and icons on a status fill — the destructive button's label.
   *
   * One role between the three fills rather than three `on*` roles: exactly one component puts text
   * on a status fill, the three fills are siblings at the same step, and `applyAutoContrast` picks
   * this against the worst of them, so it is both sufficient and self-correcting.
   *
   * It exists because the audit found the button was a near-white label on `danger-500` — and a
   * scale step *inverts*, so in a dark theme that fill lands light and the label sat on it at about
   * 2:1. Nothing caught it because no contrast pair named the button. One does now.
   */
  onStatus: 'oklch(100% 0 var(--we-color-neutral-hue))',

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
  dangerText: 'var(--we-color-danger-700)',
  // Green and yellow carry far more luminance than red at the same step, so -600 measured 3.0 and
  // 3.7 against their own tints where danger-600 measured comfortably over 4.5. These are the
  // lowest steps that clear AA in every built-in theme.
  successText: 'var(--we-color-success-700)',
  warningText: 'var(--we-color-warning-700)',
} as const;

export type RoleToken = keyof typeof role;

/**
 * The stack as scale positions, for a browser without relative colour syntax.
 *
 * Correct in light and inverted in dark — which is exactly the behaviour before the change, so an
 * old browser is no worse off than it was, and every current one gets a stack that holds. Relative
 * colour syntax landed in Chrome 119, Safari 16.4 and Firefox 128; Electron has had it throughout.
 *
 * Deliberately not `color-mix`, which is more widely supported and wrong for the job: mixing a
 * percentage toward white moves by a share of the distance remaining, so the same 8% is 0.4 points
 * from a near-white page and 7 points from a dark one — less even than the HSL it would replace.
 */
export const ROLE_ELEVATION_FALLBACK = {
  surface: 'var(--we-color-neutral-0)',
  surfaceRaised: 'var(--we-color-neutral-0)',
  surfaceSunken: 'var(--we-color-neutral-100)',
} as const;
