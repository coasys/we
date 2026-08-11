import type { DesignSystemProps, FlexDirection } from '@we/design-types';
import { font } from '@we/tokens';

// --- Shared sub-arrays (used by CSS helpers directly) ---
export const paddingKeys = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl'] as const;
export const marginKeys = ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'] as const;
export const radiusKeys = ['r', 'rr', 'rt', 'rb', 'rl', 'rtl', 'rtr', 'rbr', 'rbl'] as const;
export const borderKeys = [
  'border',
  'borderColor',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderWidth',
] as const;
export const stateKeys = ['hoverProps', 'activeProps', 'focusProps', 'disabledProps'] as const;

// --- DS Layer key arrays ---

/** Layout layer: box model & positioning in parent. Every component gets this. */
export const layoutKeys = [
  'flex',
  'flexShrink',
  'alignSelf',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'display',
  'overflow',
  'overflowX',
  'overflowY',
  'scrollbarWidth',
  'scrollbarGutter',
  ...marginKeys,
] as const;

/** Visual layer: appearance & decoration. Most components. */
export const visualKeys = [
  'bg',
  'bgImage',
  'bgFit',
  'bgPosition',
  'bgImageOpacity',
  'bgImageTint',
  'color',
  'opacity',
  'shadow',
  'ring',
  'cursor',
  'pointerEvents',
  'visibility',
  'transform',
  'transition',
  ...borderKeys,
  ...radiusKeys,
] as const;

/** Flex layer: container layout for arranging children. */
export const flexKeys = ['direction', 'ax', 'ay', 'wrap', 'gap', ...paddingKeys] as const;

/** Typography layer: text styling. */
export const typographyKeys = [
  'textAlign',
  'fontFamily',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textTransform',
  'whiteSpace',
] as const;

// --- Layer composition ---

export type DSLayer = 'layout' | 'visual' | 'flex' | 'typography' | 'state';

/** Map of DS base class names to their layer sets. */
export const BASE_CLASS_LAYERS: Record<string, DSLayer[]> = {
  DesignSystemElement: ['layout', 'visual', 'flex', 'typography', 'state'],
  OverlayElement: ['layout', 'visual', 'flex', 'typography', 'state'],
  LayoutElement: ['layout'],
  LayoutTypographyElement: ['layout', 'typography'],
  LayoutVisualElement: ['layout', 'visual'],
  LayoutVisualTypographyElement: ['layout', 'visual', 'typography'],
};

export const layerKeyMap: Record<DSLayer, readonly string[]> = {
  layout: layoutKeys,
  visual: visualKeys,
  flex: flexKeys,
  typography: typographyKeys,
  state: stateKeys,
};

/** Memoised results of {@link getKeysForLayers}, keyed by sorted layer set. */
const keysForLayersCache = new Map<string, string[]>();

/**
 * Get the combined set of keys for the given layers (deduplicated).
 *
 * Memoised because this sits on a hot path. `DesignSystemMixin` calls it once per class, but ~20
 * primitives (button, text, input, badge, checkbox, …) override `getInstanceProps()` and call it
 * again on every invocation — i.e. once per instance per update. Each uncached call allocated a Set
 * and spread it into a fresh array of up to 82 keys, so a page rendering 3000 DS elements paid that
 * 3000 times for a result that only ever has a handful of distinct values.
 *
 * Safe to cache: `layerKeyMap` is a module constant, so the result is a pure function of the layer
 * set. The returned array is shared rather than copied — callers treat it as read-only
 * (`filterProps` takes `readonly string[]` and only filters/maps), and it must stay that way.
 *
 * The key is sorted so ['layout','visual'] and ['visual','layout'] share an entry; the union itself
 * is order-independent.
 */
export function getKeysForLayers(layers: DSLayer[]): string[] {
  const cacheKey = [...layers].sort().join('|');
  const cached = keysForLayersCache.get(cacheKey);
  if (cached) return cached;

  const keys = new Set<string>();
  for (const layer of layers) {
    for (const key of layerKeyMap[layer]) keys.add(key);
  }
  const result = [...keys];
  keysForLayersCache.set(cacheKey, result);
  return result;
}

// --- Backwards-compatible combined key array ---
export const designSystemKeys = [
  ...layoutKeys,
  ...visualKeys,
  ...flexKeys,
  ...typographyKeys,
  ...stateKeys,
  'styles',
] as const;

const flexMainAxisMap = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  even: 'space-evenly',
} as const;

const flexCrossAxisMap = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;

