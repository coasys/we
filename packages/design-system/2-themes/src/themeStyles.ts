import { contrastRatio, parseColor, type Rgba } from '@we/design-utils';
import type { ColorHueToken, ColorLightnessToken } from '@we/tokens';
import { color, role } from '@we/tokens';

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
  'themeName' | 'shadowIntensity' | 'animationSpeed' | 'surfaceBlur' | 'fontScale' | 'roles' | 'schemaVersion'
>;

/** camelCase role name → --we-role-<kebab-case> custom property. */
export function roleVar(role: ThemeRole): string {
  return `--we-role-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
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
  Object.entries(role).map(([name, value]) => [roleVar(name as ThemeRole), value]),
);

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
  multiplier: '--we-color-multiplier',
  subtractor: '--we-color-subtractor',
  ringColor: '--we-ring-color',
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
  controlHeight: '--we-theme-control-height-offset',
  surfaceSpacing: '--we-theme-surface-spacing',
  surfaceGap: '--we-theme-surface-gap',
  inputSpacing: '--we-theme-input-spacing',
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
    a dark panel. Darkness here is not a separate flag to keep in sync — a negative multiplier *is*
    the inversion of the lightness scale, so it is read from that. A theme that does not touch the
    multiplier inherits the ambient scheme, which is also right: it did not change the polarity.
  */
  if (theme.multiplier !== undefined) {
    style['color-scheme'] = Number(theme.multiplier) < 0 ? 'dark' : 'light';
  }

  // 2. Re-declare neutral-hue linkage when primaryHue is explicitly overridden
  if (theme.primaryHue !== undefined && theme.neutralHue === undefined) {
    style['--we-color-neutral-hue'] = 'var(--we-color-primary-hue)';
  }

  // 3. Re-declare lightness scale
  // Named themes may change multiplier/subtractor via CSS, so always re-declare.
  const affectsLightness = hasNamedTheme || theme.multiplier !== undefined || theme.subtractor !== undefined;
  if (affectsLightness) {
    for (const step of LIGHTNESS_STEPS) {
      const base = parseFloat(color.lightness[step]);
      style[`--we-color-lightness-${step}`] =
        `calc((${base}% - var(--we-color-subtractor)) * var(--we-color-multiplier))`;
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
      style[`--we-color-${family}-${step}`] =
        `hsl(var(--we-color-${family}-hue) var(${satVar}) var(--we-color-lightness-${step}))`;
    }
  }

  // 5. Re-declare gradient when primary hue or saturation may have changed
  const affectsPrimaryGradient =
    hasNamedTheme || theme.primaryHue !== undefined || theme.saturation !== undefined || affectsLightness;
  if (affectsPrimaryGradient) {
    style['--we-gradient-primary'] =
      'linear-gradient(135deg, hsl(calc(var(--we-color-primary-hue) - 30) var(--we-color-saturation) var(--we-color-lightness-500)) 0%, hsl(calc(var(--we-color-primary-hue) + 30) var(--we-color-saturation) var(--we-color-lightness-500)) 100%)';
  }

  // 6. Re-declare semantic tokens that alias --we-color-primary-500.
  // These are defined at :root as var() references, but an inline style baked by
  // populateMissingOverrides() or a named theme's CSS rule can pin them to a stale
  // resolved value. Re-declaring them here as formulas ensures they stay in sync
  // with any primary colour change on this element.
  if (affectsPrimaryGradient) {
    if (theme.ringColor === undefined) style['--we-ring-color'] = 'var(--we-color-primary-500)';
    style['--we-color-focus'] = 'var(--we-color-primary-500)';
    style['--we-focus-outline'] = '0 0 0 2px var(--we-color-focus)';
  }

  // fontScale: sets font-size on the root element, scaling all rem-based tokens
  if (theme.fontScale !== undefined) {
    style['font-size'] = `${theme.fontScale * 16}px`;
  }

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
  const derived = applyAutoContrast(root, theme);
  appliedThemeVars.set(root, new Set([...Object.keys(styles), ...derived]));
}

/**
 * Foregrounds whose colour is a *consequence* of the fill they sit on, not a separate decision.
 *
 * Each entry is a foreground role, the fills it has to stay readable against, and the two candidates
 * to choose between. The worst of the fills wins the vote: a primary button's label has to work at
 * rest, on hover and while pressed, and a label chosen against the rest state alone goes unreadable
 * halfway through a click.
 */
const AUTO_CONTRAST: { fg: ThemeRole; against: ThemeRole[] }[] = [
  { fg: 'onAccent', against: ['accent', 'accentHover', 'accentActive'] },
  { fg: 'onInverse', against: ['surfaceInverse'] },
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
    const score = Math.min(...fills.map((fill) => contrastRatio(colour, fill)));
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
function applyAutoContrast(root: HTMLElement, theme: ThemeOverrides): string[] {
  // Needs a real element in a real document: the whole point is to measure what a `var()` chain
  // resolves to, and only the browser knows. Anywhere else — a test stub, a server render — the
  // roles keep their declared defaults, which is the correct answer when nothing can be measured.
  if (typeof getComputedStyle !== 'function' || root?.nodeType !== 1 || !root.isConnected) return [];
  const computed = getComputedStyle(root);
  const written: string[] = [];

  for (const { fg, against } of AUTO_CONTRAST) {
    if (theme.roles?.[fg] !== undefined) continue;

    const fills = against
      .map((role) => parseColor(computed.getPropertyValue(roleVar(role)).trim()))
      .filter((c): c is Rgba => c !== null);
    if (!fills.length) continue;

    // Hue and saturation follow the theme's neutral so the label still belongs to it; only the
    // lightness is being decided.
    const hue = computed.getPropertyValue('--we-color-neutral-hue').trim() || '220';
    const saturation = computed.getPropertyValue('--we-color-neutral-saturation').trim() || '10%';
    const candidates = [`hsl(${hue} ${saturation} 98%)`, `hsl(${hue} ${saturation} 10%)`];

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
const neutralAt = (lightness: number) =>
  `hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) ${lightness}%)`;

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

export const isDarkPolarity = (overrides: Pick<ThemeOverrides, 'multiplier'>) => (overrides.multiplier ?? 1) === -1;

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
  preset: Pick<ThemeOverrides, 'multiplier'>,
): Partial<Record<ThemeRole, string>> | undefined {
  if (isDarkPolarity(existing) === isDarkPolarity(preset)) return existing.roles;
  return surfacesForPolarity(isDarkPolarity(preset) ? 'dark' : 'light', existing.roles);
}
