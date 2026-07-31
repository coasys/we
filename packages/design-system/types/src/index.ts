import type {
  ColorValue,
  FontFamilyValue,
  FontSizeValue,
  FontWeightToken,
  LetterSpacingValue,
  LineHeightValue,
  RadiusValue,
  ShadowValue,
  SpaceValue,
  ZIndexValue,
} from '@we/tokens';

export type ElementState = 'hover' | 'focus' | 'active' | 'disabled';
export type Display =
  | 'block'
  | 'inline'
  | 'inline-block'
  | 'flex'
  | 'inline-flex'
  | 'grid'
  | 'inline-grid'
  | 'flow-root'
  | 'contents'
  | 'table'
  | 'table-row'
  | 'table-cell'
  | 'list-item'
  | 'none';
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexMainAxis = 'start' | 'center' | 'end' | 'between' | 'around' | 'even';
export type FlexCrossAxis = 'start' | 'center' | 'end' | 'stretch';
export type Position = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
export type Overflow = 'visible' | 'hidden' | 'clip' | 'scroll' | 'auto' | 'overlay';
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type FontWeight = FontWeightToken | 'light' | 'normal' | 'bolder';
/**
 * The CSS cursor keywords. Unlike spacing or colour, this isn't a design decision with a
 * curated token set — it's a closed list defined by the spec, so the type carries all of
 * it. The previous four values meant drag handles (`ew-resize`, `row-resize`, `grab`) had
 * to reach for the `styles` escape hatch to say something the DS prop should express.
 */
export type Cursor =
  | 'auto'
  | 'default'
  | 'none'
  | 'context-menu'
  | 'help'
  | 'pointer'
  | 'progress'
  | 'wait'
  | 'cell'
  | 'crosshair'
  | 'text'
  | 'vertical-text'
  | 'alias'
  | 'copy'
  | 'move'
  | 'no-drop'
  | 'not-allowed'
  | 'grab'
  | 'grabbing'
  | 'all-scroll'
  | 'col-resize'
  | 'row-resize'
  | 'n-resize'
  | 'e-resize'
  | 's-resize'
  | 'w-resize'
  | 'ne-resize'
  | 'nw-resize'
  | 'se-resize'
  | 'sw-resize'
  | 'ew-resize'
  | 'ns-resize'
  | 'nesw-resize'
  | 'nwse-resize'
  | 'zoom-in'
  | 'zoom-out';
export type TextDecoration = 'underline' | 'line-through' | 'overline' | 'none';
export type TextTransform = 'uppercase' | 'lowercase' | 'capitalize' | 'none';
export type WhiteSpace = 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line' | 'break-spaces';
export type PointerEvents = 'none' | 'auto';
export type Visibility = 'hidden' | 'visible' | 'collapse';
export type ScrollbarWidth = 'auto' | 'thin' | 'none';
export type ScrollbarGutter = 'auto' | 'stable' | 'stable both-edges';
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
  bgImage?: string;
  bgFit?: 'cover' | 'contain';
  bgPosition?: string;
  /** 0–1, matches `opacity`'s convention. Fades bgImage only, via a translucent tint overlay — leaves bg/content untouched. */
  bgImageOpacity?: number;
  /** Tint color the image fades toward as bgImageOpacity decreases. Defaults to the element's own `bg` if set. */
  bgImageTint?: ColorValue;
  color?: ColorValue;

  // Visual Effects
  opacity?: number;
  border?: string;
  borderColor?: ColorValue;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderWidth?: string;
  shadow?: ShadowValue;
  ring?: string;
  transform?: string;
  transition?: string;

  // Typography
  textAlign?: TextAlign;
  fontFamily?: FontFamilyValue;
  fontWeight?: FontWeight;
  fontSize?: FontSizeValue;
  lineHeight?: LineHeightValue;
  letterSpacing?: LetterSpacingValue;
  textDecoration?: TextDecoration;
  textTransform?: TextTransform;
  whiteSpace?: WhiteSpace;

  // Interaction
  cursor?: Cursor;
  pointerEvents?: PointerEvents;
  visibility?: Visibility;

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
  flex?: string;
  /**
   * `flex-shrink`. The shorthand `flex` can express this, but only by also committing to a
   * grow and basis — this is for the common "just don't let it shrink" case, which the
   * codebase previously had to write through the `styles` escape hatch.
   */
  flexShrink?: number | string;
  alignSelf?: string;
  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
  scrollbarWidth?: ScrollbarWidth;
  scrollbarGutter?: ScrollbarGutter;
  zIndex?: ZIndexValue;
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
