import {
  APCA_MINIMUM,
  apcaContrast,
  CONTRAST_MINIMUM,
  type ContrastLevel,
  contrastRatio,
  type Gamut,
  maxChromaFor,
  oklchToRgb,
  parseColor,
  type Rgba,
  rgbToOklch,
} from '@we/design-utils';
import type { ColorHueToken, ColorLightnessToken } from '@we/tokens';
import {
  CHROMA_CEILING,
  CHROMA_PER_SATURATION,
  FILL_LIGHTNESS,
  RAMP,
  ROLE_RELATIVE_FALLBACK,
  STATE_STEPS,
  chromaTaper,
  color,
  role,
} from '@we/tokens';

import type { ThemeOverrides, ThemeRole } from './overrides';
import { isThemeName, THEME_PRESETS } from './presets';

/**
 * Parametric keys that map 1:1 to a CSS custom property.
 * Keys that need special multi-var handling (shadowIntensity, animationSpeed, roles) are excluded.
 */
type ParametricKey = Exclude<
  keyof ThemeOverrides,
  // `schemaVersion` is bookkeeping rather than a value — it says which vocabulary the theme was
  // written against and never becomes a custom property.
  | 'themeName'
  | 'polarity'
  | 'lightnessFloor'
  | 'lightnessCeiling'
  | 'shadowIntensity'
  | 'animationSpeed'
  | 'surfaceBlur'
  | 'fontScale'
  | 'spacingScale'
  | 'disabledOpacity'
  | 'roles'
  | 'schemaVersion'
>;