function isRawCSSValue(value: string): boolean {
  // Check for raw CSS values: var(), px, rem, em, %, vh, vw, rgba, rgb, hsl, negative values,
  // multi-value shorthands (number followed by space, e.g. "0 0 2px 2px ..."),
  // and CSS keywords (transparent, currentColor, inherit, initial, unset, revert, auto, none).
  if (/^(transparent|currentcolor|inherit|initial|unset|revert|auto|none)$/i.test(value)) return true;
  // Math functions are raw CSS too. Without this they fall through to the token branch and come
  // back as `var(--we-space-calc(100% - 8px))` — a variable name built out of an expression,
  // which resolves to nothing. Applies to every token-resolved prop, not just offsets.
  if (/^(calc|min|max|clamp|env)\(/i.test(value)) return true;
  return /^-?(var\(|#|rgba?|hsla?|\d+(\.\d+)?(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|\s))/.test(value);
}

/**
 * Creates a typed token resolver for props whose raw CSS values are syntactically
 * indistinguishable from token keys (e.g. bare numbers, CSS keywords without units).
 *
 * Use this instead of tokenVar() when isRawCSSValue() cannot reliably differentiate
 * between a token key and a raw CSS value for that property.
 *
 * @param tokens - Set of valid token keys for this prop
 * @param cssVarPrefix - The CSS variable prefix, e.g. 'line-height' → var(--we-line-height-*)
 */
function makeTokenResolver(tokens: Set<string>, cssVarPrefix: string) {
  return (value?: string): string | undefined => {
    if (!value) return undefined;
    return tokens.has(value) ? `var(--we-${cssVarPrefix}-${value})` : value;
  };
}

/** Resolves lineHeight: named tokens → CSS var, bare ratios/px/etc. → passthrough. */
export const resolveLineHeight = makeTokenResolver(new Set(Object.keys(font.lineHeight)), 'line-height');

/** Resolves fontWeight: numeric tokens ('100'–'900') → CSS var, CSS keywords → passthrough. */
export const resolveFontWeight = makeTokenResolver(new Set(Object.keys(font.weight)), 'font-weight');

/** Resolves fontFamily: token names → CSS var, raw CSS font stacks → passthrough. */
export const resolveFontFamily = makeTokenResolver(new Set(Object.keys(font.family)), 'font-family');

export function tokenVar(prefix: string, token?: string, fallback = '0') {
  // If no token, return fallback
  if (!token) return fallback;

  // Bare 0 is always a valid unitless CSS value, not a token name
  if (token === '0') return '0';

  // Allow raw CSS values (hex colors, px, rem, %, rgba, etc.)
  if (isRawCSSValue(token)) return token;

  // Otherwise return CSS variable
  return `var(--we-${prefix}-${token})`;
}

/** Resolve a zIndex prop value: layer names → CSS var, numbers → passthrough. */
export function zIndexVar(value?: string | number): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return value.toString();
  if (/^-?\d+$/.test(value)) return value;
  return `var(--we-z-${value})`;
}

/**
 * Parse border shorthand value and convert color tokens to CSS variables
 * Example: "1px solid ui-200" -> "1px solid var(--we-color-neutral-200)"
 */
export function parseBorder(value: string | undefined, defaultValue = ''): string {
  const val = value ?? defaultValue;
  if (!val) return '';

  // If it contains var(, #, or rgb, assume it's already processed
  if (val.includes('var(') || val.includes('#') || val.includes('rgb')) {
    return val;
  }

  // Parse border shorthand: "1px solid ui-200" — all 3 parts required
  const parts = val.split(' ');
  if (parts.length >= 3) {
    const [width, style, ...colorParts] = parts;
    const color = colorParts.join(' ');
    return `${width} ${style} ${tokenVar('color', color, '')}`;
  }

  return val;
}

export function getMarginValues(props: DesignSystemProps) {
  return [
    tokenVar('space', props['mt'] || props['my'] || props['m']),
    tokenVar('space', props['mr'] || props['mx'] || props['m']),
    tokenVar('space', props['mb'] || props['my'] || props['m']),
    tokenVar('space', props['ml'] || props['mx'] || props['m']),
  ].join(' ');
}

export function getPaddingValues(props: DesignSystemProps) {
  return [
    tokenVar('space', props['pt'] || props['py'] || props['p']),
    tokenVar('space', props['pr'] || props['px'] || props['p']),
    tokenVar('space', props['pb'] || props['py'] || props['p']),
    tokenVar('space', props['pl'] || props['px'] || props['p']),
  ].join(' ');
}

export function getRadiusValues(props: DesignSystemProps) {
  return [
    tokenVar('radius', props['rtl'] || props['rt'] || props['rl'] || props['r']),
    tokenVar('radius', props['rtr'] || props['rt'] || props['rr'] || props['r']),
    tokenVar('radius', props['rbr'] || props['rb'] || props['rr'] || props['r']),
    tokenVar('radius', props['rbl'] || props['rb'] || props['rl'] || props['r']),
  ].join(' ');
}

// Filter props based on allowed keys
export function filterProps(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

// Merge props with the correct design system precedence
export function mergeProps(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
): Record<string, unknown> {
  // Spread primary props over secondary props
  const merged = { ...secondary, ...primary };

  // Ensure generic primary props (m, p, rt etc.) override specific secondary props (mx, pt, rtl etc.)
  // Margin precedence
  if (primary.m !== undefined) {
    if (primary.mx === undefined) merged.mx = primary.m;
    if (primary.my === undefined) merged.my = primary.m;
    if (primary.mt === undefined) merged.mt = primary.m;
    if (primary.mr === undefined) merged.mr = primary.m;
    if (primary.mb === undefined) merged.mb = primary.m;
    if (primary.ml === undefined) merged.ml = primary.m;
  }

  // Padding precedence
  if (primary.p !== undefined) {
    if (primary.px === undefined) merged.px = primary.p;
    if (primary.py === undefined) merged.py = primary.p;
    if (primary.pt === undefined) merged.pt = primary.p;
    if (primary.pr === undefined) merged.pr = primary.p;
    if (primary.pb === undefined) merged.pb = primary.p;
    if (primary.pl === undefined) merged.pl = primary.p;
  }

  // Radius precedence
  if (primary.r !== undefined) {
    if (primary.rtl === undefined) merged.rtl = primary.r;
    if (primary.rtr === undefined) merged.rtr = primary.r;
    if (primary.rbr === undefined) merged.rbr = primary.r;
    if (primary.rbl === undefined) merged.rbl = primary.r;
    if (primary.rt === undefined) merged.rt = primary.r;
    if (primary.rb === undefined) merged.rb = primary.r;
    if (primary.rl === undefined) merged.rl = primary.r;
    if (primary.rr === undefined) merged.rr = primary.r;
  }

  return merged;
}

// ────────────────────────────────────────────
// Shared static-CSS declaration builders — single source of truth for "which DS prop
// maps to which CSS property", consumed by both the Lit adopted-stylesheet generator
// (@we/primitives/shared/helpers.ts) and the Solid DS-interop stylesheet
// (app-framework's dsInterop.ts, generated from these same tables). This is what lets
// hoverProps/activeProps/focusProps support the exact same property surface on both
// component families instead of two independently-maintained, silently-diverging lists.
//
// A PropSpec's third element (fallback) is only required for properties a caller sets
// *unconditionally* regardless of props (e.g. Solid's buildLayoutStyles always emits
// `display`) — for everything else, an absent custom property already degrades
// correctly on its own: CSS resolves a var() with no matching custom property to
// `inherit` for inherited properties (color, cursor, font-*, text-*) or `initial` for
// non-inherited ones (background, opacity, transform, border*, box-shadow, sizing) —
// which is exactly "this prop was never set", since callers only ever emit a key when
// the corresponding prop was actually provided.
// ────────────────────────────────────────────

export type PropSpec = [cssProp: string, varSuffix: string] | [cssProp: string, varSuffix: string, fallback: string];

/** Host/outer-box layout — positioning relative to the parent. */
export const HOST_LAYOUT_SPECS: PropSpec[] = [
  ['width', 'width'],
  ['height', 'height'],
  ['min-width', 'min-width'],
  ['min-height', 'min-height'],
  ['max-width', 'max-width'],
  ['max-height', 'max-height'],
  ['position', 'position'],
  ['top', 'top'],
  ['right', 'right'],
  ['bottom', 'bottom'],
  ['left', 'left'],
  ['z-index', 'z-index'],
  ['margin', 'margin'],
  ['flex', 'flex'],
  ['align-self', 'align-self'],
];

/** Visual/appearance — deliberately excludes bgImage/bgFit/bgPosition/bgImageOpacity/
 * bgImageTint, which are handled by the separate bg-image composite mechanism, not
 * state-variance (swapping the background image itself on hover is out of scope here). */
export const BASE_VISUAL_SPECS: PropSpec[] = [
  // `background-color`, not the `background` shorthand — see the note in `buildLayoutStyles`. A
  // shorthand here resets the background longhands the base rule sets, which made every hover
  // animate `background-position` for no reason.
  ['background-color', 'bg'],
  ['color', 'color'],
  ['opacity', 'opacity'],
  ['border', 'border'],
  ['border-color', 'border-color'],
  ['border-top', 'border-top'],
  ['border-right', 'border-right'],
  ['border-bottom', 'border-bottom'],
  ['border-left', 'border-left'],
  ['border-width', 'border-width'],
  ['box-shadow', 'box-shadow'],
  ['transform', 'transform'],
  ['cursor', 'cursor'],
  ['pointer-events', 'pointer-events'],
  ['visibility', 'visibility'],
  ['border-radius', 'radius'],
];

export const BASE_LAYOUT_SPECS: PropSpec[] = [
  ['display', 'display', 'flex'],
  ['overflow', 'overflow'],
  ['overflow-x', 'overflow-x'],
  ['overflow-y', 'overflow-y'],
  ['scrollbar-width', 'scrollbar-width'],
  ['scrollbar-gutter', 'scrollbar-gutter'],
];

export const BASE_FLEX_SPECS: PropSpec[] = [
  ['flex-direction', 'direction'],
  ['justify-content', 'main-axis'],
  ['align-items', 'cross-axis'],
  ['flex-wrap', 'wrap'],
  ['gap', 'gap'],
  ['padding', 'padding'],
];

export const BASE_TYPOGRAPHY_SPECS: PropSpec[] = [
  ['text-align', 'text-align'],
  ['font-family', 'font-family'],
  ['font-weight', 'font-weight'],
  ['font-size', 'font-size'],
  ['font-style', 'font-style'],
  ['line-height', 'line-height'],
  ['letter-spacing', 'letter-spacing'],
  ['text-decoration', 'text-decoration'],
  ['text-transform', 'text-transform'],
  ['white-space', 'white-space'],
];

export function declCSS(prefix: string, [cssProp, varSuffix, fallback]: PropSpec): string {
  return fallback ? `${cssProp}: var(${prefix}${varSuffix}, ${fallback});` : `${cssProp}: var(${prefix}${varSuffix});`;
}

export function stateDeclCSS(statePrefix: string, defaultPrefix: string, spec: PropSpec): string {
  const [cssProp, varSuffix, fallback] = spec;
  const defaultRef = fallback ? `var(${defaultPrefix}${varSuffix}, ${fallback})` : `var(${defaultPrefix}${varSuffix})`;
  return `${cssProp}: var(${statePrefix}${varSuffix}, ${defaultRef});`;
}

export function joinDeclsCSS(prefix: string, specs: PropSpec[]): string {
  return specs.map((s) => declCSS(prefix, s)).join('\n    ');
}

export function joinStateDeclsCSS(statePrefix: string, defaultPrefix: string, specs: PropSpec[]): string {
  return specs.map((s) => stateDeclCSS(statePrefix, defaultPrefix, s)).join('\n    ');
}

/**
 * Selector list for the `focus` element state, shared by both state-CSS generators — the Lit
 * adopted stylesheet (@we/primitives shared/helpers.ts) and the Solid DS-interop stylesheet
 * (@we/app-shell frameworks/solid/dsInterop.ts) — so `focusProps` cannot come to mean two
 * different things on the two component families.
 *
 * Two arms, because the DS has two shapes of focusable element and no single pseudo-class
 * covers both:
 *
 *   - `:focus-visible` — the element itself holds focus AND the browser judged a ring
 *     warranted (keyboard navigation, not a mouse click). This is the button/link case. It is
 *     why this is not `:focus` or `:focus-within`: those match on click too, which would leave
 *     a focus ring stuck on every button the user clicks — the exact problem `:focus-visible`
 *     was introduced to solve.
 *
 *   - `:has(:focus-visible)` — the element is a wrapper around the real control, as with
 *     we-input's [part='base'] around its inner <input>. A wrapper can never match
 *     `:focus-visible` itself, so without this arm every text field would silently lose its
 *     focus ring. Text-entry fields always match `:focus-visible` while focused (browsers
 *     exempt them from the keyboard-only heuristic), so this preserves the previous
 *     `:focus-within` behaviour for inputs exactly rather than making it mouse-dependent.
 *
 * `suffix` is appended to each arm rather than the list, since a trailing `:not(…)` guard has
 * to bind to both selectors to take effect.
 */
export function focusSelector(target: string, suffix = ''): string {
  return `${target}:focus-visible${suffix}, ${target}:has(:focus-visible)${suffix}`;
}

/**
 * Whether bgImage should render via the ::before overlay + custom-property indirection
 * (true) or a plain background-image directly on the host (false). Shared by both
 * renderers' bgImage handling and the Solid getBgImageAttrs gate — single source of
 * truth so they can't drift apart on what counts as "faded".
 */
export function isBgImageFaded(props: Pick<DesignSystemProps, 'bgImage' | 'bgImageOpacity'>): boolean {
  return !!props.bgImage && props.bgImageOpacity !== undefined && props.bgImageOpacity < 1;
}

// data: URIs (e.g. an uploaded/browsed ImageBlock) can run to hundreds of KB of base64 —
// far too large to embed directly in a CSS value. Even as a *plain* background-image this
// bloats every style recompute; as a CSS custom property specifically, large var() payloads
// hit a real (empirically confirmed, not spec-documented) length ceiling in Chromium and get
// silently dropped. Converting to a Blob + short-lived object URL sidesteps both: the CSS
// value becomes a fixed-length `blob:...` reference regardless of image size. Memoized by
// source string so the same image reused across elements/re-renders converts once. Object
// URLs are never revoked — the number of *distinct* images used in a session is small enough
// that this is a non-issue in practice; revisit with an LRU + revokeObjectURL if that changes.
const bgImageObjectUrlCache = new Map<string, string>();

function dataUriToBlob(dataUri: string): Blob {
  const commaIndex = dataUri.indexOf(',');
  const header = dataUri.slice(0, commaIndex);
  const base64 = dataUri.slice(commaIndex + 1).replace(/\s+/g, '');
  const mimeMatch = /^data:([^;]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Resolves a bgImage value to something safe to embed in CSS. Data URIs get converted to a
 * short-lived object URL (see cache comment above); anything else (a plain http(s) URL) is
 * already short and passes through unchanged, aside from defensive whitespace stripping — a
 * CSS custom property's value is parsed as a CSS token stream even when set via
 * setProperty(), and an unescaped literal newline inside a quoted string produces a "bad
 * string" token that invalidates the entire declaration.
 */
export function resolveBgImageUrl(raw: string): string {
  const clean = raw.replace(/\s+/g, '');
  if (!clean.startsWith('data:')) return clean;
  const cached = bgImageObjectUrlCache.get(clean);
  if (cached) return cached;
  const objectUrl = URL.createObjectURL(dataUriToBlob(clean));
  bgImageObjectUrlCache.set(clean, objectUrl);
  return objectUrl;
}

/**
 * Whether a bgImage value is a CSS gradient rather than an image reference.
 *
 * `background-image` accepts both in CSS, and a mesh — several radial gradients layered into one
 * value — is the only way to express a soft, organic background without an asset. Tested against
 * the start of the value because a mesh is comma-separated gradients, not just one.
 */
const GRADIENT_VALUE = /^\s*(repeating-)?(linear|radial|conic)-gradient\(/i;

export function isGradientValue(raw: string): boolean {
  return GRADIENT_VALUE.test(raw);
}

/**
 * A bgImage value as a CSS `<image>` — a gradient verbatim, anything else wrapped as a URL.
 *
 * Gradients deliberately bypass `resolveBgImageUrl`: it strips *all* whitespace, which is right for
 * a URL and destroys a gradient (`radial-gradient(55% 45% at 18% 22%` becomes unparseable). Their
 * whitespace is collapsed rather than removed, since these values can also land in a custom
 * property, where a literal newline inside a quoted string invalidates the declaration — a gradient
 * has no quoted strings, but collapsing costs nothing and removes the class of problem.
 */
export function bgImageLayer(raw: string): string {
  if (isGradientValue(raw)) return raw.trim().replace(/\s+/g, ' ');
  return `url("${resolveBgImageUrl(raw)}")`;
}

/**
 * Computes the composite `background-image` value for the bg-image overlay mechanism
 * (see dsInterop.ts's [data-we-bg-image]::before / helpers.ts's :host([bgimage])::before).
 * A single custom property carries either a plain image reference, or — when
 * bgImageOpacity is set — that same image with a translucent tint layered on top via a
 * linear-gradient, faking true per-layer opacity (CSS has no way to scope `opacity` to
 * one background layer). Shared so both the Lit and Solid renderers fade identically.
 */
export function computeBgImageComposite(
  props: Pick<DesignSystemProps, 'bgImage' | 'bgImageOpacity' | 'bgImageTint' | 'bg'>,
): string | undefined {
  if (!props.bgImage) return undefined;
  const image = bgImageLayer(props.bgImage);
  if (props.bgImageOpacity === undefined || props.bgImageOpacity >= 1) return image;
  const tintSrc = props.bgImageTint ?? props.bg ?? 'neutral-0';
  const tint = tokenVar('color', tintSrc, tintSrc);
  const pct = Math.round((1 - props.bgImageOpacity) * 100);
  const wash = `color-mix(in srgb, ${tint} ${pct}%, transparent)`;
  // Layers cleanly over a gradient too: the wash simply becomes the first of several.
  return `linear-gradient(${wash}, ${wash}), ${image}`;
}

// Map flex axes based on direction
export function mapFlexAxes(props: DesignSystemProps, direction: FlexDirection) {
  const isRow = direction.includes('row');
  const mainKey = isRow ? props.ax : props.ay;
  const crossKey = isRow ? props.ay : props.ax;

  return {
    direction,
    main: flexMainAxisMap[mainKey as keyof typeof flexMainAxisMap],
    cross: flexCrossAxisMap[crossKey as keyof typeof flexCrossAxisMap],
  };
}

// ────────────────────────────────────────────
// Layout style builder (framework-neutral)
//
// Pure DS-props → CSS style object. Emits CSS-canonical *kebab-case* property keys — the
// neutral form consumed directly by Solid's `style` prop, the DOM setProperty/CSSOM, and
// Lit. A framework whose style prop expects camelCase (e.g. React) normalizes keys in its
// own adapter, not here. Lives in the neutral core (not a framework entry) so every
// framework binding computes identical styles from one source; each binding is only a thin
// reactive wrapper that re-types the return as its own CSS type.
// ────────────────────────────────────────────

/** Framework-neutral CSS style object: CSS-canonical kebab-case keys → value. */
export type CSSStyleObject = Record<string, string | number | undefined>;

/** Props accepted by buildLayoutStyles — DS props plus a `reverse` flag and a `styles` escape hatch. */
export type LayoutStyleProps = DesignSystemProps & {
  reverse?: boolean;
  styles?: CSSStyleObject;
};

export function buildLayoutStyles(props: LayoutStyleProps, direction: 'row' | 'column'): CSSStyleObject {
  // Base flex container styles
  const style: CSSStyleObject = {
    display: props.display || 'flex',
    'flex-direction': props.reverse ? `${direction}-reverse` : direction,
    'flex-wrap': props.wrap ? 'wrap' : 'nowrap',
  };

  // Colors & backgrounds
  if (props.bg) {
    /*
      Longhands, never the `background` shorthand.

      The shorthand resets every background longhand it does not mention — image, size, position,
      repeat. The base rule sets `background-position: var(--we-*-bg-image-position, center)` on every
      component, so a hover rule using the shorthand silently reset position from `50% 50%` to
      `0% 0%`. With the design system's `transition: all` default, that difference *animated*, so every
      hover ran two pointless transitions (`background-position-x` and `-y`) alongside the colour —
      repainting the background area for 150ms and producing a visible flicker.

      It was a correctness bug too, not only a cosmetic one: any component with a `bgImage` and a
      hover `bg` had its image reset on hover, because the shorthand cleared `background-image`.

      Splitting by kind keeps each value in the property that owns it, so nothing clobbers anything.
    */
    if (props.bg.startsWith('gradient-')) {
      style['background-image'] = `var(--we-gradient-${props.bg.slice(9)})`;
    } else {
      style['background-color'] = tokenVar('color', props.bg);
    }
  }
  if (props.bgImage) {
    if (isBgImageFaded(props)) {
      // Faded — rendered via the DS interop stylesheet's [data-we-bg-image]::before
      // overlay (see dsInterop.ts) rather than a plain background-image here, so
      // bgImageOpacity can fade the image independently of the element's own content/
      // opacity — CSS has no way to scope `opacity` to just one background layer, so
      // the image needs its own paint layer. Custom properties are the only way to get
      // a per-instance dynamic value into a pseudo-element (inline styles can't target
      // ::before directly). computeBgImageComposite resolves the URL through
      // resolveBgImageUrl internally, so this is safe for large data URIs too — only
      // paid for (the extra paint layer + indirection) when fading is actually requested.
      style['--we-bg-image-composite'] = computeBgImageComposite(props);
      style['--we-bg-image-fit'] = props.bgFit ?? 'cover';
      style['--we-bg-image-position'] = props.bgPosition ?? 'center';
      // The pseudo-element overlay is absolutely positioned against this host — only
      // default to relative when the caller hasn't already claimed `position`.
      if (!props.position) style.position = 'relative';
    } else {
      // No fading — a plain background-image directly on the host, same as before
      // bgImageOpacity existed. No custom-property indirection, so no z-index/stacking-
      // context concerns from the pseudo-element overlay. Still resolved through
      // resolveBgImageUrl (data URI -> short object URL) — a large base64 payload
      // bloats every style recompute even as a plain inline style, not just as a var().
      style['background-image'] = bgImageLayer(props.bgImage);
      style['background-size'] = props.bgFit ?? 'cover';
      style['background-position'] = props.bgPosition ?? 'center';
      style['background-repeat'] = 'no-repeat';
    }
  }
  if (props.color) style.color = tokenVar('color', props.color);

  // Visual Effects
  if (props.opacity !== undefined) style.opacity = props.opacity;
  if (props.border) style.border = parseBorder(props.border);
  if (props.borderColor) style['border-color'] = tokenVar('color', props.borderColor);
  if (props.borderTop) style['border-top'] = parseBorder(props.borderTop);
  if (props.borderRight) style['border-right'] = parseBorder(props.borderRight);
  if (props.borderBottom) style['border-bottom'] = parseBorder(props.borderBottom);
  if (props.borderLeft) style['border-left'] = parseBorder(props.borderLeft);
  if (props.borderWidth) style['border-width'] = props.borderWidth;
  if (props.shadow || props.ring) {
    const parts = [props.ring, props.shadow].filter(Boolean).join(', ');
    style['box-shadow'] = parts;
  }
  if (props.transform) style.transform = props.transform;
  if (props.transition) style.transition = props.transition;

  // Typography
  if (props.textAlign) style['text-align'] = props.textAlign;
  if (props.fontFamily) style['font-family'] = resolveFontFamily(props.fontFamily);
  if (props.fontWeight) style['font-weight'] = resolveFontWeight(props.fontWeight);
  if (props.fontSize) style['font-size'] = tokenVar('font', props.fontSize);
  if (props.lineHeight) style['line-height'] = resolveLineHeight(props.lineHeight);
  if (props.letterSpacing) style['letter-spacing'] = props.letterSpacing;
  if (props.textDecoration) style['text-decoration'] = props.textDecoration;
  if (props.textTransform) style['text-transform'] = props.textTransform;
  if (props.whiteSpace) style['white-space'] = props.whiteSpace;

  // Interaction
  if (props.cursor) style.cursor = props.cursor;
  if (props.pointerEvents) style['pointer-events'] = props.pointerEvents;
  if (props.visibility) style.visibility = props.visibility;

  // Flex item
  if (props.flex) style.flex = props.flex;
  // `0` is the value that matters here and is falsy, so test for presence rather than truth.
  if (props.flexShrink !== undefined) style['flex-shrink'] = props.flexShrink;
  if (props.alignSelf) style['align-self'] = props.alignSelf;

  // Layout
  if (props.width) style.width = props.width;
  if (props.height) style.height = props.height;
  if (props.minWidth) style['min-width'] = props.minWidth;
  if (props.minHeight) style['min-height'] = props.minHeight;
  if (props.maxWidth) style['max-width'] = props.maxWidth;
  if (props.maxHeight) style['max-height'] = props.maxHeight;
  const { main, cross } = mapFlexAxes(props, props.reverse ? `${direction}-reverse` : direction);
  if (main !== undefined) style['justify-content'] = main;
  if (cross !== undefined) style['align-items'] = cross;
  if (props.gap) style.gap = tokenVar('space', props.gap);
  if (props.overflow) style.overflow = props.overflow;
  if (props.overflowX) style['overflow-x'] = props.overflowX;
  if (props.overflowY) style['overflow-y'] = props.overflowY;
  if (props.scrollbarWidth) style['scrollbar-width'] = props.scrollbarWidth;
  if (props.scrollbarGutter) style['scrollbar-gutter'] = props.scrollbarGutter;
  if (props.zIndex !== undefined) style['z-index'] = zIndexVar(props.zIndex);
  if (props.position) style.position = props.position;
  // Offsets resolve space tokens, like margin and padding do. They were raw passthrough, which
  // made `bottom: '400'` emit an unitless `bottom: 400` — invalid, silently dropped by the
  // browser, and indistinguishable from a typo at author time since the prop is typed `string`.
  // tokenVar discriminates by shape, so '400' becomes var(--we-space-400) while '400px', '50%',
  // 'calc(...)' and '-8px' still pass through untouched.
  if (props.top) style.top = tokenVar('space', props.top);
  if (props.right) style.right = tokenVar('space', props.right);
  if (props.bottom) style.bottom = tokenVar('space', props.bottom);
  if (props.left) style.left = tokenVar('space', props.left);

  // Margin
  const margin = getMarginValues(props);
  if (margin !== '0 0 0 0') style.margin = margin;

  // Padding
  const padding = getPaddingValues(props);
  if (padding !== '0 0 0 0') style.padding = padding;

  // Radius
  const radius = getRadiusValues(props);
  if (radius !== '0 0 0 0') style['border-radius'] = radius;

  // Last, so it genuinely overrides. Spread at the top it was beaten by every DS prop assigned
  // afterwards — `bg` especially, which emits the `background` shorthand and so silently erased a
  // `background-image` set here. The comment said "allow custom overrides" and the position said
  // the opposite; this is the escape hatch, and an escape hatch that loses is worse than none,
  // because the failure is invisible.
  return { ...style, ...props.styles };
}

/**
 * Opt-in attribute for the DS interop stylesheet's [data-we-bg-image]::before overlay.
 * Gated on an explicit attribute (rather than a bare pseudo-element on every layout
 * primitive) so elements that never use bgImage don't pay for an extra paint layer — and
 * specifically on the faded case, since the unfaded case renders via a plain
 * background-image on the host (see buildLayoutStyles) and never needs the overlay at all.
 */
export function getBgImageAttrs(
  props: Pick<LayoutStyleProps, 'bgImage' | 'bgImageOpacity'>,
): Record<string, string | undefined> {
  return { 'data-we-bg-image': isBgImageFaded(props) ? '' : undefined };
}

// ────────────────────────────────────────────
// Interactive-state (hover/active/focus) style machinery
//
// Rendered via native :hover/:active/:focus-within in the DS interop stylesheet (see
// app-framework's dsInterop.ts) instead of JS-tracked signals + mouseenter/mouseleave/blur
// listeners — the browser handles the state transition for free, and it composes correctly
// with every DesignSystemProps field (not a hand-picked subset), because it's built from the
// exact same PropSpec tables Lit's we-* primitives already use for their own
// :host(:hover)/[part=base]:hover rules. bgImage-related keys are excluded — handled
// separately by the bg-image composite mechanism, not state-variance.
// ────────────────────────────────────────────

// position/top/right/bottom/left are deliberately excluded: bgImage's overlay depends
// on `position: relative` being stable on the host, and an unset --we-ds-position would
// resolve to `static` (position isn't inherited), which could win the cascade over the
// bg-image rule's own position:relative depending on stylesheet order when both
// bgImage and hoverProps are set on the same element. Varying position by hover/active/
// focus state is a rare enough pattern that excluding it is the safer default.
const POSITIONING_VAR_SUFFIXES = new Set(['position', 'top', 'right', 'bottom', 'left']);

// Exported so the generated dsInterop stylesheet (app-framework bootstrap) can declare
// exactly the same properties this module emits vars for — one source of truth for
// both the JS var-emission and the CSS rule text, so they can never drift apart.
export const INTERACTIVE_SPECS: PropSpec[] = [
  ...HOST_LAYOUT_SPECS.filter(([, varSuffix]) => !POSITIONING_VAR_SUFFIXES.has(varSuffix)),
  ...BASE_VISUAL_SPECS,
  ...BASE_LAYOUT_SPECS,
  ...BASE_FLEX_SPECS,
  ...BASE_TYPOGRAPHY_SPECS,
];
export const CSS_PROP_TO_VAR_SUFFIX = new Map(INTERACTIVE_SPECS.map(([cssProp, varSuffix]) => [cssProp, varSuffix]));

// Remaps a computed style object's CSS-property keys to --we-ds-{prefix}{varSuffix}
// custom properties, using the shared PropSpec tables' cssProp -> varSuffix mapping.
// Keys outside the interactive-state surface (e.g. --we-bg-image-*) are left alone.
export function toInteractiveVars(prefix: string, computed: CSSStyleObject): CSSStyleObject {
  const out: Record<string, string> = {};
  for (const [cssProp, value] of Object.entries(computed)) {
    if (value === undefined || value === null || value === '') continue;
    const varSuffix = CSS_PROP_TO_VAR_SUFFIX.get(cssProp);
    if (!varSuffix) continue;
    out[`--we-ds-${prefix}${varSuffix}`] = String(value);
  }
  return out;
}

// buildLayoutStyles always computes display/flex-direction/flex-wrap regardless of
// which props were actually provided (they're an unconditional structural baseline for
// a *complete* element style) — for a hover/active/focus *fragment*, that would leak
// those structural defaults into every state variant even when the caller only meant to
// vary e.g. `bg`. `direction` isn't part of DesignSystemProps at all (it's a fixed
// per-component parameter, never user-settable via state props), so flex-direction is
// always stripped; display/wrap are kept only when actually present in the fragment.
export function buildStateFragmentStyles(
  stateProps: Partial<DesignSystemProps>,
  direction: 'row' | 'column',
): CSSStyleObject {
  const computed = buildLayoutStyles({ ...stateProps, styles: undefined } as LayoutStyleProps, direction);
  delete computed['flex-direction'];
  if (!('display' in stateProps)) delete computed['display'];
  if (!('wrap' in stateProps)) delete computed['flex-wrap'];
  return computed;
}
