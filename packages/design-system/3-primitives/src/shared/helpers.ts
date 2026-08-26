import type { DesignSystemProps, ElementState } from '@we/design-types';
import type { DSLayer, PropSpec } from '@we/design-utils';
import {
  BASE_FLEX_SPECS as BASE_FLEX,
  BASE_LAYOUT_SPECS as BASE_LAYOUT,
  BASE_TYPOGRAPHY_SPECS as BASE_TYPOGRAPHY,
  BASE_VISUAL_SPECS as BASE_VISUAL,
  bgImageLayer,
  computeBgImageComposite,
  focusSelector,
  getMarginValues,
  getPaddingValues,
  getRadiusValues,
  HOST_LAYOUT_SPECS as HOST_LAYOUT,
  isBgImageFaded,
  joinDeclsCSS as joinDecls,
  joinStateDeclsCSS as joinStateDecls,
  mapFlexAxes,
  marginKeys,
  paddingKeys,
  parseBorder,
  parseTransition,
  radiusKeys,
  resolveFontFamily,
  resolveFontWeight,
  resolveLineHeight,
  TIER_PROP_KEYS,
  tierRulesCSS,
  tokenVar,
  warnIfUnsurfaced,
  zIndexVar,
} from '@we/design-utils';
import type { Tier } from '@we/tokens';

/**
 * Design System CSS Helpers
 *
 * Two responsibilities:
 * 1. Generate static CSS stylesheets (once per component class) that read CSS custom properties
 * 2. Update CSS custom properties on the host element at runtime based on DS props
 */

const ELEMENT_STATES: ElementState[] = ['hover', 'focus', 'active', 'disabled'];

// ────────────────────────────────────────────
// Component cascade configuration
// ────────────────────────────────────────────

/**
 * Per-component cascade config. When set, the static CSS emits a fallback
 * chain for radius and padding rather than a bare var():
 *
 *   border-radius: var(--we-button-radius,          ← explicit r= prop
 *     var(--we-theme-button-radius,                 ← component-specific theme override
 *       var(--we-theme-control-radius,              ← group theme override
 *         var(--we-button-size-radius,              ← size-aware structural default (CSS host rule)
 *           var(--we-radius-400)))));               ← absolute token fallback
 *
 * radiusDefault and paddingDefault are optional. When absent, getStaticDSStyles()
 * auto-derives them from the component's DEFAULT_PROPS (via getPaddingValues /
 * getRadiusValues). Only set them explicitly when the value cannot be derived —
 * e.g. button's size-aware radius chain, or wrapper components that have no r/px
 * in DEFAULT_PROPS but still need a non-zero cascade fallback.
 */
export interface ComponentCascade {
  radiusGroup?: string; // e.g. '--we-theme-control-radius'
  radiusDefault?: string; // explicit override; omit to auto-derive from DEFAULT_PROPS
  /**
   * A second theme variable the group value may not exceed — for a control that can grow taller
   * than one line.
   *
   * `pill` is not a size, it is a shape: a capsule, and a capsule is only coherent on a box about as
   * tall as its text. A theme setting `inputRadius: pill` means every input is a capsule and is
   * right about `we-input`, which is one line by construction. `we-textarea` is three rows and
   * `we-file-upload` is a drop zone, and both came out as lozenges with their own content running
   * off the curved ends.
   *
   * Capping against `--we-theme-surface-radius` rather than a number keeps the theme in charge: it
   * is the value that theme already chose for a box that is not a capsule, so a sharp theme still
   * gets square corners and a rounded one still gets its own curve. Only the group value is capped —
   * a per-component `--we-theme-textarea-radius` is an explicit answer to exactly this question and
   * wins outright.
   */
  radiusCapGroup?: string;
  paddingGroup?: string; // e.g. '--we-theme-control-padding-x'
  paddingDefault?: string; // explicit override; omit to auto-derive from DEFAULT_PROPS
  nativePadding?: boolean; // if true, padding is omitted from [part='base'] — the component owns it in CSS_STYLES
  gapGroup?: string; // e.g. '--we-theme-control-gap'
  gapDefault?: string; // explicit override; omit to auto-derive from DEFAULT_PROPS
}

/**
 * Which theme group each component takes its shape and density from.
 *
 * Open to registration rather than a closed literal, which matters more here than it would in most
 * design systems. WE's premise is that modules are the developer layer beneath templates — "lower
 * volume, but they raise the ceiling on what every template above can express" — and until now they
 * could raise it for layout and behaviour and not for theming. A module could *read*
 * `--we-theme-control-radius`, and had no way to say "my surface is its own kind of thing, and here
 * is the group it should follow". Its options were to borrow a core group whose meaning did not
 * quite fit, or to hardcode.
 *
 * See `registerComponentCascade` for the contract, including when it has to be called.
 */