/** camelCase role name → --we-role-<kebab-case> custom property. */
export function roleVar(role: ThemeRole): string {
  return `--we-role-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * What a role *renders as* — which is not what `getPropertyValue` returns.
 *
 * ## The bug this exists to fix
 *
 * A custom property has no type. `getComputedStyle(root).getPropertyValue('--we-role-text-muted')`
 * hands back the declaration's **token stream**, substituted but unevaluated — for a parametric role
 * that is the literal string `oklch(calc(0.2 + (0.51 - 1) * -1 * (1.21 - 0.2)) calc(26 / 100 * …) 288)`.
 * `parseColor` returns null for it, every derivation that read a role this way hit its `continue`,
 * and the whole measure-and-correct layer quietly did nothing.
 *
 * It was invisible because it *degrades to the declared default*, which is a plausible colour. And
 * it worked in exactly the cases somebody would spot-check: a role pinned to a literal parses, so
 * a theme that hand-pinned its way out of a problem measured correctly, while the parametric
 * defaults the derivations exist to correct never got corrected. `contrast.test.ts` resolves those
 * expressions arithmetically itself, so it modelled derivations that were not running and went
 * green over it.
 *
 * ## Why a probe element
 *
 * The only thing that evaluates a `var()`/`calc()` chain is the browser, and it will only do it for
 * a property that has a type. So assign the role to a real colour property on a real element and
 * read *that* back: `backgroundColor` computes to an `rgb()` string whatever the chain contained.
 *
 * The probe lives inside `root` so it inherits the theme being applied — a probe on `document.body`
 * would read the ambient theme when a scoped theme is what is being measured. It is inert: no size,
 * no paint, no pointer, and `position: absolute` keeps it out of layout.
 */
function createRoleProbe(root: HTMLElement): { read: (role: ThemeRole) => Rgba | null; dispose: () => void } {
  const probe = root.ownerDocument.createElement('div');
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
  root.appendChild(probe);
  const view = root.ownerDocument.defaultView;
  return {
    read(role) {
      probe.style.backgroundColor = '';
      probe.style.backgroundColor = `var(${roleVar(role)})`;
      const painted = view?.getComputedStyle(probe).backgroundColor ?? '';
      return parseColor(painted.trim());
    },
    dispose() {
      probe.remove();
    },
  };
}

/**
 * Every role's parametric default, as custom properties.
 *
 * The tokens CSS declares these at :root, which is enough for the document theme and not enough for
 * a theme applied anywhere else. A custom property containing var() is substituted where it is
 * *declared*, so `--we-role-surface: var(--we-color-neutral-0)` computes against :root's colours and
 * inherits downward as a finished value — a scoped space theme could redeclare every colour token on
 * its wrapper and its unpinned roles would still be painted from the personal theme's scale. It is
 * the same hazard `themeToStyle` already re-declares the colour formulas for, and the same one that
 * put an explicit `color:` on the scoped wrapper in TemplateLayout.
 */
const ROLE_DEFAULT_VARS: Record<string, string> = Object.fromEntries(
  Object.entries<string>({ ...role, ...(supportsRelativeColor() ? {} : ROLE_RELATIVE_FALLBACK) }).map(
    ([name, value]) => [roleVar(name as ThemeRole), value],
  ),
);

/**
 * Whether the elevation stack can be expressed as a relationship, or has to fall back to the scale.
 *
 * The tokens CSS carries an `@supports` fallback of its own, but these are written as *inline*
 * custom properties on the theme root, and an inline declaration beats any stylesheet — so without
 * the same test here the fallback would be overwritten by the thing it exists to replace.
 *
 * Unknown counts as supported. Off a browser — a test, a build step — there is no rendering to be
 * wrong about, and answering "unsupported" there would mean every unit test measured the fallback
 * rather than what ships.
 */
function supportsRelativeColor(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  return CSS.supports('color', 'oklch(from red calc(l + 0.1) c h)');
}

/** Maps shadowIntensity preset to the CSS box-shadow value emitted as --we-theme-shadow. */
const SHADOW_INTENSITY_VALUES: Record<NonNullable<ThemeOverrides['shadowIntensity']>, string> = {
  flat: 'none',
  subtle: 'var(--we-shadow-sm)',
  elevated: 'var(--we-shadow-md)',
  dramatic: 'var(--we-shadow-xl)',
};

/** Maps animationSpeed preset to the --we-transition-N overrides applied globally. */
const ANIMATION_SPEED_VARS: Record<NonNullable<ThemeOverrides['animationSpeed']>, Record<string, string>> = {
  none: {
    '--we-transition-100': '0ms',
    '--we-transition-200': '0ms',
    '--we-transition-300': '0ms',
    '--we-transition-400': '0ms',
    '--we-transition-500': '0ms',
  },
  fast: {
    '--we-transition-200': '75ms',
    '--we-transition-300': '125ms',
    '--we-transition-400': '250ms',
    '--we-transition-500': '500ms',
  },
  normal: {},
  slow: {
    '--we-transition-100': '100ms',
    '--we-transition-200': '300ms',
    '--we-transition-300': '500ms',
    '--we-transition-400': '1000ms',
    '--we-transition-500': '2000ms',
  },
};

/** Map parametric ThemeOverrides keys to their CSS custom property equivalents. */
const THEME_CSS_MAP: Record<ParametricKey, string> = {
  // Color
  primaryHue: '--we-color-primary-hue',
  successHue: '--we-color-success-hue',
  warningHue: '--we-color-warning-hue',
  dangerHue: '--we-color-danger-hue',
  neutralHue: '--we-color-neutral-hue',
  saturation: '--we-color-saturation',
  neutralSaturation: '--we-color-neutral-saturation',

  borderWidth: '--we-theme-border-width',
  focusRingWidth: '--we-theme-focus-ring-width',
  // Typography
  fontFamily: '--we-font-family',
  headingFontFamily: '--we-theme-heading-font-family',
  monoFontFamily: '--we-font-mono',
  letterSpacing: '--we-theme-letter-spacing',
  lineHeight: '--we-theme-line-height',
  // Shape
  controlRadius: '--we-theme-control-radius',
  surfaceRadius: '--we-theme-surface-radius',
  inputRadius: '--we-theme-input-radius',
  avatarRadius: '--we-theme-avatar-radius',
  // Density
  controlPaddingX: '--we-theme-control-padding-x',
  controlGap: '--we-theme-control-gap',
  controlHeightOffset: '--we-theme-control-height-offset',
  surfacePadding: '--we-theme-surface-padding',
  surfaceGap: '--we-theme-surface-gap',
  inputPadding: '--we-theme-input-padding',
  // Effects
  surfaceOpacity: '--we-theme-surface-opacity',
};

/** Saturation variable used by each color family. */
const FAMILY_SAT_VAR: Record<ColorHueToken, string> = {
  primary: '--we-color-saturation',
  success: '--we-color-saturation',
  warning: '--we-color-saturation',
  danger: '--we-color-saturation',
  neutral: '--we-color-neutral-saturation',
};

const LIGHTNESS_STEPS = Object.keys(color.lightness) as ColorLightnessToken[];
const COLOR_FAMILIES = Object.keys(color.hues) as ColorHueToken[];

/**
 * Convert a ThemeOverrides object to a CSS style record for inline application.
 *
 * CSS custom properties are resolved at the element where they are DEFINED,
 * not where they are inherited.  :root defines derived tokens like
 *   --we-color-primary-500: hsl(var(--we-color-primary-hue) ...)
 * which are computed once using :root's values.  Children inherit the computed
 * color, so overriding --we-color-primary-hue on a descendant has no effect
 * unless we ALSO re-declare the derived token formulas on that descendant.
 *
 * When a named theme is used (themeName), the CSS theme file sets the input
 * variables via [data-we-theme] selectors. We unconditionally re-declare ALL
 * derived formulas so they resolve locally against whatever inputs the theme sets.
 */
/** Drop absent keys so a spread cannot blank a preset value with an explicit `undefined`. */
function stripUndefined(theme: ThemeOverrides): ThemeOverrides {
  return Object.fromEntries(Object.entries(theme).filter(([, value]) => value !== undefined)) as ThemeOverrides;
}

export function themeToStyle(overrides: ThemeOverrides): Record<string, string> {
  /*
    A named theme brings its own parameters.

    `{ themeName: 'cyberpunk' }` used to re-declare the colour *formulas* while leaving their
    *inputs* — multiplier, subtractor, saturation — inherited from whatever theme was ambient. So a
    scoped cyberpunk inside a light app got cyberpunk's shapes over light's lightness curve: the
    section looked wrong in a way that was hard to name, and right only when the app already
    happened to be on that theme.

    Resolving the preset here rather than duplicating the numbers into each theme's CSS keeps the
    design system owning theme parameters as data — and it means every built-in works immediately,
    with no per-theme edit. Explicit overrides still win, so `{ themeName: 'cyberpunk', primaryHue:
    320 }` is cyberpunk with a different accent, which is what it reads as.
  */
  // Widened to the vocabulary: `THEME_PRESETS` is `as const`, so its inferred union only carries
  // `roles` on the members that happen to pin one, and reading it off the union does not typecheck.
  const preset: ThemeOverrides | undefined =
    overrides.themeName && isThemeName(overrides.themeName) ? THEME_PRESETS[overrides.themeName].parameters : undefined;
  /*
    `roles` merges key by key; every other override replaces.

    A shallow spread was clobbering: pinning one role on a preset that pins its own discarded all of
    them. Editing the accent on `channels` dropped the twelve measured surface and text pins that
    make it look like `channels` at all, and the theme fell apart from a single colour click. The
    user's pin still wins per role — it is the *unpinned* ones that keep the preset's value now,
    which is what "override" means everywhere else in this object.
  */
  const explicit = stripUndefined(overrides);
  const theme: ThemeOverrides = preset
    ? {
        ...preset,
        ...explicit,
        ...(preset.roles || explicit.roles ? { roles: { ...preset.roles, ...explicit.roles } } : {}),
      }
    : overrides;

  // Role defaults first, so an explicit pin below overwrites its own default rather than sitting
  // beside it. See ROLE_DEFAULT_VARS for why they are re-declared at all.
  const style: Record<string, string> = { ...ROLE_DEFAULT_VARS };
  const hasNamedTheme = !!theme.themeName;

  // 1. Set any explicit parametric overrides as custom properties
  for (const [key, cssVar] of Object.entries(THEME_CSS_MAP)) {
    const value = theme[key as ParametricKey];
    if (value !== undefined) style[cssVar] = String(value);
  }

  /*
    The lightness bounds, authored as percentages and emitted as numbers.

    A theme says `lightnessFloor: '19.5%'`, which is what somebody can picture. The ramp needs it
    unitless, because the chroma taper is `2 × max(0, min(l, 1 − l))` and `calc()` cannot divide a
    percentage into the number a chroma has to be. `oklch()` accepts either form for lightness, so
    the conversion happens here and nothing downstream has to care.
  */
  for (const [key, cssVar] of [
    ['lightnessFloor', '--we-color-lightness-floor'],
    ['lightnessCeiling', '--we-color-lightness-ceiling'],
  ] as const) {
    const value = theme[key];
    if (value !== undefined) style[cssVar] = String(parseFloat(value) / 100);
  }

  // `polarity` is the one authored key that is a word rather than a value; it expands to the two
  // numbers the ramp formula multiplies by. See RAMP in @we/tokens for why those are not authored.
  if (theme.polarity !== undefined) {
    style['--we-color-ramp-offset'] = String(RAMP[theme.polarity].offset);
    style['--we-color-ramp-direction'] = String(RAMP[theme.polarity].direction);
    // Which way a hover moves is polarity's business too: away from the page, and the page is at
    // the opposite end in each.
    style['--we-state-hover'] = String(STATE_STEPS[theme.polarity].hover);
    style['--we-state-active'] = String(STATE_STEPS[theme.polarity].active);
  }

  // shadowIntensity → --we-theme-shadow (used by Card and other surface components)
  if (theme.shadowIntensity) {
    style['--we-theme-shadow'] = SHADOW_INTENSITY_VALUES[theme.shadowIntensity];
  }

  // surfaceBlur → --we-theme-surface-blur (backdrop-filter blur for frosted glass)
  // Only emitted when > 0 to avoid triggering GPU compositing on the default state.
  if (theme.surfaceBlur && theme.surfaceBlur > 0) {
    style['--we-theme-surface-blur'] = `${theme.surfaceBlur}px`;
  }

  // animationSpeed → override --we-transition-N tokens consumed by all primitives
  if (theme.animationSpeed) {
    Object.assign(style, ANIMATION_SPEED_VARS[theme.animationSpeed]);
  }

  // Semantic roles → pin individual --we-role-* variables. Roles not listed keep
  // their parametric defaults over the scale (declared in the tokens CSS).
  if (theme.roles) {
    for (const [role, value] of Object.entries(theme.roles)) {
      if (value !== undefined) style[roleVar(role as ThemeRole)] = String(value);
    }
  }

  /*
    Tell the browser which way round its own widgets go.

    Everything the UA draws itself — the popup behind a time input's showPicker(), scrollbars,
    a <select>'s native dropdown — is coloured for `color-scheme`, not for any token, and no CSS
    reaches it. A dark theme that never says so gets light-scheme widgets: a white time picker over
    a dark panel. Darkness here is not a separate flag to keep in sync — it is read from `polarity`,
    which is the same thing said once. A theme that does not state a polarity inherits the ambient
    scheme, which is also right: it did not change one.
  */
  if (theme.polarity !== undefined) {
    style['color-scheme'] = theme.polarity;
  }

  // 2. Re-declare neutral-hue linkage when primaryHue is explicitly overridden
  if (theme.primaryHue !== undefined && theme.neutralHue === undefined) {
    style['--we-color-neutral-hue'] = 'var(--we-color-primary-hue)';
  }

  // 3. Re-declare lightness scale
  // A named theme may move the ramp from its own CSS, so always re-declare.
  const affectsLightness =
    hasNamedTheme ||
    theme.polarity !== undefined ||
    theme.lightnessFloor !== undefined ||
    theme.lightnessCeiling !== undefined;
  if (affectsLightness) {
    for (const step of LIGHTNESS_STEPS) {
      const base = parseFloat(color.lightness[step]);
      style[`--we-color-lightness-${step}`] =
        `calc(var(--we-color-lightness-floor) + (${base / 100} - var(--we-color-ramp-offset)) * ` +
        `var(--we-color-ramp-direction) * (var(--we-color-lightness-ceiling) - var(--we-color-lightness-floor)))`;
    }
  }

  // 4. Re-declare derived color tokens for affected families
  // Named themes: re-declare all families unconditionally (the CSS theme file
  // may change any input variable, and we can't know which without duplicating
  // the theme's values here).
  const affectsAllSatFamilies = hasNamedTheme || theme.saturation !== undefined || affectsLightness;
  for (const family of COLOR_FAMILIES) {
    const hueKey = family === 'neutral' ? 'neutralHue' : (`${family}Hue` as ParametricKey);
    const familyAffected =
      hasNamedTheme ||
      theme[hueKey] !== undefined ||
      (family === 'neutral'
        ? theme.primaryHue !== undefined || theme.neutralSaturation !== undefined || affectsLightness
        : affectsAllSatFamilies);
    if (!familyAffected) continue;

    const satVar = FAMILY_SAT_VAR[family];
    for (const step of LIGHTNESS_STEPS) {
      // The taper reads the step's *rendered* lightness, exactly as the generated CSS does — baked
      // from the base lightness it inverts along the ramp. See the note in generate-css.ts.
      const l = `var(--we-color-lightness-${step})`;
      style[`--we-color-${family}-${step}`] =
        `oklch(${l} ` +
        `calc(var(${satVar}) / 100 * var(--we-color-${family}-chroma-max, ${CHROMA_CEILING}) * ` +
        `2 * max(0, min(${l}, 1 - ${l}))) ` +
        `var(--we-color-${family}-hue))`;
    }
  }

  // 5. Re-declare gradient when primary hue or saturation may have changed
  const affectsPrimaryGradient =
    hasNamedTheme || theme.primaryHue !== undefined || theme.saturation !== undefined || affectsLightness;
  if (affectsPrimaryGradient) {
    style['--we-gradient-primary'] =
      `linear-gradient(135deg, ` +
      `oklch(var(--we-color-lightness-500) calc(min(var(--we-color-saturation) * ${CHROMA_PER_SATURATION}, ${CHROMA_CEILING}) * ${chromaTaper('500')}) calc(var(--we-color-primary-hue) - 30)) 0%, ` +
      `oklch(var(--we-color-lightness-500) calc(min(var(--we-color-saturation) * ${CHROMA_PER_SATURATION}, ${CHROMA_CEILING}) * ${chromaTaper('500')}) calc(var(--we-color-primary-hue) + 30)) 100%)`;
  }

  // 6. Re-declare semantic tokens that alias --we-color-primary-500.
  // These are defined at :root as var() references, but an inline style baked by
  // populateMissingOverrides() or a named theme's CSS rule can pin them to a stale
  // resolved value. Re-declaring them here as formulas ensures they stay in sync
  // with any primary colour change on this element.
  if (affectsPrimaryGradient) {
    style['--we-color-focus'] = 'var(--we-color-primary-500)';
    style['--we-focus-outline'] = '0 0 0 2px var(--we-color-focus)';
  }

  // fontScale: sets font-size on the root element, scaling all rem-based tokens
  if (theme.fontScale !== undefined) {
    style['font-size'] = `${theme.fontScale * 16}px`;
  }

  // Spacing scales on its own, so "denser" does not have to mean "smaller text".
  if (theme.spacingScale !== undefined) style['--we-theme-spacing-scale'] = String(theme.spacingScale);
  if (theme.disabledOpacity !== undefined) style['--we-theme-disabled-opacity'] = String(theme.disabledOpacity);

  return style;
}

/**
 * Write a theme's variables onto an element, removing exactly the ones the previous theme set.
 *
 * The removal bookkeeping is the whole reason this is a function rather than a loop at each call
 * site. Clearing with `style.cssText = ''` is the obvious shortcut and is wrong: the root is shared,
 * and a host publishes layout variables there too. Doing that deleted `--we-dock-right` and
 * `--we-chrome-transition` along with the old theme, so every piece of chrome positioned against a
 * docked panel snapped to the window edge and stayed there until something happened to recompute it.
 * Dragging the panel healed it, which was the tell — a repaint fixing a value nobody had recalculated.
 *
 * State is per element, so two roots (a page and a space-scoped subtree) do not clear each other's
 * variables.
 */
const appliedThemeVars = new WeakMap<HTMLElement, Set<string>>();

/**
 * How long the switch itself cross-fades for, and how long the window stays open.
 *
 * The window has to outlast the fade or the duration is withdrawn mid-flight and everything jumps to
 * its new colour. The margin is generous because it costs nothing: while it is open the only
 * difference is that a colour change would animate, and no colour is changing.
 */
const SWITCH_DURATION_MS = 250;
const SWITCH_WINDOW_MS = 400;
const switchTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function applyThemeVars(root: HTMLElement, theme: ThemeOverrides): void {
  const styles = themeToStyle(theme);
  const previous = appliedThemeVars.get(root);

  /*
    Open the cross-fade window before writing anything.

    Components animate their colours from `var(--we-theme-switch-duration, 0s)`, which is `0s` at all
    other times — deliberately, because that same declaration is what governs a hover *exit*, and a
    duration there is what made a fast pass across a list of buttons leave a trail of decaying
    highlights behind the pointer (see the note in @we/primitives `shared/helpers.ts`). Raising it
    around the switch and lowering it again gives the theme change its cross-fade without a hover exit
    ever inheriting one.

    A `<style>` rule could not do this: primitives paint inside shadow roots, and a custom property is
    the one thing that crosses that boundary, so setting it on the root is what reaches them.
  */
  // Only when there is something to cross-fade *from*. The first application is the initial paint,
  // not a switch, and opening the window for it left every component running a 250ms departure
  // transition for the first fraction of a second of the page's life — long enough to be sampled by a
  // diagnostic reading the value at load, and to report the exact behaviour this is designed to avoid.
  if (previous) {
    root.style.setProperty('--we-theme-switch-duration', `${SWITCH_DURATION_MS}ms`);
    const running = switchTimers.get(root);
    // Switching again mid-fade restarts the window rather than letting the first timer close it early.
    if (running) clearTimeout(running);
    switchTimers.set(
      root,
      setTimeout(() => {
        root.style.removeProperty('--we-theme-switch-duration');
        switchTimers.delete(root);
      }, SWITCH_WINDOW_MS),
    );
  }

  if (previous) {
    for (const prop of previous) {
      if (!(prop in styles)) root.style.removeProperty(prop);
    }
  }
  // Inline, so a theme beats any stylesheet — including a component's own defaults.
  for (const [prop, value] of Object.entries(styles)) root.style.setProperty(prop, value);

  // Tracked alongside the rest, so the next theme clears them: a derived value from the old theme
  // outliving it would be worse than never deriving one.
  const ceilings = applyChromaCeilings(root);

  /*
    One probe for all four derivations, and the guard they used to each repeat.

    Each of them needs to know what a role *renders as*, which only the browser can answer — see
    createRoleProbe. Sharing one element keeps the DOM churn to a single append/remove per theme
    change, and the sequencing still works because each derivation writes to `root.style` and the
    next one reads through a child of `root`.

    ## Each derivation must read everything before it writes anything

    A write to `root.style` invalidates the whole document; the next `getComputedStyle` then forces
    a synchronous recalculation of it. So a loop that reads a role, computes, writes it, and reads
    the next one pays a full recalc *per iteration*.

    Measured on a 583-node document: thirty reads interleaved with writes cost 71.8 ms, and the
    same thirty reads with a single write in front of them cost 0.1 ms. The reads are free; only
    the interleaving is not. Across the four derivations that was about nineteen recalcs per theme
    change, which is what made dragging a colour slider unusable — every frame of the drag applies
    the theme again.

    So each of them below is read-all, then compute, then write-all. That leaves one recalc per
    derivation — four in total, because they genuinely are sequential: fills settle, the label is
    chosen against where they landed, the states follow from the label. Adding a read into the
    middle of a write loop puts the 70 ms back.
  */
  const measurable =
    typeof getComputedStyle === 'function' && root?.nodeType === 1 && root.isConnected;
  if (!measurable) {
    appliedThemeVars.set(root, new Set([...Object.keys(styles), ...ceilings]));
    return;
  }
  const probe = createRoleProbe(root);
  // Order matters: the fill settles first, then the label is chosen against where it landed, then
  // the foregrounds that sit on other surfaces.
  const fills = applyLegibleFills(root, theme, probe);
  const labels = applyAutoContrast(root, theme, probe);
  // After the label, necessarily: which way a hover moves is decided by where the label ended up.
  const states = applyStateDirection(root, probe);
  const foregrounds = applyLegibleForegrounds(root, theme, probe);
  probe.dispose();

  const derived = [...fills, ...labels, ...states, ...foregrounds, ...ceilings];
  appliedThemeVars.set(root, new Set([...Object.keys(styles), ...derived]));
}

/**
 * How much chroma each family may use, given the hue this theme actually chose.
 *
 * A flat ceiling made `saturation` mean different things at different hues, because chroma is
 * absolute where HSL saturation was relative: at mid lightness a violet reaches 0.259 and a teal
 * 0.103, so 100 gave the violet 70% of its range and stopped doing anything to the teal at about
 * 29. Normalising against what the hue can actually hold makes the slider mean one thing —
 * "this fraction of as colourful as this hue gets" — which is what it always read as.
 *
 * Computed here rather than in CSS because the sRGB boundary in OKLCH has no closed form worth
 * writing, and because this is the same shape as the contrast derivation: measure once when the
 * theme is applied, publish a variable, let the ramp use it.
 *
 * Measured at the lightness where chroma peaks, so one number serves the whole ramp; the per-step
 * taper then scales it down toward both ends exactly as before.
 */
function applyChromaCeilings(root: HTMLElement): string[] {
  const written: string[] = [];
  // Same guard as the contrast derivation: nothing to measure off a stub, and asking anyway throws.
  if (typeof getComputedStyle !== 'function' || root?.nodeType !== 1 || !root.isConnected) return written;
  const computed = getComputedStyle(root);

  /*
    The display's gamut, asked once.

    A wide-gamut screen holds meaningfully more chroma — 36% more for a green, 34% for a teal — and
    because the ceiling is already measured at runtime, honouring that is a question of which
    boundary to measure against rather than a second colour pipeline. sRGB stays the answer when the
    display does not say otherwise, and when `matchMedia` is absent altogether: nothing is lost on an
    older screen, the ceiling is simply where it always was.

    Deliberately not a `@media (color-gamut: p3)` block in the stylesheet. The ceiling depends on the
    theme's hue, which CSS cannot compute, so a static block could only carry a flat number — the
    exact thing per-hue normalisation exists to remove.
  */
  const gamut: Gamut = typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches ? 'p3' : 'srgb';

  for (const family of COLOR_FAMILIES) {
    const hue = parseFloat(computed.getPropertyValue(`--we-color-${family}-hue`));
    if (Number.isNaN(hue)) continue;
    const prop = `--we-color-${family}-chroma-max`;
    root.style.setProperty(prop, maxChromaFor(CHROMA_PEAK_LIGHTNESS, hue, gamut).toFixed(4));
    written.push(prop);

    /*
      A second ceiling, measured where that family's *fill* sits.

      The one above serves the ramp, and is measured at L 0.6 because that is where the ramp's
      chroma peaks. A fill does not live on the ramp — it sits at its own lightness (see
      FILL_LIGHTNESS in @we/tokens) — and how much chroma a hue can hold moves a long way with
      lightness: green holds 0.19 at L 0.6 and 0.22 at L 0.75, yellow 0.12 and 0.16. Scaling the
      ramp's ceiling would have asked green and gold for more than they have at 0.6 and less than
      they have where they actually are, which is how a warning fill ends up looking like a stone.
    */
    const fillLightness = FILL_LIGHTNESS[family as keyof typeof FILL_LIGHTNESS];
    if (fillLightness === undefined) continue;
    const fillProp = `--we-color-${family}-fill-chroma-max`;
    root.style.setProperty(fillProp, maxChromaFor(fillLightness, hue, gamut).toFixed(4));
    written.push(fillProp);
  }
  return written;
}

/** Where chroma peaks on the ramp, and so where the family's ceiling is measured. */
const CHROMA_PEAK_LIGHTNESS = 0.6;

/**
 * Fills that move until a label can sit on them.
 *
 * The mirror of the foreground derivation, and the reason it is needed: a filled control near the
 * middle of its theme's ramp has *no* readable label, because both candidates — near-white and
 * near-black — are equidistant from it. No choice of foreground rescues that; the fill has to move.
 *
 * Where "the middle" falls depends on the theme's range, which is why this cannot be a step chosen
 * once. `black` runs the full 0–100 and put the shared step at 58%; `channels` put it at 64%. Both
 * had to pin their way out before this existed, and a theme author would have had to learn the rule
 * to author a dark theme at all.
 *
 * Runs before the label derivation, which then chooses against the fill this settled on.
 */
/**
 * The lightness steps a fill's hover and pressed states sit at, relative to the fill.
 *
 * Shared with `accentHover`/`accentActive` in @we/tokens rather than restated: a fill is only
 * legible if a label works across all three states, so the derivation has to know where the other
 * two land. Moving the fill until the *rest* state clears is not enough — that was `channels`,
 * whose rest state reached Lc 45 and whose pressed state pulled the choice back to 40.
 */
export const FILL_STATE_DELTAS = [0, -0.05, -0.09];

/** The same, for a given polarity — the derivation has to check the states this theme will render. */
export const fillStateDeltas = (polarity: 'light' | 'dark' = 'light') => [
  0,
  STATE_STEPS[polarity].hover,
  STATE_STEPS[polarity].active,
];

export const DERIVED_FILLS: ThemeRole[] = ['accent', 'danger', 'success', 'warning'];

/**
 * Move a fill until some label can sit on it, or report that none can.
 *
 * Pure, and exported, because this is the piece the contrast suite was *reimplementing* — and a
 * reimplementation drifts. It drifted while this was being written: the copy in the test checked
 * only the rest state and kept chroma constant, so it disagreed with what the runtime did and the
 * suite went green over a theme the browser rendered differently. One implementation, two callers:
 * the runtime feeds it colours read from computed style, the test feeds it colours it resolved
 * arithmetically, and neither can invent its own idea of what deriving a fill means.
 *
 * Returns null when nothing in range works, which is the honest answer for a hue whose whole track
 * is too close to both labels.
 */
export function deriveFill(fill: Rgba, labels: Rgba[], minimum: number, deltas = FILL_STATE_DELTAS): Rgba | null {
  const { c, h, l: start } = rgbToOklch(fill);

  /*
    Chroma is clamped to what each lightness can hold.

    Carrying the original chroma toward white pushes the colour out of sRGB, where it clips — and a
    clipped colour's luminance barely moves, so the search walks its whole range and finds nothing.
    A saturated accent cannot stay that saturated as it approaches white.
  */
  const at = (l: number): Rgba => ({ ...oklchToRgb(l, Math.min(c, maxChromaFor(l, h)), h), a: fill.a });

  /** The best any label manages across a fill and both of its derived states. */
  const best = (candidate: Rgba): number => {
    const { c: cc, h: hh, l: ll } = rgbToOklch(candidate);
    const states = deltas.map((d) => {
      const l = Math.min(1, Math.max(0, ll + d));
      return { ...oklchToRgb(l, Math.min(cc, maxChromaFor(l, hh)), hh), a: candidate.a };
    });
    return Math.max(...labels.map((label) => Math.min(...states.map((state) => apcaContrast(label, state)))));
  };

  if (best(fill) >= minimum) return fill;

  for (let step = 1; step <= 100; step++) {
    // Both directions: a light theme's fill escapes downward and a dark theme's upward, and which
    // is which is precisely the thing that depends on the theme rather than on the role.
    for (const l of [start + step * 0.01, start - step * 0.01]) {
      if (l < 0 || l > 1) continue;
      const moved = at(l);
      if (best(moved) >= minimum) return moved;
    }
  }
  return null;
}

/** The two labels any fill has to carry — the full range, hue-tinted so they still belong. */
export function labelCandidates(hue: string): string[] {
  /*
    The full range, not the ends of the theme's neutral ramp.

    A label on a fill is the one place a theme's own lightness bounds should not apply: the fill is
    arbitrary, and clipping the label to a 98/10 window throws away the few points of contrast that
    decide whether a mid-range fill is usable at all.
  */
  return [`oklch(100% 0 ${hue})`, `oklch(0% 0 ${hue})`];
}

/**
 * Which label sits on which fill — and so, below, which way that fill's states move.
 *
 * One label per fill — see the note on `onDanger` in @we/tokens for why the three status fills
 * stopped sharing one.
 */
export const FILL_LABELS: { fill: ThemeRole; label: ThemeRole }[] = [
  { fill: 'accent', label: 'onAccent' },
  { fill: 'danger', label: 'onDanger' },
  { fill: 'success', label: 'onSuccess' },
  { fill: 'warning', label: 'onWarning' },
];

/**
 * How far, and which way, one interaction state moves a fill — given the label that sits on it.
 *
 * Pure and exported for the same reason `deriveFill` is: the contrast suite has to know what the
 * states will render as, and the last time it kept its own copy of a derivation the copy drifted
 * and the suite went green over a theme the browser drew differently. The runtime feeds this
 * colours read off computed style and the test feeds it colours resolved arithmetically; the
 * decision itself is shared and cannot disagree.
 *
 * Away from the label: a label darker than its fill means the fill brightens under the pointer, a
 * lighter one means it deepens. Equal lightness cannot arise in practice — a label matching its
 * fill would be invisible at rest — and deepening is the safe default if it ever did.
 */
export function stateDelta(fill: Rgba, label: Rgba, state: 'hover' | 'active'): number {
  const sign = rgbToOklch(label).l < rgbToOklch(fill).l ? 1 : -1;
  return sign * Math.abs(STATE_STEPS.light[state]);
}

/**
 * A hover moves the fill *away from its label*, whichever way that turns out to be.
 *
 * The rule is not "dark themes lighten". It is that a state which deepens the gap between a fill
 * and the text on it gains contrast, and one that closes the gap loses it — precisely when you are
 * pressing the control and most want to read it. Under the old scale-position scheme this happened
 * by accident, because a fill and its label sat at opposite ends of the ramp, so "one step further
 * along" was always away. Restating the steps as signed lightness deltas lost the accident, and
 * polarity was standing in for it.
 *
 * Polarity is a bad proxy and the failure is not hypothetical either way round. Assume dark themes
 * lighten and a dark theme with a mid accent — which gets a near-*white* label from the derivation
 * — walks its hover into that label: `dark` measured Lc 29 and `black` Lc 33 doing exactly this.
 * Assume everything deepens, which is what shipped instead, and a theme that *pins* a near-black
 * label gets a hover that deepens toward it, which is the same mistake mirrored. That is what
 * turned the selected nav tab the wrong way: `dark` pins a near-black label, so its hover has to
 * lighten, and it was darkening.
 *
 * This was documented as needing a fixed point — the label is derived from the fill, so deriving
 * the states from the label looks circular. It is not, because the order already resolves it: the
 * fill settles first, the label is chosen against where it landed, and only then is there a
 * direction to ask about. Running here, after `applyAutoContrast`, the label is a fact.
 *
 * Written per family rather than globally because the answer genuinely differs between them — a
 * theme can pin a dark label on its accent and leave the derivation to give its danger fill a white
 * one. Each variable falls back to the global pair, so a theme that never needed this is untouched
 * and nothing has to be emitted for the common case.
 *
 * The magnitudes are unchanged; only the sign is decided here.
 *
 * Note `deriveFill` still probes with the deepening direction while it looks for a legible fill.
 * That stays conservative on purpose: it runs before any label exists, and deepening can never walk
 * into the light label it is most likely to be paired with. The cost is that it occasionally moves
 * a fill further than a lightening state would have required.
 */
function applyStateDirection(root: HTMLElement, probe: ReturnType<typeof createRoleProbe>): string[] {
  const written: string[] = [];

  // Read first, write after — see `applyThemeVars` for why the two must not interleave.
  const measured = FILL_LABELS.map(({ fill, label }) => ({
    fill,
    fillColor: probe.read(fill),
    labelColor: probe.read(label),
  }));

  for (const { fill, fillColor, labelColor } of measured) {
    if (!fillColor || !labelColor) continue;
    // The four fill roles are single lowercase words, so the role name *is* the variable suffix.
    for (const state of ['hover', 'active'] as const) {
      const prop = `--we-state-${state}-${fill}`;
      root.style.setProperty(prop, String(stateDelta(fillColor, labelColor, state)));
      written.push(prop);
    }
  }
  return written;
}

function applyLegibleFills(root: HTMLElement, theme: ThemeOverrides, probe: ReturnType<typeof createRoleProbe>): string[] {
  const written: string[] = [];
  const computed = getComputedStyle(root);

  // A plain number, so reading the custom property directly is fine here — it is only colours that
  // need the probe.
  const hue = computed.getPropertyValue('--we-color-neutral-hue').trim() || '264';
  const free = labelCandidates(hue)
    .map((css) => parseColor(css))
    .filter((c): c is Rgba => !!c);
  if (!free.length) return written;

  /*
    Every colour this needs, read before anything is written — see `applyThemeVars`.

    `deriveFill` is pure arithmetic once it has its inputs, so the whole search can happen between
    the reads and the writes.
  */
  const measured = DERIVED_FILLS.filter((role) => theme.roles?.[role] === undefined).map((role) => {
    const labelRole = FILL_LABELS.find((entry) => entry.fill === role)?.label;
    return {
      role,
      fill: probe.read(role),
      // Read the *resolved* colour, not the declared string: a pin is usually an `oklch(…)` over the
      // theme's own hue variables, which only computed style can turn into a number.
      stated: labelRole && theme.roles?.[labelRole] !== undefined ? probe.read(labelRole) : null,
    };
  });

  for (const { role, fill, stated } of measured) {
    if (!fill) continue;

    /*
      A stated label is a *constraint on this search*, not a reason to abandon it.

      This used to offer both candidates regardless, so a theme that pinned a near-black label could
      still have its fill moved to somewhere only white worked — and then have the near-black label
      dropped on top of it. The pin and the derivation were solving for different things and neither
      knew it.

      So when the label this fill carries is stated, it becomes the only candidate: move the fill
      until *that* label reads. The author has said what the text will be; where the fill goes is
      still ours to answer, and answering it with the wrong text in mind is answering a different
      question.

      Where the author has stated the fill too, we skip above and nothing is derived — which is the
      whole design intact rather than overruled. Both stated means they meant both; the editor shows
      the measurement live, and for a built-in preset `contrast.test.ts` records it by name.
    */
    const labels = stated ? [stated] : free;

    const moved = deriveFill(fill, labels, APCA_MINIMUM.ui, fillStateDeltas(theme.polarity));
    if (!moved || moved === fill) continue;

    const { l, c, h } = rgbToOklch(moved);
    const prop = roleVar(role);
    root.style.setProperty(prop, `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(4)} ${h.toFixed(1)})`);
    written.push(prop);
  }
  return written;
}

/**
 * Foregrounds that keep their hue and move their lightness until they are legible.
 *
 * The other derivation picks between two candidates — near-white or near-black — which is right for
 * a label on a fill. It is wrong for these: `dangerText` must stay *red*, so choosing black would
 * lose the thing it is for. What moves is the lightness alone.
 *
 * They are here because a fixed step cannot serve both polarities. A dark theme's background is
 * near its floor, and WCAG 2's flat 0.05 makes every ratio there look better than it reads — which
 * is how this branch came to pin `black`'s muted text and lift `dark`'s floor, both of which moved
 * the score and not the legibility. Measured against APCA instead, every dark built-in failed:
 * muted text at Lc 32–36 against a threshold of 60. No choice of step fixes that, because the step
 * that works in the dark is wrong in the light. Deriving does.
 */
const LEGIBLE_FOREGROUNDS: { fg: ThemeRole; on: ThemeRole; level: ContrastLevel }[] = [
  { fg: 'textMuted', on: 'surface', level: 'body' },
  { fg: 'textFaint', on: 'surface', level: 'ui' },
  { fg: 'accentText', on: 'surface', level: 'body' },
  { fg: 'dangerText', on: 'dangerSurface', level: 'body' },
  { fg: 'successText', on: 'successSurface', level: 'body' },
  { fg: 'warningText', on: 'warningSurface', level: 'body' },
];

/**
 * Walk a colour's lightness away from its background until it clears, keeping hue and chroma.
 *
 * Both directions are tried and the one that gets there first wins, because which way is "away"
 * depends on the theme: muted text darkens on a light card and lightens on a dark one, and that is
 * the whole reason a fixed step could not do this job. Exported for the tests, which have to model
 * what actually renders rather than what is declared.
 */
export function deriveLegible(fg: Rgba, bg: Rgba, minimum: number): string | null {
  const { c, h } = rgbToOklch(fg);
  const start = rgbToOklch(fg).l;
  for (let step = 0; step <= 100; step++) {
    for (const direction of [1, -1]) {
      const l = start + direction * step * 0.01;
      if (l < 0 || l > 1) continue;
      const candidate = { ...oklchToRgb(l, c, h), a: fg.a };
      if (apcaContrast(candidate, bg) >= minimum)
        return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(4)} ${h.toFixed(1)})`;
    }
  }
  return null;
}

