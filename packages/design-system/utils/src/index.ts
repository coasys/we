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

/** Get the combined set of keys for the given layers (deduplicated). */
export function getKeysForLayers(layers: DSLayer[]): string[] {
  const keys = new Set<string>();
  for (const layer of layers) {
    for (const key of layerKeyMap[layer]) keys.add(key);
  }
  return [...keys];
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
  ['background', 'bg'],
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
  const url = `url("${resolveBgImageUrl(props.bgImage)}")`;
  if (props.bgImageOpacity === undefined || props.bgImageOpacity >= 1) return url;
  const tintSrc = props.bgImageTint ?? props.bg ?? 'neutral-0';
  const tint = tokenVar('color', tintSrc, tintSrc);
  const pct = Math.round((1 - props.bgImageOpacity) * 100);
  const wash = `color-mix(in srgb, ${tint} ${pct}%, transparent)`;
  return `linear-gradient(${wash}, ${wash}), ${url}`;
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
