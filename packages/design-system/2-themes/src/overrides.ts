/**
 * The theme vocabulary — every parameter a theme (built-in preset or user-authored) can set.
 *
 * This lived in `@we/schema-shared` because schema nodes can carry a `theme`, but schema-shared is a
 * *consumer* of the vocabulary, not its owner: the keys map onto design-system CSS custom properties,
 * which is design-system knowledge. It lives here now, beside the presets that instantiate it and the
 * mapping (`themeToStyle`) that turns it into CSS; schema-shared re-exports it unchanged.
 */

/**
 * Semantic role slots a theme can override individually.
 *
 * Colour tokens are scale positions (`neutral-0` … `neutral-1000`); roles are what a component
 * *means* by a colour — "page background", "raised surface", "muted text". Every role defaults to a
 * parametric expression over the scale (see the tokens CSS), so existing and user-authored themes
 * keep working untouched — but a theme may pin any role directly, which is what a designed dark
 * theme needs: raised surfaces get *lighter* in dark rather than casting shadows, a relationship a
 * uniform lightness inversion cannot express.
 */
export type ThemeRole =
  | 'page'
  | 'surface'
  | 'surfaceRaised'
  | 'surfaceSunken'
  | 'surfaceHover'
  | 'surfaceActive'
  | 'controlSurface'
  | 'text'
  | 'textMuted'
  | 'textFaint'
  | 'onInverse'
  | 'surfaceInverse'
  | 'border'
  | 'borderStrong'
  | 'accent'
  | 'onAccent'
  | 'accentMuted'
  | 'accentText'
  | 'accentHover'
  | 'accentActive'
  | 'overlay'
  | 'shadowColor'
  | 'focus'
  | 'dangerSurface'
  | 'successSurface'
  | 'warningSurface'
  | 'dangerText'
  | 'successText'
  | 'warningText';

