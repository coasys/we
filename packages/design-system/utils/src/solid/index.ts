import type { DesignSystemProps } from '@we/design-types';
import type { Accessor } from 'solid-js';
import { createSignal, JSX } from 'solid-js';

import { getMarginValues, getPaddingValues, getRadiusValues, mapFlexAxes, parseBorder, tokenVar } from '../index';

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

  // Colors
  if (props.bg) style['background-color'] = tokenVar('color', props.bg);
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
  if (props.fontFamily) style['font-family'] = props.fontFamily;
  if (props.fontWeight) style['font-weight'] = props.fontWeight;
  if (props.fontSize) style['font-size'] = tokenVar('font', props.fontSize);
  if (props.lineHeight) style['line-height'] = props.lineHeight;
  if (props.letterSpacing) style['letter-spacing'] = props.letterSpacing;
  if (props.textDecoration) style['text-decoration'] = props.textDecoration;
  if (props.textTransform) style['text-transform'] = props.textTransform;

  // Interaction
  if (props.cursor) style.cursor = props.cursor;
  if (props.pointerEvents) style['pointer-events'] = props.pointerEvents;

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
  style['justify-content'] = main;
  style['align-items'] = cross;
  if (props.gap) style.gap = tokenVar('space', props.gap);
  if (props.overflow) style.overflow = props.overflow;
  if (props.zIndex !== undefined) style['z-index'] = props.zIndex;
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

// ────────────────────────────────────────────
// State props (hover, active, focus) for Solid layout components
// ────────────────────────────────────────────

export interface StatePropsResult {
  style: () => JSX.CSSProperties;
  handlers: JSX.HTMLAttributes<HTMLDivElement>;
}

export function useStateProps(
  baseStyle: Accessor<JSX.CSSProperties>,
  props: LayoutProps,
  direction: 'row' | 'column',
): StatePropsResult {
  const hasHover = () => props.hoverProps && Object.keys(props.hoverProps).length > 0;
  const hasActive = () => props.activeProps && Object.keys(props.activeProps).length > 0;
  const hasFocus = () => props.focusProps && Object.keys(props.focusProps).length > 0;

  const [hovered, setHovered] = createSignal(false);
  const [active, setActive] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  const handlers: JSX.HTMLAttributes<HTMLDivElement> = {};

  // Only attach listeners when state props are provided.
  // We use getters so they react to prop changes.
  Object.defineProperties(handlers, {
    onMouseEnter: {
      get: () => (hasHover() ? () => setHovered(true) : undefined),
      enumerable: true,
    },
    onMouseLeave: {
      get: () => (hasHover() ? () => setHovered(false) : undefined),
      enumerable: true,
    },
    onMouseDown: {
      get: () => (hasActive() ? () => setActive(true) : undefined),
      enumerable: true,
    },
    onMouseUp: {
      get: () => (hasActive() ? () => setActive(false) : undefined),
      enumerable: true,
    },
    onFocus: {
      get: () => (hasFocus() ? () => setFocused(true) : undefined),
      enumerable: true,
    },
    onBlur: {
      get: () => (hasFocus() ? () => setFocused(false) : undefined),
      enumerable: true,
    },
  });

  const style = () => {
    const base = baseStyle();

    // Fast path: no state active
    if (!hovered() && !active() && !focused()) return base;

    // Build override styles and merge over base
    let merged = base;
    if (focused() && props.focusProps) {
      merged = {
        ...merged,
        ...buildLayoutStyles({ ...props.focusProps, styles: undefined } as LayoutProps, direction),
      };
    }
    if (hovered() && props.hoverProps) {
      merged = {
        ...merged,
        ...buildLayoutStyles({ ...props.hoverProps, styles: undefined } as LayoutProps, direction),
      };
    }
    if (active() && props.activeProps) {
      merged = {
        ...merged,
        ...buildLayoutStyles({ ...props.activeProps, styles: undefined } as LayoutProps, direction),
      };
    }

    return merged;
  };

  return { style, handlers };
}
