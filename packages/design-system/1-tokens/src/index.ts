/**
 * DESIGN TOKENS SYSTEM
 * This file exports all design tokens and their types from a single entry point.
 */

// Import all token modules
import { animation } from './animation.js';
import { border } from './border.js';
import { color } from './color.js';
import { component } from './component.js';
import { font } from './font.js';
import { layout } from './layout.js';
import { role, ROLE_ELEVATION_FALLBACK } from './role.js';
import { shadow } from './shadow.js';
import { avatarSize, componentHeight, radius, size } from './size.js';
import { space } from './space.js';
import { zIndex } from './z-index.js';

// Re-export all token objects
export {
  animation,
  border,
  color,
  component,
  font,
  layout,
  shadow,
  role,
  ROLE_ELEVATION_FALLBACK,
  size,
  radius,
  avatarSize,
  componentHeight,
  space,
  zIndex,
};

// Export token types
export type { AnimationTransitionToken } from './animation.js';
export type { BorderColorToken } from './border.js';
export type {
  ColorBaseToken,
  ColorConfigToken,
  ColorHueToken,
  ColorLightnessToken,
  ComponentVariant,
  HexColor,
  Percentage,
  ColorToken,
  ColorValue,
} from './color.js';
export type { ScrollbarToken } from './component.js';
export type {
  FontFamilyToken,
  FontFamilyValue,
  FontSizeToken,
  FontSizeValue,
  FontWeightToken,
  LineHeightToken,
  LineHeightValue,
  LetterSpacingToken,
  LetterSpacingValue,
} from './font.js';
export type { ShadowToken, ShadowValue } from './shadow.js';
export type { SizeToken, SizeValue, RadiusToken, RadiusValue, ComponentSize } from './size.js';
export type { SpaceToken, SpaceValue } from './space.js';
export type { ZIndexLayer, ZIndexValue } from './z-index.js';
export type { LayoutToken } from './layout.js';
export { CHROMA_CEILING, CHROMA_PER_SATURATION, chromaTaper, RAMP } from './color.js';
export type { Polarity } from './color.js';
export type { RoleToken } from './role.js';

/**
 * Complete design token system.
 * This object combines all token categories into a single, organized structure
 * for applications that need access to the full design system.
 */
export const tokens = {
  animation,
  border,
  color,
  component,
  font,
  layout,
  role,
  shadow,
  size,
  radius,
  avatarSize,
  componentHeight,
  space,
  zIndex,
};
