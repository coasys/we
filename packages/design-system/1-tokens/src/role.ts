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
 * OKLCH lightness *is* perceptual, so `calc(l + 0.025)` means the same visible step everywhere, at
 * any hue. The relative form also inherits `c` and `h` from whatever `page` resolves to, so a theme
 * that tints its neutrals gets a tinted stack for free — which the scale positions did not do, and
 * which three hand-pinned presets were approximating by eye.
 *
 * Only the *relationship* is in OKLCH. The ramp underneath is still HSL: how the fourteen scale
 * steps are spaced is a separate decision, and one that changes how every theme looks.
 *
 * Two themes still pin their stacks and both have a reason. `black` sits at the sRGB floor, where a
 * step this size and the page round to the same 8-bit value — no formula can help there. `channels`
 * wants its page and its cards identical, separating them with borders, which is a design.
 */
import { FAMILY_ROLES, FAMILY_STATE_FALLBACKS } from './familyRoles.js';

export const role = {
  /**
   * The plane a space's own content sits on, a step above the chrome framing it. The stack below is
   * measured from this.
   *
   * ## Why this is derived and `chrome` is the anchor
   *
   * It was the other way round — `page` held the scale position and `chrome` was `page` minus a
   * step — and it could not express the thing it was asked for twice in a row: lift the content
   * without lifting the furniture. Every offset from `page` moves when `page` moves, so "raise one,
   * hold the other" had no spelling at all, and tuning either knob silently retuned the other.
   *
   * Anchoring the app's ground and lifting the content off it gives two independent numbers, which
   * is what the two questions actually are: *how dark is this app* (the scale position on `chrome`)
   * and *how far does a space stand off it* (the step here).
   *
   * The whole surface stack still hangs off `page` rather than off `chrome`, and that is deliberate:
   * a card is measured from what it sits on, and it sits on a space's content, not on the rail down
   * the side of the window.
   */
  page: 'oklch(from var(--we-role-chrome) calc(l + 0.03) c h)',
  /**
   * The app's own furniture — the sidebar, the module rail, a docked panel's frame.
   *
   * `page` was doing both jobs. It is the background of the plane a *space's template* renders on,
   * and it was also what the host painted its own chrome with, so the two were the same colour by
   * construction and there was nowhere to say otherwise. Every showcase template writes `bg: 'page'`
   * on its root; none of them could express that the workspace is not the furniture around it.
   *
   * Splitting them makes both answers cheap. A theme that wants them identical writes
   * `chrome: var(--we-role-page)` — one line, and the relationship survives the page moving. A theme
   * that wants the content set into its chrome moves this, which is the default below.
   *
   * ## Darker in both polarities, which is why this needs no pin
   *
   * The furniture is the ground and a space's content sits a step above it — a greyer rail against
   * lighter content in a light theme, a darker one in a dark theme. That is the same direction at
   * both ends, so it is an ordinary offset like the rest of the stack.
   *
   * It was written the other way first, as a step toward each polarity's *extreme*, which meant it
   * had to invert and so needed a dark pin to say so (since removed). That pin never fired: the pins were
   * applied by `surfacesForPolarity`, which runs when a theme *changes* polarity in the editor, and
   * a built-in dark preset ships its own parameters and never goes through it. So every dark theme
   * fell through to the parametric default and drew the chrome *lighter* than the content: two
   * mechanisms describing the surface stack, and disagreeing. Stated as one direction, there is
   * nothing left to disagree with.
   *
   * ## The anchor, and the offset that is not here
   *
   * This holds the scale position and `page` is a step above it — see there for why round that way.
   * So *this* number is "how dark is the app" and the step on `page` is "how far does a space stand
   * off it", and neither moves the other.
   *
   * The subtraction that used to be here (`page` minus a step) is gone with the inversion, and with
   * it the last of the pair's tuning problems: the two were the same knob wearing two names, so
   * every adjustment to one was an unasked-for adjustment to the other.
   *
   * A step *above* neutral-50 rather than below it, which is the whole app coming up: everything is
   * measured from here, so `page` and the surfaces on it rise by the same amount and every gap
   * above is unchanged. That is the intended shape of this knob — it answers "how dark is this
   * app", and the answers to "how far apart are its planes" live on the roles that step off it.
   */
  chrome: 'oklch(from var(--we-color-neutral-50) calc(l + 0.01) c h)',
  /**
   * Default surface (cards, panels) — one step above the page, in both polarities.
   *
   * `0.025`, down from `0.045`. The wider step was set while the page sat directly on the app's
   * ground; now that a space's content is itself lifted off the `chrome` beneath it, a card at the
   * old distance was two large steps from the furniture and read as floating rather than resting.
   * Tuned by eye against the stack as it now stands.
   */
  surface: 'oklch(from var(--we-role-page) calc(l + 0.025) c h)',
  /**
   * A surface elevated above its parent. Light themes pair it with shadow; dark themes lighten it.
   *
   * The step above `surface` is deliberately *smaller* than the step from `page` to `surface`
   * (0.015 against 0.025). Elevation tapers: the first level has to establish that there is a
   * stack at all, the second only has to sit above one, and it is not competing with the page.
   * This was `+0.1` — a second step of 0.055, wider than the first — which is felt almost entirely
   * in dark themes, where lightness is the only elevation currency (a shadow is invisible on a
   * near-black page) and a floating panel read as glowing rather than raised.
   *
   * So this follows `surface` down: at `0.06` against a surface of `0.025` the second step would be
   * `0.035` and the taper would be inverted — the same shape, and the same glow, that the figure
   * above replaced. It is a ratio to hold, not a number to leave alone.
   *
   * The other half of the separation is the border a popover already carries, which is the same
   * bargain `channels` makes deliberately when it sets its page and its cards to one value.
   */
  surfaceRaised: 'oklch(from var(--we-role-page) calc(l + 0.04) c h)',
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
   * ## A distance, not a point — which is what "opposite" means
   *
   * This was pinned at an absolute `oklch(24.8%)`, on the same reasoning as `onInverse`: a scale
   * position flips with the theme, so a dark tooltip in light mode became a white one in dark. True,
   * and the pin is the wrong correction, because *opposite to the page* is a relationship and a
   * fixed point cannot hold one. The page moved and the tooltip did not:
   *
   * | theme     | chrome | page | surface | sunken | tooltip |
   * |-----------|-------:|-----:|--------:|-------:|--------:|
   * | light     |   97.0 |100.0 |   100.0 |   96.5 |    24.8 |
   * | dark      |   25.0 | 28.0 |    30.5 |   24.5 |    24.8 |
   * | channels  |   24.1 | 27.1 |    29.6 |   23.6 |    24.8 |
   * | black     |   15.7 | 18.7 |    21.2 |   15.2 |    24.8 |
   * | cyberpunk |   28.4 | 31.4 |    33.9 |   27.9 |    24.8 |
   *
   * In `dark` the tooltip sat **0.2 points from the chrome and 0.3 from a sunken well** — not close,
   * identical — so a tooltip over the rail or over an input trough had no edge at all. In `channels`
   * and `black` it came out *lighter* than the chrome, and in `black` lighter than every plane in
   * the theme, which is the inverse inverted. `cyberpunk` read correctly by accident: its floor is
   * 23.5%, so the page floated up and away from the pin. One polarity was served and three themes
   * got noise.
   *
   * ## Why `clamp` rather than a signed step
   *
   * Both polarities want the chip *darker* — a light tooltip in a dark theme was tried and rejected
   * — so there is nothing for a polarity flag to decide. What differs is only the magnitude, and
   * that is because the page itself has moved: nine points below the page is the whole rule, with
   * the upper bound holding light themes at the dark chip they already had (page 100 − 9 would be a
   * pale grey, which is not a tooltip) and the lower bound keeping a theme that is already near the
   * sRGB floor off literal black.
   *
   * So the bounds are not a fudge around a formula that does not work — they are the two ends of the
   * ramp stating what they need, and the middle term is the relationship. Resolved: light 25.0,
   * cyberpunk 22.4, dark 19.0, channels 18.1, black 9.7 — every one of them clear of its own chrome.
   *
   * Nine because `chrome` is three below the page, so the chip lands twice as far below the stack as
   * the stack's own ground is: a step that reads as somewhere else rather than as one more plane.
   * Twelve was tried first, on the reasoning that the chip should clear the whole spread (chrome 25
   * → raised 32 in `dark`), and it overshot — a bubble noticeably inkier than anything else on
   * screen, which draws attention to itself rather than to what it says. The distance only has to
   * beat the largest in-document step, which is three.
   *
   * `c h` from the page, like every other derived surface, so a theme that tints its neutrals gets a
   * tinted chip for free. That replaces an explicit chroma expression whose taper was baked for
   * 24.8% and would have been measured at the wrong lightness from here on; the two differ by about
   * 0.0007 chroma in `dark`, which is why it is not worth a second expression to keep.
   *
   * `onInverse` is re-derived against whatever this resolves to (`AUTO_CONTRAST` in `themeStyles`),
   * so the label follows on its own and needs nothing said here.
   */
  surfaceInverse: 'oklch(from var(--we-role-page) clamp(0.04, calc(l - 0.09), 0.25) c h)',
  /** Default border/divider. */
  border: 'var(--we-color-neutral-200)',
  /** Emphasised border (focus-adjacent, strong separation). */
  borderStrong: 'var(--we-color-neutral-500)',
  /**
   * The edge of an interactive box under the pointer.
   *
   * `border` and `borderStrong` are three steps apart on the ramp — 200 to 500 — because they answer
   * different questions: one is "where does this box end", the other is "these two regions are
   * genuinely separate". Neither is "the pointer is here", and borrowing the second for it made a
   * field's outline jump on hover, loud enough to read as a state change rather than as
   * acknowledgement.
   *
   * Between the two rather than a step from either, for the reason `surfaceSunkenHover` is: it
   * cannot overshoot `borderStrong`, whichever direction the ramp runs, and it needs no signed
   * direction to stay right when the polarity flips.
   *
   * `borderStrong` keeps its own meaning and its own users — the scrollbar thumb, the checkbox, the
   * menu-group dividers — which is why this is a new role rather than a change to that one.
   */
  borderHover: 'color-mix(in oklab, var(--we-role-border) 60%, var(--we-role-border-strong))',
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
   * often not a role at all — `gradient-accent` is two stops, and a derivation has nothing single
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
  /**
   * Hover tint on a surface (menu items, list rows, ghost buttons), and its pressed step.
   *
   * A step from the surface toward the text, rather than a ramp position. The ramp positions these
   * were — `neutral-100` and `neutral-200` — followed the polarity but not the surface: a theme
   * pinning `surface` kept a hover from the ramp it had left, and in every dark theme the two came
   * out on opposite sides of the surface, hover darker and pressed lighter, so a press reversed the
   * direction the hover had just moved. Toward the text is the one direction that is right in both
   * polarities without being told which is which — the move `surfaceSunkenHover` and the soft
   * button's states already make. 9% and 18% reproduce the light themes' old steps within 0.015.
   */
  surfaceHover: 'color-mix(in oklab, var(--we-role-surface) 91%, var(--we-role-text))',
  surfaceActive: 'color-mix(in oklab, var(--we-role-surface) 82%, var(--we-role-text))',

  /**
   * The state contract for anything in a list or a grid of choices: a menu, a listbox, a tree, a
   * calendar's days, a pager, a picker's tiles, a tab strip.
   *
   * `itemHover` is where the pointer is; `selected` and `onSelected` are what has been chosen and
   * its words. Three questions with three answers — they were one colour in places, so hovering a
   * row looked like choosing it — and each a role, so a theme answers them once for every list.
   * The keyboard's position is the focus ring, not a fourth fill.
   */
  itemHover: 'var(--we-role-surface-hover)',
  selected: 'var(--we-role-accent-soft)',
  onSelected: 'var(--we-role-text)',

  /**
   * Text somebody has selected with the pointer — the browser's ::selection, which no role reached,
   * so every theme highlighted in the operating system's blue. A tint of the accent over the text
   * as it is, so selected text keeps its own colour and stays readable.
   */
  textSelection: 'color-mix(in srgb, var(--we-role-accent) 30%, transparent)',

  /**
   * The lifted state of a *well* — an input, a textarea, a select trigger.
   *
   * One state, not the hover/pressed pair every other role here comes in, because a field is not
   * pressed. A button is: you push it, it responds, it springs back. A field is clicked *into* and
   * then focused, and the focus is what persists — so a distinct pressed fill is a flash on
   * mousedown that snaps back on release, which reads as the control losing its place rather than
   * as feedback. Hover, press and focus therefore all resolve here, and the ring is what says
   * "focused". Material, Fluent, Carbon and Primer all draw text fields this way.
   *
   * `surfaceHover` is measured for something sitting ON a surface: a menu item, a list row, a ghost
   * button. Applied to a well it lands at about surface level, so hovering a field made it the same
   * colour as the sheet behind it and the recess vanished under the pointer — the one moment the
   * control should be most clearly a place you put something.
   *
   * Expressed as a mix *toward* `surface` rather than as a signed lightness step, which is what
   * makes it right in both polarities without being told which it is. `STATE_STEPS` is negative in
   * light and dark alike, so `calc(l + step)` darkens either way — correct for a row on a surface,
   * and backwards for a well, where hovering should lift it toward the sheet rather than deepen it.
   * Defining the value in terms of the two things it must sit between makes that structural: it
   * cannot land past `surface`, whichever direction the ramp runs.
   *
   * The same argument the `color-mix` note in `design-utils/isRawCSSValue` makes for control states,
   * and the same one `accentHover` makes for stepping from the role instead of from the scale.
   */
  surfaceSunkenHover: 'color-mix(in oklab, var(--we-role-surface-sunken) 65%, var(--we-role-surface))',

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

  /**
   * The focus ring. `--we-ring-color` resolves to this, so the two cannot drift.
   *
   * The accent itself, rather than `accent-500`. A scale position reaches past the vocabulary to
   * the ramp underneath it, so a theme that states its accent — three of the built-ins do — got a
   * ring in a colour it had not chosen and could not change. Whatever "the interactive colour" means
   * for a theme, the ring is that colour; naming the role is what keeps the two together.
   *
   * It is deliberately not lightened or darkened from the accent. A ring is drawn *beside* what it
   * surrounds rather than on top of it, so it has no label to stay legible against and nothing to
   * derive from — and a theme wanting a distinct ring can state one, which is now a distinction it
   * can express rather than the default it was stuck with.
   */
  focus: 'var(--we-role-accent)',

  /*
    The accent, the statuses and the palette — each family's fill, label, tint, text, border and
    states — are generated from the family registry. See `familyRoles.ts`.
  */
  ...FAMILY_ROLES,
} as const;

