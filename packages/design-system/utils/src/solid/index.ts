import type { DesignSystemProps } from '@we/design-types';
import type { Accessor } from 'solid-js';
import { JSX } from 'solid-js';

import {
  BASE_FLEX_SPECS,
  BASE_LAYOUT_SPECS,
  BASE_TYPOGRAPHY_SPECS,
  BASE_VISUAL_SPECS,
  computeBgImageComposite,
  getMarginValues,
  getPaddingValues,
  getRadiusValues,
  HOST_LAYOUT_SPECS,
  mapFlexAxes,
  parseBorder,
  type PropSpec,
  resolveFontFamily,
  resolveFontWeight,
  resolveLineHeight,
  tokenVar,
  zIndexVar,
} from '../index';

export type MaybeAccessor<T> = T | Accessor<T>;

export function toValue<T>(v: MaybeAccessor<T>): T {
  return typeof v === 'function' ? (v as Accessor<T>)() : v;
}

export type LayoutProps = Omit<DesignSystemProps, 'direction'> & {
  reverse?: boolean;
  styles?: JSX.CSSProperties;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>;

export function buildLayoutStyles(props: LayoutProps, direction: 'row' | 'column'): JSX.CSSProperties {
  // Base flex container styles
  const style: JSX.CSSProperties = {
    display: props.display || 'flex',
    'flex-direction': props.reverse ? `${direction}-reverse` : direction,
    'flex-wrap': props.wrap ? 'wrap' : 'nowrap',
    ...props.styles, // Allow custom overrides
  };

  // Colors & backgrounds
  if (props.bg) {
    // Always the `background` shorthand (not `background-color`) — matches the Lit-side
    // PropSpec convention (helpers.ts's BASE_VISUAL_SPECS) so the interactive-state var
    // remap below can read buildLayoutStyles's own output directly, keyed consistently.
    style['background'] = props.bg.startsWith('gradient-')
      ? `var(--we-gradient-${props.bg.slice(9)})`
      : tokenVar('color', props.bg);
  }
  if (props.bgImage) {
    // Rendered via the DS interop stylesheet's [data-we-bg-image]::before overlay (see
    // dsInterop.css) rather than a plain background-image here, so bgImageOpacity can fade
    // the image independently of the element's own content/opacity — CSS has no way to
    // scope `opacity` to just one background layer, so the image needs its own paint layer.
    style['--we-bg-image-composite'] = computeBgImageComposite(props);
    style['--we-bg-image-fit'] = props.bgFit ?? 'cover';
    style['--we-bg-image-position'] = props.bgPosition ?? 'center';
    // The pseudo-element overlay is absolutely positioned against this host — only default
    // to relative when the caller hasn't already claimed `position` for something else.
    if (!props.position) style.position = 'relative';
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

  // Interaction
  if (props.cursor) style.cursor = props.cursor;
  if (props.pointerEvents) style['pointer-events'] = props.pointerEvents;
  if (props.visibility) style.visibility = props.visibility;

  // Flex item
  if (props.flex) style.flex = props.flex;
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
  if (props.top) style.top = props.top;
  if (props.right) style.right = props.right;
  if (props.bottom) style.bottom = props.bottom;
  if (props.left) style.left = props.left;

  // Margin
  const margin = getMarginValues(props);
  if (margin !== '0 0 0 0') style.margin = margin;

  // Padding
  const padding = getPaddingValues(props);
  if (padding !== '0 0 0 0') style.padding = padding;

  // Radius
  const radius = getRadiusValues(props);
  if (radius !== '0 0 0 0') style['border-radius'] = radius;

  return style;
}

/**
 * Opt-in attribute for the DS interop stylesheet's [data-we-bg-image]::before overlay.
 * Gated on an explicit attribute (rather than a bare pseudo-element on every layout
 * primitive) so elements that never use bgImage don't pay for an extra paint layer.
 */
export function getBgImageAttrs(props: Pick<LayoutProps, 'bgImage'>): Record<string, string | undefined> {
  return { 'data-we-bg-image': props.bgImage ? '' : undefined };
}

// ────────────────────────────────────────────
// State props (hover, active, focus) for Solid layout components
//
// Rendered via native :hover/:active/:focus-within in the DS interop stylesheet (see
// dsInterop.css) instead of JS-tracked signals + mouseenter/mouseleave/focus/blur
// listeners — the browser handles the state transition for free, and it composes
// correctly with every DesignSystemProps field (not a hand-picked subset), because it's
// built from the exact same PropSpec tables Lit's we-* primitives already use for their
// own :host(:hover)/[part=base]:hover rules (see @we/design-utils's HOST_LAYOUT_SPECS
// etc. and helpers.ts). bgImage-related keys are excluded — handled separately by the
// bg-image composite mechanism, not state-variance.
// ────────────────────────────────────────────

const INTERACTIVE_SPECS: PropSpec[] = [
  ...HOST_LAYOUT_SPECS,
  ...BASE_VISUAL_SPECS,
  ...BASE_LAYOUT_SPECS,
  ...BASE_FLEX_SPECS,
  ...BASE_TYPOGRAPHY_SPECS,
];
const CSS_PROP_TO_VAR_SUFFIX = new Map(INTERACTIVE_SPECS.map(([cssProp, varSuffix]) => [cssProp, varSuffix]));

// Remaps a computed style object's CSS-property keys to --we-ds-{prefix}{varSuffix}
// custom properties, using the shared PropSpec tables' cssProp -> varSuffix mapping.
// Keys outside the interactive-state surface (e.g. --we-bg-image-*) are left alone.
function toInteractiveVars(prefix: string, computed: JSX.CSSProperties): JSX.CSSProperties {
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
function buildStateFragmentStyles(stateProps: Partial<DesignSystemProps>, direction: 'row' | 'column'): JSX.CSSProperties {
  const computed = buildLayoutStyles({ ...stateProps, styles: undefined } as LayoutProps, direction) as Record<string, unknown>;
  delete computed['flex-direction'];
  if (!('display' in stateProps)) delete computed['display'];
  if (!('wrap' in stateProps)) delete computed['flex-wrap'];
  return computed as JSX.CSSProperties;
}

export interface StatePropsResult {
  style: () => JSX.CSSProperties;
  attrs: JSX.HTMLAttributes<HTMLDivElement>;
}

export function useStateProps(
  baseStyle: Accessor<JSX.CSSProperties>,
  props: LayoutProps,
  direction: 'row' | 'column',
): StatePropsResult {
  const hasHover = () => props.hoverProps && Object.keys(props.hoverProps).length > 0;
  const hasActive = () => props.activeProps && Object.keys(props.activeProps).length > 0;
  const hasFocus = () => props.focusProps && Object.keys(props.focusProps).length > 0;
  const hasAny = () => hasHover() || hasActive() || hasFocus();

  const attrs: JSX.HTMLAttributes<HTMLDivElement> = {};
  Object.defineProperty(attrs, 'data-we-interactive', {
    get: () => (hasAny() ? '' : undefined),
    enumerable: true,
  });

  const style = () => {
    const base = baseStyle();
    if (!hasAny()) return base;

    // Move every interactive-surface property from a direct inline declaration to a
    // --we-ds-* custom property, so the stylesheet's :hover/:active/:focus-within rules
    // (which fall back through --we-ds-{state}-x -> --we-ds-x -> a safe CSS default) can
    // apply them without JS re-deriving the merged style on every pointer/focus event.
    const withoutInteractiveProps = { ...base };
    for (const cssProp of CSS_PROP_TO_VAR_SUFFIX.keys()) delete (withoutInteractiveProps as Record<string, unknown>)[cssProp];

    const baseVars = toInteractiveVars('', base);
    // Declaration order below is the precedence order: rules declared later in the
    // stylesheet win for equal-specificity selectors, so :focus-within < :hover < :active
    // here reproduces the same active-over-hover-over-focus precedence the old
    // JS-merge order (focus, then hover, then active) produced.
    const focusVars = hasFocus() ? toInteractiveVars('focus-', buildStateFragmentStyles(props.focusProps!, direction)) : {};
    const hoverVars = hasHover() ? toInteractiveVars('hover-', buildStateFragmentStyles(props.hoverProps!, direction)) : {};
    const activeVars = hasActive()
      ? toInteractiveVars('active-', buildStateFragmentStyles(props.activeProps!, direction))
      : {};

    return { ...withoutInteractiveProps, ...baseVars, ...focusVars, ...hoverVars, ...activeVars };
  };

  return { style, attrs };
}
