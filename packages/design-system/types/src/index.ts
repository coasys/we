import type { ColorValue, FontSizeToken, RadiusValue, SpaceValue } from '@we/tokens';

export type ElementState = 'hover' | 'focus' | 'active' | 'disabled';
export type Display = 'flex' | 'block' | 'inline' | 'inline-block' | 'grid' | 'inline-flex';
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexMainAxis = 'start' | 'center' | 'end' | 'between' | 'around' | 'even';
export type FlexCrossAxis = 'start' | 'center' | 'end' | 'stretch';
export type Position = 'relative' | 'absolute' | 'fixed' | 'sticky';
export type Overflow = 'hidden' | 'auto';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type FontWeight = 'light' | 'normal' | 'medium' | 'bold' | 'bolder';
export type Cursor = 'pointer' | 'default' | 'text' | 'not-allowed';
export type TextDecoration = 'underline' | 'line-through' | 'overline' | 'none';
export type TextTransform = 'uppercase' | 'lowercase' | 'capitalize' | 'none';
export type PointerEvents = 'none' | 'auto';

// TODO:
// opacity - Could use OpacityToken (e.g., 0, 10, 20, ..., 100)
// shadow - Should use ShadowToken (predefined shadow styles)
// border - Could use BorderToken (predefined border styles)
// lineHeight - Could use LineHeightToken (e.g., 'normal', '1.5', '2')
// letterSpacing - Could use LetterSpacingToken (e.g., 'normal', 'wide', 'wider')
// fontWeight - Could use FontWeightToken (instead of enum)
// zIndex - Could use ZIndexToken (e.g., 'dropdown', 'modal', 'tooltip')

export interface DesignSystemProps {
  // Colors (branded type allows both tokens and raw values with token autocomplete)
  bg?: ColorValue;
  color?: ColorValue;

  // Visual Effects
  opacity?: number;
  border?: string;
  shadow?: string;
  transform?: string;
  transition?: string;

  // Typography
  textAlign?: TextAlign;
  fontWeight?: FontWeight;
  fontSize?: FontSizeToken;
  lineHeight?: string;
  letterSpacing?: string;
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