export type RoleToken = keyof typeof role;

/**
 * Variables other stylesheets declare *in terms of* a role — one list, read by both ends.
 *
 * A custom property is substituted where it is **declared**. `--we-ring-color: var(--we-role-focus)`
 * lives at `:root`, so it resolves against documentElement's focus role and inherits downward as a
 * finished colour — correct for the document theme and wrong for every scoped one. A space theme
 * could move its accent, watch `--we-role-focus` follow on its own wrapper, and still paint every
 * ring in the personal theme's colour, because the alias had been resolved a level up before the
 * scoped theme was ever consulted.
 *
 * The fix is to restate them wherever a theme is applied, and the hazard is that the generator and
 * the re-statement are two lists that have to agree. They were, and they did not: five of these were
 * emitted at `:root` and none restated, until a ring that would not follow its slider gave it away.
 * So there is one list, `generate-css.ts` emits it and `themeParametersToStyle` re-declares it, and a
 * new alias reaches both by existing.
 *
 * Anything added here must be expressible as a plain value — it is written verbatim into both.
 *
 * `--we-scrollbar-thumb-background` is deliberately absent: it already has a single source in
 * `component.ts`, and listing it here would put its ownership in two places to solve a problem it
 * does not have. `themeParametersToStyle` restates it from that token, and a test holds both.
 */