const COMPONENT_CASCADE: Record<string, ComponentCascade> = {
  // Media
  //
  // Avatars take their own group rather than the media/surface one: they are the only components
  // guaranteed square (width and height both come from --we-avatar-size), which is what makes a
  // percentage radius safe here and unsafe on a video. See ThemeOverrides.avatarRadius.
  avatar: { radiusGroup: '--we-theme-avatar-radius', radiusDefault: '50%' },
  // Rectangular embedded content joins the *surface* group rather than taking one of its own.
  // A theme that rounds its panels to 16px wants its photos at 16px — they are one visual
  // language — and a fifth group would be a row in every theme editor for a distinction
  // ("sharp panels, soft photos") nobody has asked for. Explicit '0' defaults because these
  // three declare no radius in DEFAULT_PROPS, so there is nothing to auto-derive from and the
  // cascade would otherwise reset border-radius to its initial value.
  image: { radiusGroup: '--we-theme-surface-radius', radiusDefault: '0' },
  video: { radiusGroup: '--we-theme-surface-radius', radiusDefault: '0' },
  iframe: { radiusGroup: '--we-theme-surface-radius', radiusDefault: '0' },
  // Controls
  button: {
    radiusGroup: '--we-theme-control-radius',
    // Explicit: size-aware CSS var chain — not derivable from DEFAULT_PROPS alone.
    radiusDefault: 'var(--we-button-size-radius, var(--we-radius-400))',
    // Padding is owned by CSS_STYLES (x-only, 0 y) — nativePadding suppresses the generic declaration.
    nativePadding: true,
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-button-size-gap, var(--we-space-300))',
  },
  badge: {
    radiusGroup: '--we-theme-control-radius',
    nativePadding: true,
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-badge-size-gap, 0)',
  },
  tag: { radiusGroup: '--we-theme-control-radius', nativePadding: true },
  checkbox: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-200)' },
  radio: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-200)' },
  switch: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-200)' },
  slider: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-300)' },
  'menu-item': {
    paddingGroup: '--we-theme-control-padding-x',
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-space-300)',
  },
  'progress-bar': { radiusGroup: '--we-theme-control-radius' },
  // Inputs
  input: { radiusGroup: '--we-theme-input-radius', paddingGroup: '--we-theme-input-padding' },
  textarea: {
    radiusGroup: '--we-theme-input-radius',
    radiusCapGroup: '--we-theme-surface-radius',
    nativePadding: true,
  },
  select: {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    paddingGroup: '--we-theme-input-padding',
    paddingDefault: '0', // Explicit: wrapper div — inner parts own their own padding
  },
  'number-input': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: intentionally matches input theme, not DEFAULT_PROPS r:'400'
    paddingGroup: '--we-theme-input-padding',
    paddingDefault: '0 var(--we-space-300)', // Explicit: no px in DEFAULT_PROPS
  },
  'date-picker': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    paddingGroup: '--we-theme-input-padding',
    paddingDefault: '0', // Explicit: wrapper div — inner parts own their own padding
  },
  'color-picker': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    paddingGroup: '--we-theme-input-padding',
    paddingDefault: '0', // Explicit: wrapper div — inner parts own their own padding
  },
  'icon-picker': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
  },
  'file-upload': {
    radiusGroup: '--we-theme-input-radius',
    // A drop zone, so it is as tall as a textarea and capped for the same reason.
    radiusCapGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-padding',
  },
  'form-field': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-space-100)',
  },
  // Tabs
  // Padding is owned by CSS_STYLES (own vertical, control-group horizontal) — see the note there.
  tab: { radiusGroup: '--we-theme-control-radius', nativePadding: true },
  // Surfaces
  modal: {
    radiusGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-padding',
    gapGroup: '--we-theme-surface-gap',
  },
  drawer: {
    radiusGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-padding',
    gapGroup: '--we-theme-surface-gap',
  },
  menu: { radiusGroup: '--we-theme-surface-radius', nativePadding: true },
  alert: {
    radiusGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-padding',
    gapGroup: '--we-theme-surface-gap',
  },
  blockquote: { radiusGroup: '--we-theme-surface-radius', paddingGroup: '--we-theme-surface-padding' },
  code: { radiusGroup: '--we-theme-surface-radius' },
};

/**
 * Register a component's theme cascade — for components that do not ship with the design system.
 *
 * A feature module owns components the core has never heard of, and those components have shape and
 * density decisions like any other. Registering says which theme group they follow, so a theme
 * setting "surfaces are square" reaches them too rather than stopping at the boundary of what
 * shipped in the box.
 *
 * **Call it before the component first renders** — module setup, or the module file's top level.
 * The cascade is read while building a component's styles, so a registration that lands afterwards
 * has no effect on anything already on screen and no way to say so.
 *
 * Re-registering the same name replaces the entry. That is deliberate: a module reloading during
 * development should not accumulate, and there is no meaningful merge between two answers to "which
 * group does this follow".
 */
export function registerComponentCascade(componentName: string, cascade: ComponentCascade): void {
  COMPONENT_CASCADE[componentName] = cascade;
}

/** What a component name currently resolves to, or undefined. Exposed for tests and diagnostics. */
export function componentCascadeFor(componentName: string): ComponentCascade | undefined {
  return COMPONENT_CASCADE[componentName];
}

/**
 * What a state change is allowed to animate.
 *
 * This was `all`, which is the default nearly every design system reaches for and is wrong here for a
 * specific, observable reason: the properties a hover block may set include layout and typography, so
 * `all` animates **geometry**. Instrumenting the hover flicker caught `border-top-width`,
 * `border-right-width`, `border-bottom-width`, `border-left-width` and `outline-width` transitioning
 * on ordinary hovers — an element whose box is mid-animation moves under the cursor, which can drop
 * and re-apply `:hover`, and repaints its own bounds every frame while it does.
 *
 * `all` also meant any incidental change to a computed value became visible motion rather than an
 * invisible no-op — which is how a stray `background-position` reset (fixed separately) turned into
 * 150ms of flicker instead of nothing at all.
 *
 * The list is every property a state block legitimately wants to animate and nothing that can move a
 * box. `border-color` and `outline-color` cover their four longhands; their *widths* deliberately do
 * not appear. A component that genuinely needs something else can still say so: the `transition` prop
 * overrides this per instance.
 */
