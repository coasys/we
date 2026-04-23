import type { DesignSystemProps, FlexDirection } from '@we/design-types';

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
  ...marginKeys,
] as const;

/** Visual layer: appearance & decoration. Most components. */
export const visualKeys = [
  'bg',
  'color',
  'opacity',
  'shadow',
  'ring',
  'cursor',
  'pointerEvents',
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
  // and CSS keywords (transparent, currentColor, inherit, initial, unset, revert).
  if (/^(transparent|currentcolor|inherit|initial|unset|revert)$/i.test(value)) return true;
  return /^-?(var\(|#|rgba?|hsla?|\d+(\.\d+)?(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|\s))/.test(value);
}

export function tokenVar(prefix: string, token?: string, fallback = '0') {
  // If no token, return fallback
  if (!token) return fallback;

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