function applyLegibleForegrounds(root: HTMLElement, theme: ThemeOverrides, probe: ReturnType<typeof createRoleProbe>): string[] {
  const written: string[] = [];

  // Read first, write after — see `applyThemeVars`.
  const measured = LEGIBLE_FOREGROUNDS
    // A pin is the author overruling the derivation, which they are entitled to do.
    .filter(({ fg }) => theme.roles?.[fg] === undefined)
    .map((pair) => ({ ...pair, text: probe.read(pair.fg), background: probe.read(pair.on) }));

  for (const { fg, level, text, background } of measured) {
    if (!text || !background) continue;
    if (apcaContrast(text, background) >= APCA_MINIMUM[level]) continue;

    const fixed = deriveLegible(text, background, APCA_MINIMUM[level]);
    if (!fixed) continue;
    const prop = roleVar(fg);
    root.style.setProperty(prop, fixed);
    written.push(prop);
  }
  return written;
}

/**
 * Foregrounds whose colour is a *consequence* of the fill they sit on, not a separate decision.
 *
 * Each entry is a foreground role and the fills it has to stay readable against.
 *
 * ## Rest states only, and why that is now sufficient
 *
 * This used to list every hover and pressed variant too — nine fills for `onStatus` — on the rule
 * that "the worst of the fills wins the vote", because a label chosen against the rest state alone
 * went unreadable halfway through a click. That was true while the states moved in a fixed
 * direction: a label could be picked for the rest fill and then have the fill slide underneath it.
 *
 * `applyStateDirection` removes the possibility. A state now moves *away* from whatever label
 * landed on the fill, so hover and pressed are strictly higher contrast than rest, and rest is the
 * worst case by construction. Listing the states as well does not make the choice safer — it makes
 * it wrong, because they are read here *before* the direction has been decided, so they still hold
 * the default deepening. On `timeline`, whose accent is pinned to a sky blue, that mattered: the
 * label was chosen against three fills that were about to move the other way, and it picked white
 * (2.85:1, failing AA) over the near-black that is correct for the fill as it actually renders.
 *
 * The ordering constraint is now one-way and simple. Fills settle, the label is chosen against
 * them, and the states follow from the label.
 */
