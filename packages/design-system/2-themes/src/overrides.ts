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
  | 'text'
  | 'textMuted'
  | 'textFaint'
  | 'textInverse'
  | 'border'
  | 'borderStrong'
  | 'accent'
  | 'accentText'
  | 'accentMuted'
  | 'overlay'
  | 'shadowColor'
  | 'focus'
  | 'dangerSurface'
  | 'successSurface'
  | 'warningSurface';

export type ThemeOverrides = {
  // Named preset
  themeName?: string; // Named theme preset (e.g. 'dark', 'cyberpunk', 'retro') — sets data-we-theme attribute

  // Color
  primaryHue?: number; // --we-color-primary-hue
  successHue?: number; // --we-color-success-hue
  warningHue?: number; // --we-color-warning-hue
  dangerHue?: number; // --we-color-danger-hue
  neutralHue?: number; // --we-color-neutral-hue
  saturation?: string; // --we-color-saturation  (e.g. "50%")
  neutralSaturation?: string; // --we-color-neutral-saturation
  multiplier?: number; // --we-color-multiplier
  subtractor?: string; // --we-color-subtractor  (e.g. "108%")
  ringColor?: string; // --we-ring-color  (focus ring / accent color)

  // Semantic roles — pin individual role variables (--we-role-*) to any CSS color or var().
  // Roles not listed keep their parametric default over the scale.
  roles?: Partial<Record<ThemeRole, string>>;

  // Typography
  fontFamily?: string; // --we-font-family
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

  // Effects
  shadowIntensity?: 'flat' | 'subtle' | 'elevated' | 'dramatic'; // maps to --we-theme-shadow-preset
  surfaceOpacity?: number; // --we-theme-surface-opacity  (0–1, background alpha for surfaces)
  surfaceBlur?: number; // --we-theme-surface-blur  (px, backdrop-filter blur for frosted glass)

  // Motion
  animationSpeed?: 'none' | 'fast' | 'normal' | 'slow'; // maps to --we-theme-animation-speed-preset
};
