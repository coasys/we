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
   *
   * The number is an *OKLCH* lightness. It was an HSL one, carried across unconverted when the ramp
   * moved, which is not a rename: 13% HSL is 24.8% OKLCH, so the tooltip came out roughly half as
   * light as it had been. Found by diffing the rendered theme against what it used to be, which is
   * the only way a units mistake inside a fixed constant shows up at all.
   */
  onInverse:
    'oklch(98.5% calc(var(--we-color-neutral-saturation) / 100 * var(--we-color-neutral-chroma-max, 0.18) * 0.0300) var(--we-color-neutral-hue))',

  /**
   * A surface deliberately opposite to the page — the tooltip, and anything else that must read as
   * "not part of the document".
   *
   * Like `onInverse`, pinned in lightness so it does not flip. The tooltip hardcoded `#222` for
   * exactly this reason and the dark theme carried a CSS override to undo it in dark mode; both are
   * gone, and a theme can now move the pair together.
   */
  surfaceInverse:
    'oklch(24.8% calc(var(--we-color-neutral-saturation) / 100 * var(--we-color-neutral-chroma-max, 0.18) * 0.4960) var(--we-color-neutral-hue))',
  /** Default border/divider. */
  border: 'var(--we-color-neutral-200)',
  /** Emphasised border (focus-adjacent, strong separation). */
  borderStrong: 'var(--we-color-neutral-500)',
  /**
   * The accent (interactive emphasis) — a filled button, a selected disc.
   *
   * ## Off the ramp entirely, because a fill is a colour and not a position
   *
   * The surface stack is defined *relative to the page* behind it, so it must invert with the
   * theme. A fill is not: a red is red in a light theme and in a dark one, and an accent is the
   * product's colour rather than a distance from its background. So a fill states its own
   * lightness — see FILL_LIGHTNESS in `color.ts` for why each family sits where it does — and takes
   * only its hue and its chroma budget from the theme.
   *
   * This was step 700, on the rule that "a filled control wants to be away from the middle of the
   * ramp", because at mid lightness neither a near-white nor a near-black label cleared **WCAG 2**
   * AA. That rule does not survive the move to APCA: white on this accent measures Lc 80, well
   * clear of the 45 a UI label needs. It was really a fact about WCAG's flat +0.05, which
   * compresses every ratio near black and made mid-tones score worse than they read.
   *
   * What 700 actually did was invert — L 42 in a light theme and L 78.6 in a dark one — so every
   * dark theme's accent came out a pale lavender and its destructive button a pale pink. `dark`,
   * `cyberpunk` and `timeline` each pinned their way out of it. A default that three of seven
   * presets override is a default that is wrong.
   *
   * The chroma ceiling is the *fill* one, measured at this lightness rather than at the ramp's
   * peak: how much chroma a hue can hold moves a long way with lightness, and using the ramp's
   * figure asked gold for more than it has at L 0.6 and less than it has at L 0.76.
   */
  accent:
    'oklch(calc(var(--we-accent-lightness, 55) * 1%) calc(var(--we-color-saturation) / 100 * var(--we-color-primary-fill-chroma-max, 0.2663)) var(--we-color-primary-hue))',
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
  /**
   * Secondary text on an accent fill — the `textMuted` of fills.
   *
   * The rung that was missing. A surface has three foreground tiers (`text`, `textMuted`,
   * `textFaint`); a fill had exactly one, so a caption under a heading on an accent panel had no
   * role to use. What templates reached for instead was `textMuted` — which is derived against the
   * *page*, so on a fill it is measured against the wrong thing entirely. On the primary gradient
   * `textFaint` came out at Lc 8: present in the DOM, invisible on screen.
   *
   * Alpha over `onAccent` rather than a second derived colour, because the fill it must sit on is
   * often not a role at all — `gradient-primary` is two stops, and a derivation has nothing single
   * to measure against. Compositing solves both stops at once, and any fill added later, for free.
   *
   * 0.8 is measured, not guessed: it holds Lc 55–61 across the gradient's ends and the flat accent —
   * a clear tier below `onAccent`'s 72–80, so the hierarchy reads, and clear of the 45 large/UI
   * floor everywhere. 0.7 falls to 47 on the gradient, which is too near the edge to spend.
   *
   * Know its one limitation before reaching for it: compositing buys separation in proportion to
   * how far the label already is from the fill, so it works on a *light* label over a mid fill and
   * barely registers on a dark one. The `dark` theme pins `onAccent` near-black to reproduce its
   * pre-OKLCH look, and there this drops Lc 37 → 34 — not a tier, rounding. On a fill whose label
   * is dark, carry the hierarchy with size and weight and leave both at `onAccent`.
   */
  onAccentMuted: 'oklch(from var(--we-role-on-accent) l c h / 0.8)',
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
  accentHover: 'oklch(from var(--we-role-accent) calc(l + var(--we-state-hover-accent, var(--we-state-hover))) c h)',
  accentActive: 'oklch(from var(--we-role-accent) calc(l + var(--we-state-active-accent, var(--we-state-active))) c h)',

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
    'oklch(14.6% calc(var(--we-color-neutral-saturation) / 100 * var(--we-color-neutral-chroma-max, 0.18) * 0.2920) var(--we-color-neutral-hue) / 60%)',

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
    'oklch(14.6% calc(var(--we-color-neutral-saturation) / 100 * var(--we-color-neutral-chroma-max, 0.18) * 0.2920) var(--we-color-neutral-hue))',

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
  // Absolute lightnesses, matching `accent` and for the same reason — see the long note there and
  // FILL_LIGHTNESS in color.ts. Each sits where its own hue is most itself rather than where a
  // shared step would put it: gold at the violet's lightness is a stone, and violet at the gold's
  // is a lilac. At step 700 a dark theme's destructive button was pale pink rather than red.
  danger:
    'oklch(62% calc(var(--we-color-saturation) / 100 * var(--we-color-danger-fill-chroma-max, 0.2491)) var(--we-color-danger-hue))',
  success:
    'oklch(75% calc(var(--we-color-saturation) / 100 * var(--we-color-success-fill-chroma-max, 0.2365)) var(--we-color-success-hue))',
  warning:
    'oklch(76% calc(var(--we-color-saturation) / 100 * var(--we-color-warning-fill-chroma-max, 0.1558)) var(--we-color-warning-hue))',

  /**
   * Hover and pressed for each fill, as steps *from* it.
   *
   * One rule rather than a special case: **every fill role has a hover and an active, derived from
   * it.** `danger` grew them first because the destructive button needed them, and leaving `success`
   * and `warning` without was an asymmetry with no reason behind it — a module building a filled
   * success control would have found the vocabulary simply stops.
   *
   * Steps from the fill rather than positions on the scale, which is what keeps them safe: the
   * label is chosen against the worst of rest/hover/pressed, so three independent scale positions
   * meant three chances to drift somewhere no single label reaches. Tied to the fill, they follow
   * it — including when the fill is itself moved out of the middle of the ramp.
   *
   * Nobody has to set these. They exist so that pinning a fill moves its states with it, and so
   * that a theme *can* separate them if it wants to.
   */
  dangerHover: 'oklch(from var(--we-role-danger) calc(l + var(--we-state-hover-danger, var(--we-state-hover))) c h)',
  dangerActive: 'oklch(from var(--we-role-danger) calc(l + var(--we-state-active-danger, var(--we-state-active))) c h)',
  successHover: 'oklch(from var(--we-role-success) calc(l + var(--we-state-hover-success, var(--we-state-hover))) c h)',
  successActive:
    'oklch(from var(--we-role-success) calc(l + var(--we-state-active-success, var(--we-state-active))) c h)',
  warningHover: 'oklch(from var(--we-role-warning) calc(l + var(--we-state-hover-warning, var(--we-state-hover))) c h)',
  warningActive:
    'oklch(from var(--we-role-warning) calc(l + var(--we-state-active-warning, var(--we-state-active))) c h)',

  /**
   * Text and icons on each status fill — the destructive button's label, and its siblings.
   *
   * ## Three roles, where there was one
   *
   * This was a single `onStatus` shared between all three fills, on the reasoning that they were
   * "siblings at the same step" so one label could serve them and `applyAutoContrast` would pick it
   * against the worst. The premise was true and is not any more: fills sit at their own lightness
   * now (see FILL_LIGHTNESS), and those lightnesses are not close — danger is at L 0.62, success at
   * 0.75, warning at 0.76, because that is where those hues actually live.
   *
   * One label across that spread is a compromise rather than a choice. Near-black wins on the two
   * light fills by enough to carry the vote, and lands on the red at Lc 38 — below the 45 floor,
   * and precisely the pale-label-on-red the original `onStatus` was introduced to fix, arrived at
   * from the other direction. Split, each is derived against the fill it actually sits on: white on
   * the red at Lc 72, near-black on gold and green.
   *
   * The three are not merged back the moment they agree. `onAccent` is a separate role from these
   * for the same reason — a label belongs to the fill under it, and sharing one is only ever
   * correct by coincidence.
   */
  onDanger: 'oklch(100% 0 var(--we-color-neutral-hue))',
  onSuccess: 'oklch(100% 0 var(--we-color-neutral-hue))',
  onWarning: 'oklch(100% 0 var(--we-color-neutral-hue))',

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
 * Every role built with relative colour syntax, restated without it.
 *
 * Relative colour syntax landed in Chrome 119, Safari 16.4 and Firefox 128, and Electron has had it
 * throughout — so this is for an old web visitor and nobody else. It has to be *complete*, though,
 * and for a while it was not: it covered the three elevation roles and left the nine others to a
 * parser that drops what it cannot read. A dropped `--we-role-surface` is a card with no background;
 * a dropped `--we-role-on-accent-muted` is a caption that inherits whatever is above it, which on an
 * accent fill is text nobody can see. Same defect, less visible, so it lasted longer.
 *
 * Each entry degrades rather than approximates:
 *
 * - The **elevation stack** falls back to scale positions — correct in light and inverted in dark,
 *   which is exactly where every browser was before the change, so nobody is worse off than they
 *   were.
 * - The **interaction states** fall back to their own base role. A button that does not lighten
 *   under the pointer has lost its feedback; one whose hover declaration was dropped has lost its
 *   *fill*, and flashes transparent mid-click.
 * - **`onAccentMuted`** falls back to `onAccent`. The tier is gone and the hierarchy flattens, but
 *   every word is still legible, which is the property worth keeping when only one can be.
 *
 * Deliberately not `color-mix`, which is more widely supported and wrong for the job: mixing a
 * percentage toward white moves by a share of the distance remaining, so the same 8% is 0.4 points
 * from a near-white page and 7 points from a dark one — less even than the HSL it would replace.
 */
export const ROLE_RELATIVE_FALLBACK = {
  surface: 'var(--we-color-neutral-0)',
  surfaceRaised: 'var(--we-color-neutral-0)',
  surfaceSunken: 'var(--we-color-neutral-100)',
  onAccentMuted: 'var(--we-role-on-accent)',
  accentHover: 'var(--we-role-accent)',
  accentActive: 'var(--we-role-accent)',
  dangerHover: 'var(--we-role-danger)',
  dangerActive: 'var(--we-role-danger)',
  successHover: 'var(--we-role-success)',
  successActive: 'var(--we-role-success)',
  warningHover: 'var(--we-role-warning)',
  warningActive: 'var(--we-role-warning)',
} as const;