export const AUTO_CONTRAST: { fg: ThemeRole; against: ThemeRole[] }[] = [
  { fg: 'onAccent', against: ['accent'] },
  { fg: 'onInverse', against: ['surfaceInverse'] },
  // One each, against the fill it actually sits on — see the note on `onDanger` in @we/tokens.
  { fg: 'onDanger', against: ['danger'] },
  { fg: 'onSuccess', against: ['success'] },
  { fg: 'onWarning', against: ['warning'] },
];

/**
 * Of the candidate foregrounds, the one that stays readable against *every* fill it must sit on.
 *
 * The weakest pairing decides rather than the average: a primary button's label has to work at
 * rest, on hover and while pressed, and one chosen against the rest state alone goes unreadable
 * halfway through a click. Ties and unparseable candidates fall back to the first, which is the
 * light one — the conventional default, and the one a designed theme is most likely to want.
 *
 * Separated from the DOM work so the decision can be tested without a browser; `applyAutoContrast`
 * is only the part that measures and writes.
 */
export function pickReadableForeground(candidates: string[], fills: Rgba[]): string {
  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const colour = parseColor(candidate);
    if (!colour) continue;
    /*
      Scored against *both* metrics, as a fraction of what each one asks for.

      This used to score with WCAG 2 alone while `contrast.test.ts` graded the outcome with APCA as
      well, so the label was chosen by one standard and marked by two. On a mid-tone fill the two
      disagree outright — a red at L 0.62 is Lc 72 under white and Lc 38 under near-black, while
      WCAG's flat +0.05 compresses the light end and hands the win to near-black — so the derivation
      picked the label that scored worse by the standard it would be judged on, and reported a
      failure it had caused. Scoring with APCA alone just moves the problem: `timeline`'s sky blue
      takes white at Lc 59 and 2.85:1, which passes APCA and fails AA.

      Normalising each measurement by its own threshold puts them on one scale, and taking the worse
      of the two picks the candidate that comes closest to satisfying both. It reproduces every
      hand-pinned label the built-ins had arrived at independently, which is the check that it is
      the right rule rather than a rule that happens to pass today.

      `ui` thresholds, because this is always a label on a fill — a short interface string, which is
      what that level is for.
    */
    const score = Math.min(
      ...fills.map((fill) =>
        Math.min(
          apcaContrast(colour, fill) / APCA_MINIMUM.ui,
          contrastRatio(colour, fill) / CONTRAST_MINIMUM.ui,
        ),
      ),
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Choose the readable foreground for each auto-contrast pair, and write it.
 *
 * This is what stops a theme author having to know about contrast at all. Pick a pale accent and the
 * button label goes dark on its own; pick a deep one and it goes light. Without it, "choose an
 * accent" is a decision that can silently produce an unreadable button — and the evidence that this
 * matters is that three of the seven *built-in* themes needed exactly this correction by hand.
 *
 * Deliberately skipped where the theme pins the foreground itself: an author who has said what they
 * want is not overruled, even when they are wrong. The contrast test is where being wrong is
 * reported; this is only for the roles nobody has spoken for.
 *
 * Runs after the variables are applied because it has to *measure*: the fill is usually a `var()`
 * chain over a parametric ramp, and the only thing that knows what that resolves to is the browser.
 */
function applyAutoContrast(root: HTMLElement, theme: ThemeOverrides, probe: ReturnType<typeof createRoleProbe>): string[] {
  const computed = getComputedStyle(root);
  const written: string[] = [];

  // Read first, write after — see `applyThemeVars`.
  const measured = AUTO_CONTRAST.filter(({ fg }) => theme.roles?.[fg] === undefined).map(({ fg, against }) => ({
    fg,
    fills: against.map((role) => probe.read(role)).filter((c): c is Rgba => c !== null),
  }));

  for (const { fg, fills } of measured) {
    if (!fills.length) continue;

    // The hue follows the theme's neutral so the label still belongs to it; only the lightness is
    // being decided, and it is allowed the full range — see the note in `applyLegibleFills`.
    const hue = computed.getPropertyValue('--we-color-neutral-hue').trim() || '264';
    const candidates = labelCandidates(hue);

    const prop = roleVar(fg);
    root.style.setProperty(prop, pickReadableForeground(candidates, fills));
    written.push(prop);
  }

  return written;
}

/**
 * The surface stack a polarity needs.
 *
 * Flipping the multiplier inverts the whole scale, and the four surface roles do not survive that
 * intact: `page` is neutral-50 and `surface` is neutral-0, so in dark the card lands *below* the
 * page it sits on, and the sunken well lands above both. Every dark interface does the reverse —
 * depth is carried by light, because there is no darker left to go.
 *
 * So going dark pins the stack, matching what the `dark` preset does. Going light clears the pins
 * instead of writing its own: the parametric defaults are already right in that direction, and a
 * theme with no pins is one the hue and lightness sliders still fully control.
 *
 * It lives here rather than in the editor because two different things change a theme's polarity —
 * the Light/Dark buttons and the base-preset picker — and only one of them was in the editor. A
 * theme that went through the second path kept the stack from the polarity it had left, which is
 * how three clicks produced near-black cards under a light theme's near-black text: 1.12:1.
 *
 * Clobbering a hand-tuned stack is the intended behaviour rather than a regrettable side effect —
 * a stack tuned for one polarity is not merely stale after a flip, it is inverted, and silently
 * keeping it is what produces a "dark" theme with white cards.
 */
const neutralAt = (lightness: number) => {
  const taper = (2 * Math.min(lightness / 100, 1 - lightness / 100)).toFixed(4);
  return (
    `oklch(${lightness}% ` +
    `calc(min(var(--we-color-neutral-saturation) * ${CHROMA_PER_SATURATION}, ${CHROMA_CEILING}) * ${taper}) ` +
    `var(--we-color-neutral-hue))`
  );
};

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

export const isDarkPolarity = (overrides: Pick<ThemeOverrides, 'polarity'>) => overrides.polarity === 'dark';

/**
 * The roles to keep when a theme changes base preset.
 *
 * Carrying the author's own pins across a preset change is right for almost all of them — a
 * hand-picked accent should survive. It is wrong for the four surfaces, which are the ones whose
 * *meaning* depends on the polarity, so those are reconciled and everything else is left alone.
 *
 * Only on an actual change of polarity: re-picking within the same one must leave a tuned stack
 * where it is, or choosing between two dark presets would silently discard the author's work.
 */
export function reconcileSurfaces(
  existing: ThemeOverrides,
  preset: Pick<ThemeOverrides, 'polarity'>,
): Partial<Record<ThemeRole, string>> | undefined {
  if (isDarkPolarity(existing) === isDarkPolarity(preset)) return existing.roles;
  return surfacesForPolarity(isDarkPolarity(preset) ? 'dark' : 'light', existing.roles);
}