const ANIMATABLE_STATE_PROPS = [
  'background-color',
  'border-color',
  'outline-color',
  'box-shadow',
  'opacity',
  'fill',
  'stroke',
];

/**
 * The same list plus `color`, for a theme change rather than a hover.
 *
 * `color` is absent above for a measured reason. Two otherwise identical columns of buttons — same
 * shape, same 50ms arrival, same instant departure, differing only in whether the hover changed the
 * text colour as well as the background — flickered at roughly a hundred to one. A column with no
 * text at all was as clean as the background-only one. Animating text means re-rasterising every
 * glyph on every frame of the fade, and glyph rendering is both far more perceptible than the fill
 * behind it and invisible to everything that had been measuring the fade: computed style is correct
 * throughout, the interpolation sits exactly on its line, the geometry never moves.
 *
 * Snapping it costs nothing anyone can see. The background carries the state change and arrives
 * inside 50ms; the text simply agrees with it immediately instead of catching up.
 *
 * A theme change is the opposite case and gets the longer list. There the text colour *is* the thing
 * changing — a switch that faded every background while the text jumped would read as broken — and it
 * happens once, deliberately, rather than repeatedly under a moving pointer.
 */
const THEME_FADE_PROPS = [...ANIMATABLE_STATE_PROPS, 'color'];

/*
  A state may take time to arrive. It must not take time to leave.

  ## What the flicker actually was

  Hovering across a list of buttons produced an occasional glitch that survived four rounds of
  instrumentation — zero dropped frames, zero long tasks, every individual transition textbook. It was
  finally isolated by building nine variants of the same list, each differing in one property, and
  the result had no exceptions: **every variant with a hover-*out* fade flickered, and every variant
  without one was clean.** `transition: none` was clean; fade-in-with-instant-out was clean; and
  instant-in-with-fade-out — which changes nothing about how the highlight appears — flickered as
  badly as the original. A single button on its own could not be made to flicker at all.

  So the mechanism is the trail. A pointer crosses one of these buttons in 40–70ms, measured; with a
  fade on the way out, each button keeps painting a decaying highlight after the pointer has gone, and
  one or two ghosts sit lit behind the cursor at any moment, appearing and vanishing in sequence. No
  single transition is wrong, which is exactly why nothing that examined transitions one at a time
  ever found anything.

  Stated as a rule: a hover indicator exists to say *the pointer is here*. Any persistence after the
  pointer leaves is the indicator asserting something false about somewhere it isn't. Arrival can be
  animated, because the statement is becoming true. Departure cannot, because it has already stopped
  being true.

  ## Why there are two declarations

  These properties are also what cross-fades when the theme changes, and that transition is wanted —
  it is the only thing making a light/dark switch feel like one event rather than a repaint. But it is
  a different job from state feedback, on a different timescale, and CSS gives us exactly one
  `transition` per rule to express both.

  The split falls out of where each rule applies. `STATE_TRANSITION` goes on the `:hover`/`:focus`/
  `:active` rules, which govern the animation *into* those states — the arrival. `REST_TRANSITION`
  goes on the base rule, which governs the animation back *out* of them — the departure — and so
  resolves to `0s` and snaps. A theme switch mutates custom properties while the base rule is the one
  matching, so it reads the same declaration; `--we-theme-switch-duration` is raised for the duration
  of the switch (see `applyThemeVars`) and lowered again, which buys the cross-fade back without ever
  putting a duration on a hover exit. Custom properties inherit through shadow boundaries, so one
  value on the root reaches every primitive.

  ## Why the arrival is 50ms

  Not because of interruption, which is the intuitive answer and is wrong. Back when both directions
  still faded, 150ms flickered *less* than 50ms — the opposite of what a theory about interrupted
  transitions predicts, and reason enough to discard it. Once departures snap the constraint reverses,
  and the measurement is unambiguous:

      over   -624
             -603   18% faded
             -588   34% faded
      out    -577
             -571    0%          ← snapped off at a third

  A pointer crosses one of these buttons in 40-70ms. With a 150ms arrival that buys about a third of
  the fade, so a quick pass lights the button dimly and then removes it — a partial state that
  appears and aborts, which reads as a glitch precisely because it never resolved into anything. With
  a 50ms arrival and `ease-out` the same pass is essentially complete, so it reads as a highlight
  that came and went.

  So the rule has a second half. A state may take time to arrive — but not more time than the gesture
  that triggers it, or the arrival never finishes and the user is shown a fraction of an answer. That
  makes the ceiling here a measured property of pointing at a small target, not a matter of taste.

  `ease-out` matters for the same reason at the margin: it front-loads the change, so the shortest
  hovers still land most of it.

  ## Why the text does not animate at all

  Even with both of the above right, the flicker persisted — and every number said it should not.
  Every transition was textbook, no two buttons were ever lit at once, the interpolation sat exactly
  on its line, the geometry never moved, and a full computed-style diff showed hovering changed
  `background-color`, `color`, and eighteen aliases of `color`, and nothing else.

  What settled it was noticing that every control which had tested clean changed the background
  *alone*. Adding a text-colour change to the clean shape, with nothing else different, brought the
  flicker back at roughly a hundred times the rate; removing the text entirely left it clean. So
  `color` leaves the state list — see the note on `THEME_FADE_PROPS` — and keeps its place in the
  theme fade, where it is the point rather than a side effect.

  What remains after that is a residual on the order of one percent, present on a plain `<button>`
  with hand-written CSS and no framework of any kind. That one is the browser's, and the honest thing
  is to say so rather than keep changing the design system in front of it.
*/
const STATE_TRANSITION = ANIMATABLE_STATE_PROPS.map(
  (prop) => `${prop} var(--we-theme-state-duration, var(--we-transition-100, 50ms)) ease-out`,
).join(', ');