export type ThemeOverrides = {
  /**
   * The vocabulary version this theme was written against — see `migrate.ts`.
   *
   * Written on save, read on load. Absent means "before versioning", which is version 1.
   */
  schemaVersion?: number;

  // Named preset
  themeName?: string; // Named theme preset (e.g. 'dark', 'cyberpunk', 'retro') — sets data-we-theme attribute

  // Color
  primaryHue?: number; // --we-color-primary-hue
  successHue?: number; // --we-color-success-hue
  warningHue?: number; // --we-color-warning-hue
  dangerHue?: number; // --we-color-danger-hue
  neutralHue?: number; // --we-color-neutral-hue
  /**
   * 0–100, as a number rather than a percentage string.
   *
   * OKLCH takes an absolute chroma, and `calc()` cannot turn a percentage into the unitless value
   * a chroma has to be. The range is unchanged, so the editor's slider is unaffected; `migrate.ts`
   * converts stored themes.
   */
  saturation?: number; // --we-color-saturation
  neutralSaturation?: number; // --we-color-neutral-saturation
  /**
   * Which end of the ramp the scale starts from. The whole of "is this a dark theme".
   *
   * Replaces `multiplier`, which was only ever 1 or -1 — a boolean typed as a number — and
   * `subtractor`, which said "reflect the ramp and offset it by this much" and meant nothing to
   * anybody reading it. What an author actually wants to state is where the two ends sit, so they
   * state that.
   */
  polarity?: 'light' | 'dark';
  /**
   * The darkest and lightest lightness this theme uses, as percentages.
   *
   * Together they are also the contrast control the old model had by accident and could not reach:
   * a narrower span is a softer theme, a full 0–100 span is a stark one. `subtractor: '112%'` was
   * this, obfuscated — it meant "floor at 12%" — which is why tuning a dark theme meant guessing at
   * a number and looking.
   */
  lightnessFloor?: string;
  lightnessCeiling?: string;
  ringColor?: string; // --we-ring-color  (focus ring / accent color)

  // Semantic roles — pin individual role variables (--we-role-*) to any CSS color or var().
  // Roles not listed keep their parametric default over the scale.
  roles?: Partial<Record<ThemeRole, string>>;

  // Typography
  fontFamily?: string; // --we-font-family
  /**
   * --we-theme-heading-font-family — a display face for the heading variants of `we-text`.
   *
   * Unset means headings use the body face, which is what every theme did before this existed:
   * one `fontFamily` slot for a token scale that ships three families, so "a display font for
   * headings" was reachable only through a theme's raw CSS.
   */
  headingFontFamily?: string;
  /**
   * --we-font-mono — the face code is set in.
   *
   * Separate from the body face because it is chosen for different reasons: a code block wants
   * fixed advance widths and a clear 0/O and 1/l, which is a property of the typeface rather than
   * a matter of the theme's voice. A theme that only sets `fontFamily` should not silently change
   * what a code block looks like.
   */
  monoFontFamily?: string;
  letterSpacing?: string; // --we-theme-letter-spacing  (e.g. "0.05em" for airy headlines)
  lineHeight?: string; // --we-theme-line-height  (e.g. "1.5" or "relaxed")
  fontScale?: number; // scales root font-size (1 = 100%, 1.125 = 112.5%) — affects all rem-based tokens

  // Shape — radius cascade: component r= prop → component theme → group theme → token default
  controlRadius?: string; // --we-theme-control-radius  (buttons, badges, tags)
  surfaceRadius?: string; // --we-theme-surface-radius  (modals, drawers, alerts, images, video, embeds)
  inputRadius?: string; // --we-theme-input-radius  (inputs, selects, textareas)

  /**
   * --we-theme-avatar-radius (avatars, and anything else square by construction).
   *
   * Separate from the three above rather than folded into them, because an avatar is the only
   * thing here whose box is guaranteed square — `we-avatar` sets width and height from one
   * `--we-avatar-size`. That guarantee is what makes a *percentage* radius safe: `50%` resolves
   * per-axis, so it is a circle on a square box and an ellipse on anything else. Sharing a value
   * with `surfaceRadius` would mean a theme that rounds its avatars also turns every 16:9 video
   * into an ellipse.
   *
   * Defaults to `50%`, so avatars stay circular in every theme that says nothing. A theme wanting
   * the rounded-square look sets a length here instead (`var(--we-radius-400)`).
   */
  avatarRadius?: string;

  // Density — padding/gap cascade: component p=/gap= prop → component theme → group theme → size default
  controlPaddingX?: string; // --we-theme-control-padding-x  (button / badge / tag horizontal padding)
  controlGap?: string; // --we-theme-control-gap  (button / badge internal icon-text gap)
  controlHeight?: string; // --we-theme-control-height-offset  (px offset added to all fixed-height controls, e.g. '4px', '-4px')
  surfaceSpacing?: string; // --we-theme-surface-spacing  (card / modal / drawer padding)
  surfaceGap?: string; // --we-theme-surface-gap  (card / modal / drawer child gap)

  /**
   * --we-theme-input-spacing (input, textarea, select, number/date/colour pickers).
   *
   * A full padding shorthand rather than an x-only value like `controlPaddingX`, because textarea
   * is in this group and has no fixed height to supply the vertical from. The components have
   * consumed this variable since the cascade was written; what was missing was any way to set it,
   * so inputs had a themeable radius and un-themeable padding.
   */
  inputSpacing?: string;

  // Effects
  shadowIntensity?: 'flat' | 'subtle' | 'elevated' | 'dramatic'; // maps to --we-theme-shadow-preset
  surfaceOpacity?: number; // --we-theme-surface-opacity  (0–1, background alpha for surfaces)
  surfaceBlur?: number; // --we-theme-surface-blur  (px, backdrop-filter blur for frosted glass)

  // Motion
  animationSpeed?: 'none' | 'fast' | 'normal' | 'slow'; // maps to --we-theme-animation-speed-preset
};
