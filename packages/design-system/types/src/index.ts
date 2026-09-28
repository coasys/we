import type {
  ColorValue,
  FontFamilyValue,
  FontSizeValue,
  FontWeightToken,
  GapValue,
  LetterSpacingValue,
  LineHeightValue,
  PaddingValue,
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
/**
 * Where a line may break inside a word that does not fit.
 *
 * `anywhere` is the design system's default, and the distinction from `break-word` is the whole
 * reason this prop exists rather than being left to the raw `styles` escape hatch. Both break in the
 * same *places*; only `anywhere` also reduces the element's min-content width. A flex item and a
 * `1fr` grid track are both sized by min-content, so under `break-word` an unbreakable string still
 * pushes its container — and everything above it — wider than the viewport, which is precisely the
 * failure the default is here to prevent.
 *
 * `word-break: break-all` — break every word at the line edge, including ones that would have fit —
 * is deliberately not offered here. It is a different statement, right for a dense column of hashes
 * and wrong for prose, and on a bare identifier (which is what every site reaching for it in this
 * repo held) it renders identically to `anywhere`. The raw `styles` escape hatch remains for the
 * case that genuinely wants it.
 */
export type OverflowWrap = 'normal' | 'break-word' | 'anywhere';
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
  /**
   * Where this sits in the coordinate space it was placed in, and how far it is turned.
   *
   * `x` and `y` are offsets from where the element would otherwise be; `rotate` is degrees
   * clockwise about its own centre. A bare number is px for the offsets and degrees for the
   * rotation; a string is passed through verbatim and must carry its own unit (`'2rem'`,
   * `'0.25turn'`).
   *
   * ### Why these are props rather than a `transform` string
   *
   * The three compose into `transform` and could always have been written as one — `transform:
   * 'translate(40px, 120px) rotate(-3deg)'` works today. What that spelling costs is everything
   * downstream of it: a raw transform is opaque to the inspector, which cannot offer a rotation
   * handle without parsing CSS; opaque to an LLM editing one component of it; and composed by hand
   * against whatever scale the surface is already applying, which is where the shears come from.
   * Numbers are the form every one of those consumers wants.
   *
   * ### Why translate rather than `top` / `left`
   *
   * Four independent reasons, and any one of them decides it. Positioning offsets **do not tier**
   * (see `mdUpProps`), so translate is the only spelling of "move it" that responds to a
   * breakpoint at all. It composes with rotation and scale in one property rather than fighting
   * them. It is compositor-friendly — no layout on a drag frame. And it stays correct inside a
   * scaled surface, where a pixel offset would be measured in the wrong units.
   *
   * ### Two things to know
   *
   * A **percentage resolves against the element's own size**, not its parent's — that is what
   * `translate` does, and it is rarely what somebody writing `x: '50%'` means. Give a coordinate a
   * length.
   *
   * Setting any of them makes the element a **containing block** for absolutely positioned
   * descendants, as any transform does.
   *
   * An explicit `transform` still applies, after these: the element is placed and turned, and then
   * whatever else it asked for happens in that frame.
   */
  x?: number | string;
  y?: number | string;
  rotate?: number | string;
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
  overflowWrap?: OverflowWrap;

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
  gap?: GapValue;
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
  p?: PaddingValue;
  pl?: PaddingValue;
  pr?: PaddingValue;
  pt?: PaddingValue;
  pb?: PaddingValue;
  px?: PaddingValue;
  py?: PaddingValue;

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
   *
   * ### What a tier bag does *not* cover
   *
   * **`position`, `top`, `right`, `bottom` and `left` do not tier.** They typecheck here — the bag
   * is `Partial<DesignSystemProps>`, so it accepts every prop — and they are filtered out before
   * any variable is written, on both component families. `mdUpProps: { left: '300px' }` therefore
   * validates, renders, and does nothing at all.
   *
   * The exclusion is deliberate and shared with the state bags; see `POSITIONING_VAR_SUFFIXES` in
   * `@we/design-utils` for why. It is recorded here because that is a fact about the tier axis a
   * caller has no other way to learn: the type cannot express it, and the failure is silent.
   *
   * **Move something at a breakpoint with `x` / `y` / `rotate` instead.** They compose into
   * `transform`, which does tier — as do `width`, `height` and `zIndex`.
   */
  smUpProps?: Partial<DesignSystemProps>;
  mdUpProps?: Partial<DesignSystemProps>;
  lgUpProps?: Partial<DesignSystemProps>;
}

/**
 * What content inside a popover dispatches to close the popover it is in.
 *
 * Bubbling and composed, so it crosses the shadow boundaries between a control and the panel it was
 * slotted into. `we-popover` listens for it; `SignalControl` raises it once a reaction is written,
 * because a control that has finished what it was opened for should not go on sitting over the row
 * it belongs to.
 *
 * Here rather than in either of them because both ends need the same word, and they are in
 * different packages: the primitive cannot be imported for its VALUES (its type entry is a global
 * declaration file, not a module), and a string literal written out twice across a package boundary
 * is how the next silent mismatch starts. A `toggle` from a tooltip closing a popover that could
 * not tell it from its own is the version of that mistake this codebase has already paid for.
 */
export const POPOVER_DISMISS = 'we-popover-dismiss';