/**
 * The resting declaration: instant, except while a theme is being applied.
 *
 * Governs leaving a state, so `0s` is the whole point — see the note above. The variable is the seam
 * that lets a theme change animate the same properties without a hover exit ever inheriting a
 * duration from it.
 */
const REST_TRANSITION = THEME_FADE_PROPS.map((prop) => `${prop} var(--we-theme-switch-duration, 0s) ease`).join(', ');

// ────────────────────────────────────────────
// Runtime: CSS custom property updates
// ────────────────────────────────────────────

/**
 * Custom properties this element has actually written, so clearing one that was never set can skip
 * the CSSOM call entirely.
 *
 * WeakMap-keyed, so entries are collected with the element and nothing leaks.
 */
const writtenVars = new WeakMap<HTMLElement, Set<string>>();

/** Inline declarations written from the `styles` prop, tracked so a removed one is actually removed. */
const writtenStyles = new WeakMap<HTMLElement, Set<string>>();

/**
 * Apply the `styles` escape hatch to the host element.
 *
 * `styles` is a documented design-system prop — "inline CSS applied directly to the component's own
 * element" — and every layout component honours it. Primitives accepted it, typed it, and dropped it
 * on the floor: the key is in `designSystemKeys`, so it survived prop filtering and then nothing ever
 * read it. Passing one to a primitive did nothing at all, with no error and no warning, which is how
 * a `--we-resize-handle-line: transparent` meant to suppress a divider ended up drawing one.
 *
 * Written last, after the custom properties above, so it overrides a DS prop setting the same thing —
 * which is what "applied last" in the prop table promises.
 */
