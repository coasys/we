import { DesignSystemProps } from '@we/design-system-types';
import { getMarginValues, getPaddingValues, getRadiusValues, mapFlexAxes, tokenVar } from '@we/design-system-utils';
import type { Accessor } from 'solid-js';
import { JSX } from 'solid-js';

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
  if (props.border) style.border = props.border;
  if (props.shadow) style['box-shadow'] = props.shadow;
  if (props.transform) style.transform = props.transform;
  if (props.transition) style.transition = props.transition;

  // Typography
  if (props.textAlign) style['text-align'] = props.textAlign;
  if (props.fontWeight) style['font-weight'] = props.fontWeight;
  if (props.fontSize) style['font-size'] = tokenVar('font', props.fontSize);
  if (props.lineHeight) style['line-height'] = props.lineHeight;
  if (props.letterSpacing) style['letter-spacing'] = props.letterSpacing;
  if (props.textDecoration) style['text-decoration'] = props.textDecoration;
  if (props.textTransform) style['text-transform'] = props.textTransform;

  // Interaction
  if (props.cursor) style.cursor = props.cursor;
  if (props.pointerEvents) style['pointer-events'] = props.pointerEvents;

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
