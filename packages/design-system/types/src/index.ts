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
  /**
   * 0–1, or a `var()` so a theme can own the value — which is how the disabled fade is themeable
   * without inventing a colour role that could not serve a ghost button and a danger one at once.
   */
  opacity?: number | `var(${string})`;
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

  /**
   * Raw CSS applied to the component's own element, for what the props above cannot say.
   *
   * Declared here rather than per-component because it is part of the shared prop surface: the
   * layout components have honoured it for a long time, `designSystemKeys` has always listed it, and
   * the prop tables document it. Only the type was missing — so primitives typed it away, accepted
   * it at runtime, and dropped it. A `--we-resize-handle-line: transparent` meant to suppress a
   * divider silently drew one.
   *
   * Applied last, so it genuinely overrides a DS prop setting the same property.
   */
  styles?: Record<string, string | number>;

  // Dynamic styles for states
  hoverProps?: Partial<DesignSystemProps>;
  activeProps?: Partial<DesignSystemProps>;
  focusProps?: Partial<DesignSystemProps>;
  disabledProps?: Partial<DesignSystemProps>;

  /**
   * Values that take over from this width up — the responsive axis.
   *
   * A prop bag per tier, deliberately the same shape as `hoverProps` and friends, because it is the
   * same idea on a different axis: a partial set of props that applies under a condition. `*Props`
   * = partial-prop-bag is already a rule anyone reading a schema knows, and it keeps these
   * discoverable next to the states in the generated declarations.
   *
   * ```
   * { direction: 'column', gap: '300', mdUpProps: { gap: '500' } }
   * ```
   *
   * **Measured against the nearest surface, not the window.** A template renders inside a docked
   * panel, an editor preview pane and a phone, and the viewport is the wrong subject in two of
   * those. See `$surface`.
   *
   * Cascading-through is automatic: at `lg`, something set only in `smUpProps` still applies,
   * because each tier's declaration falls back through the one below it.
   *
   * ### Why `mdUpProps` and not `mdProps`
   *
   * `md` is already a *size* value on some fifteen primitives (`size="md"`), so `mdProps` reads as
   * "medium-size props". `Up` also settles the question every responsive system gets asked — whether
   * a tier means at-this-width or below-it — in the name, where it cannot be forgotten.
   *
   * ### Why states and tiers do not cross
   *
   * There is no `mdUpHoverProps`. Crossing them turns four states by four tiers into sixteen
   * prefixes of generated CSS on every component, to serve a case that is rare enough that nobody
   * here has wanted it yet. `*UpProps` sets base values at that width; `hoverProps` applies at all
   * widths.
   */
  smUpProps?: Partial<DesignSystemProps>;
  mdUpProps?: Partial<DesignSystemProps>;
  lgUpProps?: Partial<DesignSystemProps>;
}