function applyInlineStyles(el: HTMLElement, styles?: Record<string, string | number>): void {
  const previous = writtenStyles.get(el);
  const next = new Set<string>();

  for (const [property, value] of Object.entries(styles ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    el.style.setProperty(property, String(value));
    next.add(property);
  }

  // Anything this element used to set and no longer does. Without this, removing a key from `styles`
  // would leave its declaration behind for the life of the element.
  if (previous) for (const property of previous) if (!next.has(property)) el.style.removeProperty(property);
  writtenStyles.set(el, next);
}

/**
 * Set or clear a single `--we-*` custom property.
 *
 * The early return on the clear path is the point. `updateCustomVars` walks a fixed list of ~59
 * properties on every update and calls this for each, whether or not the corresponding prop is set
 * — so a bare `we-text` with no design-system props still issued ~59 `removeProperty` calls, almost
 * all of them clearing properties that had never been written.
 *
 * Measured by ablation on a 3006-element tree: `updateAllCustomVars` accounted for 83% of the flush
 * phase (~564ms of ~681ms). Removing a property that was never set cannot change rendered output —
 * it is a no-op by definition — so skipping it is behaviour-preserving.
 *
 * Safe because every one of the 66 call sites passes a prefixed custom-property name and nothing
 * outside this module writes `--we-*` inline. If that ever changes, a property written elsewhere
 * would not be in this set and would no longer be cleared here.
 */
function setProperty(el: HTMLElement, name: string, value?: string) {
  if (value !== undefined && value !== null && value !== '') {
    el.style.setProperty(name, value);
    let written = writtenVars.get(el);
    if (!written) {
      written = new Set<string>();
      writtenVars.set(el, written);
    }
    written.add(name);
    return;
  }

  const written = writtenVars.get(el);
  if (written === undefined || !written.has(name)) return;
  el.style.removeProperty(name);
  written.delete(name);
}

/**
 * Sync border CSS custom properties. When the `border` shorthand is set, its
 * components (width, color, per-side values) are extracted and written as
 * sub-property vars so that static CSS declarations like
 * `border-color: var(--we-button-border-color)` resolve to the shorthand's
 * own values instead of becoming guaranteed-invalid. Explicit sub-property
 * overrides (e.g. borderColor) take priority over extracted values.
 */
function syncBorderVars(el: HTMLElement, prefix: string, props: Partial<DesignSystemProps>) {
  setProperty(el, `${prefix}border`, props.border ? parseBorder(props.border) : undefined);

  if (props.border) {
    const parsed = parseBorder(props.border);
    const parts = parsed.split(' ');
    if (parts.length >= 3) {
      const [width, , ...colorParts] = parts;
      const color = colorParts.join(' ');
      if (!props.borderColor) setProperty(el, `${prefix}border-color`, color);
      if (!props.borderWidth) setProperty(el, `${prefix}border-width`, width);
    }
    if (!props.borderTop) setProperty(el, `${prefix}border-top`, parsed);
    if (!props.borderRight) setProperty(el, `${prefix}border-right`, parsed);
    if (!props.borderBottom) setProperty(el, `${prefix}border-bottom`, parsed);
    if (!props.borderLeft) setProperty(el, `${prefix}border-left`, parsed);
  } else {
    setProperty(el, `${prefix}border-color`, props.borderColor ? tokenVar('color', props.borderColor, '') : undefined);
    setProperty(el, `${prefix}border-top`, props.borderTop ? parseBorder(props.borderTop) : undefined);
    setProperty(el, `${prefix}border-right`, props.borderRight ? parseBorder(props.borderRight) : undefined);
    setProperty(el, `${prefix}border-bottom`, props.borderBottom ? parseBorder(props.borderBottom) : undefined);
    setProperty(el, `${prefix}border-left`, props.borderLeft ? parseBorder(props.borderLeft) : undefined);
    setProperty(el, `${prefix}border-width`, props.borderWidth);
  }
  if (props.border && props.borderColor)
    setProperty(el, `${prefix}border-color`, tokenVar('color', props.borderColor, ''));
  if (props.border && props.borderWidth) setProperty(el, `${prefix}border-width`, props.borderWidth);
}

function updateCustomVars(
  el: HTMLElement,
  componentName: string,
  props: Partial<DesignSystemProps>,
  rawExplicitProps?: Partial<DesignSystemProps>,
  // A state name or a breakpoint tier — both are just a prefix, and the CSS that reads them is
  // generated from the same spec tables either way.
  variant?: ElementState | Exclude<Tier, 'base'>,
) {
  const prefix = variant ? `--we-${componentName}-${variant}-` : `--we-${componentName}-`;

  // Layout: host positioning
  const hasMargin = marginKeys.some((k) => props[k] !== undefined && props[k] !== null);
  setProperty(el, `${prefix}width`, props.width);
  setProperty(el, `${prefix}height`, props.height);
  setProperty(el, `${prefix}min-width`, props.minWidth);
  setProperty(el, `${prefix}min-height`, props.minHeight);
  setProperty(el, `${prefix}max-width`, props.maxWidth);
  setProperty(el, `${prefix}max-height`, props.maxHeight);
  setProperty(el, `${prefix}position`, props.position);
  setProperty(el, `${prefix}top`, props.top);
  setProperty(el, `${prefix}right`, props.right);
  setProperty(el, `${prefix}bottom`, props.bottom);
  setProperty(el, `${prefix}left`, props.left);
  setProperty(el, `${prefix}z-index`, zIndexVar(props.zIndex));
  setProperty(el, `${prefix}margin`, hasMargin ? getMarginValues(props) : undefined);
  setProperty(el, `${prefix}flex`, props.flex);
  setProperty(el, `${prefix}align-self`, props.alignSelf);

  // Visual
  setProperty(el, `${prefix}bg`, props.bg ? tokenVar('color', props.bg, '') : undefined);
  setProperty(el, `${prefix}color`, props.color ? tokenVar('color', props.color, '') : undefined);
  setProperty(el, `${prefix}opacity`, props.opacity?.toString());
  syncBorderVars(el, prefix, props);

  // bg-image — faded images render via a ::before overlay (see getStaticDSStyles),
  // since bgImageOpacity needs the image on its own paint layer, independent of the
  // element's own content — CSS can't scope opacity to one background layer. The
  // unfaded (common) case bypasses that entirely and sets a plain background-image
  // directly on [part='base'] instead — no pseudo-element, no custom-property
  // indirection, same as before bgImageOpacity existed. Both paths resolve the URL
  // through bgImageLayer, which routes a URL via resolveBgImageUrl (data URI -> short-lived
  // object URL) and passes a gradient through verbatim: a large base64
  // payload embedded as a CSS custom property value hits a real, empirically-confirmed
  // length ceiling in Chromium (silently dropped, no error) — bgImageLayer keeps
  // the actual CSS value fixed-length regardless of the source image's size.
  // Not variant-varied (no {variant}-bg-image-* writes) — swapping the image itself on
  // hover/active/focus, or at a breakpoint, is out of scope, unlike the rest of this fn.
  if (!variant) {
    const isFaded = isBgImageFaded(props);
    setProperty(el, `${prefix}bg-image-composite`, isFaded ? computeBgImageComposite(props) : undefined);
    setProperty(el, `${prefix}bg-image`, props.bgImage && !isFaded ? bgImageLayer(props.bgImage) : undefined);
    setProperty(el, `${prefix}bg-image-fit`, props.bgImage ? (props.bgFit ?? 'cover') : undefined);
    setProperty(el, `${prefix}bg-image-position`, props.bgImage ? (props.bgPosition ?? 'center') : undefined);
  }

  setProperty(el, `${prefix}shadow`, props.shadow ? tokenVar('shadow', props.shadow) : undefined);
  setProperty(el, `${prefix}ring`, props.ring ?? undefined);
  // Compose box-shadow from shadow + ring (both are optional, comma-separated when both present)
  const shadowVal = props.shadow ? tokenVar('shadow', props.shadow) : undefined;
  const ringVal = props.ring ?? undefined;
  if (shadowVal || ringVal) {
    const parts = [ringVal, shadowVal].filter(Boolean).join(', ');
    setProperty(el, `${prefix}box-shadow`, parts);
  } else {
    setProperty(el, `${prefix}box-shadow`, undefined);
  }
  setProperty(el, `${prefix}transform`, props.transform);
  setProperty(el, `${prefix}transition`, parseTransition(props.transition));
  setProperty(el, `${prefix}cursor`, props.cursor);
  setProperty(el, `${prefix}pointer-events`, props.pointerEvents);
  setProperty(el, `${prefix}visibility`, props.visibility);
  const hasRadius = radiusKeys.some((k) => props[k] !== undefined && props[k] !== null);
  // Only set the instance radius var when the prop was explicitly passed (not from DEFAULT_PROPS).
  // If not explicitly set, the static CSS fallback chain handles it via --we-theme-*-radius.
  const radiusExplicit = !rawExplicitProps || radiusKeys.some((k) => rawExplicitProps[k] !== undefined);
  setProperty(el, `${prefix}radius`, hasRadius && radiusExplicit ? getRadiusValues(props) : undefined);

  // Layout on base
  setProperty(el, `${prefix}display`, props.display);
  setProperty(el, `${prefix}overflow`, props.overflow);
  setProperty(el, `${prefix}overflow-x`, props.overflowX);
  setProperty(el, `${prefix}overflow-y`, props.overflowY);
  setProperty(el, `${prefix}scrollbar-width`, props.scrollbarWidth);
  setProperty(el, `${prefix}scrollbar-gutter`, props.scrollbarGutter);

  // Flex
  const { main, cross } = mapFlexAxes(props, props.direction ?? 'row');
  setProperty(el, `${prefix}direction`, props.direction);
  setProperty(el, `${prefix}main-axis`, main);
  setProperty(el, `${prefix}cross-axis`, cross);
  setProperty(el, `${prefix}wrap`, 'wrap' in props ? (props.wrap ? 'wrap' : 'nowrap') : undefined);
  // Only set the instance gap var when explicitly passed — not from SIZE_DEFAULTS or DEFAULT_PROPS.
  // When not explicit, the static CSS fallback chain handles it via --we-theme-control-gap.
  const gapExplicit = !rawExplicitProps || rawExplicitProps['gap'] !== undefined;
  setProperty(el, `${prefix}gap`, props.gap && gapExplicit ? tokenVar('space', props.gap) : undefined);
  const hasPadding = paddingKeys.some((k) => props[k] !== undefined && props[k] !== null);
  // Same guard as radius — only set the instance padding var when explicitly passed.
  const paddingExplicit = !rawExplicitProps || paddingKeys.some((k) => rawExplicitProps[k] !== undefined);
  setProperty(el, `${prefix}padding`, hasPadding && paddingExplicit ? getPaddingValues(props) : undefined);

  // Typography
  setProperty(el, `${prefix}text-align`, props.textAlign);
  setProperty(el, `${prefix}font-family`, resolveFontFamily(props.fontFamily));
  setProperty(el, `${prefix}font-weight`, resolveFontWeight(props.fontWeight));
  setProperty(el, `${prefix}font-size`, props.fontSize ? tokenVar('font-size', props.fontSize) : undefined);
  setProperty(el, `${prefix}line-height`, resolveLineHeight(props.lineHeight));
  setProperty(
    el,
    `${prefix}letter-spacing`,
    props.letterSpacing ? tokenVar('letter-spacing', props.letterSpacing) : undefined,
  );
  setProperty(el, `${prefix}text-decoration`, props.textDecoration);
  setProperty(el, `${prefix}text-transform`, props.textTransform);
}

export function updateAllCustomVars(
  el: HTMLElement,
  componentName: string,
  props: Partial<DesignSystemProps>,
  rawExplicitProps?: Partial<DesignSystemProps>,
) {
  updateCustomVars(el, componentName, props, rawExplicitProps);
  applyInlineStyles(el, props.styles);
  ELEMENT_STATES.forEach((state) => {
    const stateProps = props[`${state}Props`];
    // State props are always treated as explicit — no DEFAULT_PROPS fill state blocks.
    if (stateProps && typeof stateProps === 'object') updateCustomVars(el, componentName, stateProps, undefined, state);
  });
  /*
    Breakpoint tiers, by the same route as the states.

    Explicit like a state bag and for the same reason: a tier says what changes at that width, so
    filling it from DEFAULT_PROPS would pin every unmentioned prop at that width and stop it
    cascading through from the tier below.
  */
  let hasTier = false;
  for (const [tier, key] of Object.entries(TIER_PROP_KEYS)) {
    const tierProps = (props as Record<string, unknown>)[key];
    if (tierProps && typeof tierProps === 'object') {
      hasTier = true;
      updateCustomVars(el, componentName, tierProps as Partial<DesignSystemProps>, undefined, tier as never);
    }
  }
  // The one failure this design cannot make unreachable: a query with no container is silently
  // false, so a breakpoint prop outside every surface renders its base value and looks correct.
  if (hasTier) warnIfUnsurfaced(el, `<${el.tagName.toLowerCase()}>`);
}

// ────────────────────────────────────────────
// Static CSS generation (once per component class)
// ────────────────────────────────────────────
//
// PropSpec tables (HOST_LAYOUT, BASE_VISUAL, BASE_LAYOUT, BASE_FLEX, BASE_TYPOGRAPHY) and
// the decl/stateDecl/joinDecls/joinStateDecls builders live in @we/design-utils — shared
// with the Solid DS-interop stylesheet so hoverProps/activeProps/focusProps support the
// same property surface on both component families. See that file for the fallback
// semantics rationale.

// Build a PropSpec with an optional cascade fallback chain for a single prop.
function cascadeSpec(
  componentName: string,
  cssProp: string,
  varSuffix: string,
  groupVar: string | undefined,
  tokenDefault: string | undefined,
  capGroupVar?: string,
): PropSpec {
  if (!groupVar) {
    // No theme group — emit a direct token fallback so DEFAULT_PROPS values still take
    // effect even though the runtime no longer sets the custom var for non-explicit props.
    return tokenDefault ? [cssProp, varSuffix, tokenDefault] : [cssProp, varSuffix];
  }
  if (!tokenDefault) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[DS] ${componentName}: "${varSuffix}" has a cascade group (${groupVar}) but no fallback value. ` +
          `Add the corresponding prop to ${componentName}'s DEFAULT_PROPS so it can be auto-derived, ` +
          `or set ${varSuffix}Default explicitly in COMPONENT_CASCADE. ` +
          `Without a fallback, ${cssProp} will reset to its initial value when no theme variable is set.`,
      );
    }
    return [cssProp, varSuffix];
  }
  const compThemeVar = `--we-theme-${componentName}-${varSuffix}`;
  // Capped inside the group arm only, so the per-component variable stays the last word.
  const group = capGroupVar
    ? `min(var(${groupVar}, ${tokenDefault}), var(${capGroupVar}, ${tokenDefault}))`
    : `var(${groupVar}, ${tokenDefault})`;
  return [cssProp, varSuffix, `var(${compThemeVar}, ${group})`];
}