export const ROLE_ALIASES: Record<string, string> = {
  '--we-color-focus': 'var(--we-role-focus)',
  // Not itself a role, but it resolves through one, so it carries the same hazard — and it had
  // already drifted: the generator's width came from `--we-focus-ring-width` and the re-statement
  // said `2px`, so a theme widening its ring got the wrong ring on every scoped element.
  '--we-focus-outline': '0 0 0 var(--we-focus-ring-width) var(--we-color-focus)',
  '--we-ring-color': 'var(--we-role-focus)',
};

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
 * - **`surfaceInverse`** falls back to the absolute pin it used to be. That is right in light and
 *   indistinguishable from the chrome in dark — which is the defect the relative form fixes, so the
 *   fallback is the old behaviour rather than a new one, and nobody on such a browser is worse off
 *   than they were. A dropped declaration here is a tooltip with no background at all.
 *
 * Deliberately not `color-mix`, which is more widely supported and wrong for the job: mixing a
 * percentage toward white moves by a share of the distance remaining, so the same 8% is 0.4 points
 * from a near-white page and 7 points from a dark one — less even than the HSL it would replace.
 */
export const ROLE_RELATIVE_FALLBACK = {
  surface: 'var(--we-color-neutral-0)',
  surfaceRaised: 'var(--we-color-neutral-0)',
  surfaceSunken: 'var(--we-color-neutral-100)',
  surfaceInverse:
    'oklch(24.8% calc(var(--we-color-neutral-saturation) / 100 * var(--we-color-neutral-chroma-max, 0.18) * 0.4960) var(--we-color-neutral-hue))',
  onAccentMuted: 'var(--we-role-on-accent)',
  ...FAMILY_STATE_FALLBACKS,
} as const;
