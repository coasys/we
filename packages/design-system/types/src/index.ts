import type {
  ColorValue,
  FontSizeValue,
  FontWeightToken,
  LetterSpacingValue,
  LineHeightValue,
  RadiusValue,
  ShadowValue,
  SpaceValue,
} from '@we/tokens';

export type ElementState = 'hover' | 'focus' | 'active' | 'disabled';
export type Display = 'flex' | 'block' | 'inline' | 'inline-block' | 'grid' | 'inline-flex';
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexMainAxis = 'start' | 'center' | 'end' | 'between' | 'around' | 'even';
export type FlexCrossAxis = 'start' | 'center' | 'end' | 'stretch';
export type Position = 'relative' | 'absolute' | 'fixed' | 'sticky';
export type Overflow = 'hidden' | 'auto';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type FontWeight = FontWeightToken | 'light' | 'normal' | 'medium' | 'bold' | 'bolder';
export type Cursor = 'pointer' | 'default' | 'text' | 'not-allowed';
export type TextDecoration = 'underline' | 'line-through' | 'overline' | 'none';
export type TextTransform = 'uppercase' | 'lowercase' | 'capitalize' | 'none';
export type PointerEvents = 'none' | 'auto';
export type Placement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end';

export interface DesignSystemProps {
  bg?: ColorValue;
  color?: ColorValue;

  // Visual Effects
  opacity?: number;
  border?: string;
  shadow?: ShadowValue;
  transform?: string;
  transition?: string;

  // Typography
  textAlign?: TextAlign;
  fontWeight?: FontWeight;
  fontSize?: FontSizeValue;
  lineHeight?: LineHeightValue;
  letterSpacing?: LetterSpacingValue;
  textDecoration?: TextDecoration;
  textTransform?: TextTransform;

  // Interaction
  cursor?: Cursor;
  pointerEvents?: PointerEvents;

  // Layout
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  display?: Display;
  direction?: FlexDirection;
  ax?: FlexMainAxis | FlexCrossAxis;
  ay?: FlexMainAxis | FlexCrossAxis;
  wrap?: boolean;
  gap?: SpaceValue;
  overflow?: Overflow;
  zIndex?: number;
  position?: Position;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;

  // Margin
  m?: SpaceValue;
  ml?: SpaceValue;
  mr?: SpaceValue;
  mt?: SpaceValue;
  mb?: SpaceValue;
  mx?: SpaceValue;
  my?: SpaceValue;

  // Padding
  p?: SpaceValue;
  pl?: SpaceValue;
  pr?: SpaceValue;
  pt?: SpaceValue;
  pb?: SpaceValue;
  px?: SpaceValue;
  py?: SpaceValue;

  // Radius
  r?: RadiusValue;
  rt?: RadiusValue;
  rb?: RadiusValue;
  rl?: RadiusValue;
  rr?: RadiusValue;
  rtl?: RadiusValue;
  rtr?: RadiusValue;
  rbr?: RadiusValue;
  rbl?: RadiusValue;

  // Dynamic styles for states
  hoverProps?: Partial<DesignSystemProps>;
  activeProps?: Partial<DesignSystemProps>;
  focusProps?: Partial<DesignSystemProps>;
  disabledProps?: Partial<DesignSystemProps>;
}

/** camelCase DesignSystemProps keys that must be set as properties (not attributes) on web components */
export const DESIGN_SYSTEM_CAMEL_CASE_PROPS: ReadonlySet<string> = new Set([
  'textAlign',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textTransform',
  'pointerEvents',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'zIndex',
  'hoverProps',
  'activeProps',
  'focusProps',
  'disabledProps',
]);