/**
 * Generate static CSS string for a DS component. Called once per component class.
 * The CSS reads CSS custom properties that are set at runtime by updateAllCustomVars().
 *
 * @param defaultProps - The component's DEFAULT_PROPS. Used to auto-derive paddingDefault and
 * radiusDefault when they are not explicitly set in COMPONENT_CASCADE.
 */
export function getStaticDSStyles(
  componentName: string,
  layers?: readonly DSLayer[],
  defaultProps?: Partial<DesignSystemProps>,
): string {
  const l = new Set<DSLayer>(layers ?? ['layout', 'visual', 'flex', 'typography', 'state']);
  const p = `--we-${componentName}-`;
  const cascade = COMPONENT_CASCADE[componentName];

  // Auto-derive cascade fallback defaults from DEFAULT_PROPS when not explicitly set.
  // Explicit values in COMPONENT_CASCADE always take precedence.
  const dp = defaultProps as Record<string, unknown> | undefined;
  const radiusDefault =
    cascade?.radiusDefault ??
    (dp && radiusKeys.some((k) => dp[k] !== undefined)
      ? getRadiusValues(defaultProps as DesignSystemProps)
      : undefined);
  const paddingDefault =
    cascade?.paddingDefault ??
    (dp && paddingKeys.some((k) => dp[k] !== undefined)
      ? getPaddingValues(defaultProps as DesignSystemProps)
      : undefined);
  const gapDefault =
    cascade?.gapDefault ?? (dp && dp['gap'] !== undefined ? tokenVar('space', dp['gap'] as string) : undefined);

  // Build per-component visual and flex specs with cascade fallbacks where applicable.
  const baseVisual: PropSpec[] = BASE_VISUAL.map((spec) =>
    spec[1] === 'radius'
      ? cascadeSpec(
          componentName,
          'border-radius',
          'radius',
          cascade?.radiusGroup,
          radiusDefault,
          cascade?.radiusCapGroup,
        )
      : spec,
  );
  const baseFlex: PropSpec[] = BASE_FLEX.flatMap((spec) => {
    if (spec[1] === 'gap') {
      return [cascadeSpec(componentName, 'gap', 'gap', cascade?.gapGroup, gapDefault)];
    }
    if (spec[1] === 'padding') {
      if (cascade?.nativePadding) return []; // padding owned by CSS_STYLES, not [part='base']
      return [cascadeSpec(componentName, 'padding', 'padding', cascade?.paddingGroup, paddingDefault)];
    }
    return [spec];
  });

  const styles: string[] = [];

  // ── Host (:host) ──
  // Transition lives on [part='base'], not :host. The host is the outer positioning shell
  // (width, height, margin) — these properties rarely animate and hosting a transition
  // here would add a redundant animation layer for every nested content primitive.
  const hostLines: string[] = [`display: var(${p}host-display, flex);`];
  if (l.has('layout')) hostLines.push(joinDecls(p, HOST_LAYOUT));
  styles.push(`:host { ${hostLines.join('\n    ')} }`);

  // ── Base ([part="base"]) ──
  const baseLines: string[] = ['width: 100%;', 'height: 100%;'];
  if (l.has('visual')) {
    baseLines.push(`transition: var(${p}transition, ${REST_TRANSITION});`);
    baseLines.push(joinDecls(p, baseVisual));
  }
  if (l.has('layout')) baseLines.push(joinDecls(p, BASE_LAYOUT));
  if (l.has('flex')) baseLines.push(joinDecls(p, baseFlex));
  if (l.has('typography')) baseLines.push(joinDecls(p, BASE_TYPOGRAPHY));

  const hasBase = l.has('visual') || l.has('layout') || l.has('flex') || l.has('typography');
  if (hasBase) {
    styles.push(`[part='base'] { ${baseLines.join('\n    ')} }`);
  }

  // ── bg-image ──
  // Unfaded case: a plain background-image directly on [part='base'] — safe to declare
  // unconditionally since it has an explicit `none` fallback (see the "always-emitted
  // property needs a static fallback" rule this file follows throughout).
  //
  // Faded case (bgImageOpacity set): needs its own paint layer, so it renders via a
  // ::before overlay instead (CSS has no way to scope `opacity` to one background —
  // see computeBgImageComposite). Gated on the `bgimage` reflected attribute (Lit's
  // default attribute-name conversion for `bgImage` — lowercased, no dash) so
  // components that never set bgImage don't pay for an extra paint layer.
  //
  // isolation: isolate is required, not optional: position:relative alone does not
  // establish a new stacking context, so the ::before's z-index:-1 would otherwise
  // escape to compete in whatever ancestor stacking context actually exists instead of
  // staying scoped to "behind this element's own content" — isolation:isolate fixes
  // that with no other visual side effects.
  if (l.has('visual')) {
    styles.push(
      `[part='base'] { background-image: var(${p}bg-image, none); background-size: var(${p}bg-image-fit, cover); ` +
        `background-position: var(${p}bg-image-position, center); background-repeat: no-repeat; }\n` +
        `:host([bgimage]) [part='base'] { position: relative; isolation: isolate; }\n` +
        `:host([bgimage]) [part='base']::before { content: ''; position: absolute; inset: 0; z-index: -1; ` +
        `border-radius: inherit; pointer-events: none; ` +
        `background-image: var(${p}bg-image-composite); background-size: var(${p}bg-image-fit, cover); ` +
        `background-position: var(${p}bg-image-position, center); background-repeat: no-repeat; }`,
    );
  }

  // The two element layers a variant can address, in the layers this component actually has. Shared
  // by the state selectors and the tier queries below, so a `we-icon` gets layout props at a
  // breakpoint and nothing it never accepted in the first place.
  const hostSpecs: PropSpec[] = [];
  if (l.has('layout')) hostSpecs.push(...HOST_LAYOUT);

  const baseSpecs: PropSpec[] = [];
  if (l.has('visual')) baseSpecs.push(...baseVisual);
  if (l.has('layout')) baseSpecs.push(...BASE_LAYOUT);
  if (l.has('flex')) baseSpecs.push(...baseFlex);
  if (l.has('typography')) baseSpecs.push(...BASE_TYPOGRAPHY);

  // ── State selectors ──
  if (l.has('state')) {
    for (const state of ELEMENT_STATES) {
      const sp = `${p}${state}-`;

      // Host state — layout props only, no transition (see :host comment above)
      //
      // Focus stays :focus-within here, unlike the base below, because there is no selector
      // that expresses "a shadow descendant is *keyboard*-focused" from the host. :focus-within
      // is the one thing that crosses the shadow boundary; :focus-visible only ever matches the
      // focused element itself, and :host(:has(…)) matches the host's *light* tree, so it sees
      // slotted content rather than the shadow <button>/<input> that actually took focus. The
      // asymmetry is tolerable because the host layer carries HOST_LAYOUT only (sizing,
      // position, margin) — focus-driven layout changes are vanishingly rare, and every visual
      // state prop lands on [part='base'], which is corrected below.
      if (hostSpecs.length > 0) {
        const lines: string[] = [];
        lines.push(joinStateDecls(sp, p, hostSpecs));
        const sel =
          state === 'disabled' ? ':host([disabled])' : `:host(:${state === 'focus' ? 'focus-within' : state})`;
        styles.push(`${sel} { ${lines.join('\n    ')} }`);
      }

      // Base state
      if (baseSpecs.length > 0) {
        const lines: string[] = [];
        if (l.has('visual')) lines.push(`transition: var(${sp}transition, var(${p}transition, ${STATE_TRANSITION}));`);
        lines.push(joinStateDecls(sp, p, baseSpecs));
        const sel =
          state === 'disabled'
            ? `[part='base']:disabled, [part='base'][aria-disabled='true']`
            : state === 'focus'
              ? focusSelector(`[part='base']`, `:not(:disabled):not([aria-disabled='true'])`)
              : `[part='base']:${state}:not(:disabled):not([aria-disabled='true'])`;
        styles.push(`${sel} { ${lines.join('\n    ')} }`);
      }
    }
  }

  /*
    ── Breakpoint tiers ──

    Not gated on the `state` layer: a `we-icon` accepts layout props and nothing else, and there is
    no reason it should not accept them at a breakpoint too. What a tier may *contain* is already
    bounded by the spec lists above.

    The query resolves against the nearest `$surface` — a light-DOM ancestor, several shadow
    boundaries up. That works: container selection walks the flat tree, so a rule authored inside
    this shadow root matches a container declared outside it. Verified in Chrome and Firefox.

    Emitted after the state selectors, so a tier value wins over a state value on the same property
    at equal specificity — the same ordering the Solid interop stylesheet uses, and for the same
    reason.
  */
  if (hostSpecs.length > 0) styles.push(tierRulesCSS(':host', p, hostSpecs));
  if (baseSpecs.length > 0) styles.push(tierRulesCSS(`[part='base']`, p, baseSpecs));

  return styles.join('\n');
}
