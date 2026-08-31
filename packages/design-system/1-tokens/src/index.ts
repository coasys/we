/**
 * DESIGN TOKENS SYSTEM
 * This file exports all design tokens and their types from a single entry point.
 */

// Import all token modules
import { animation } from './animation.js';
import { border } from './border.js';
import { breakpoint, TIERS } from './breakpoint.js';
import { color, FILL_LIGHTNESS } from './color.js';
import { component, scrollbarRules } from './component.js';
import { font } from './font.js';
import { layout } from './layout.js';
import { role, ROLE_ALIASES, ROLE_RELATIVE_FALLBACK } from './role.js';
import { shadow } from './shadow.js';
import { avatarSize, componentHeight, radius, size } from './size.js';
import { space } from './space.js';
import { semanticValues, themeFamily } from './themeFamily.js';
import { zIndex } from './z-index.js';

// Re-export all token objects
export {
  animation,
  avatarSize,
  border,
  breakpoint,
  color,
  component,
  scrollbarRules,
  componentHeight,
  FILL_LIGHTNESS,
  font,
  layout,
  radius,
  role,
  ROLE_ALIASES,
  ROLE_RELATIVE_FALLBACK,
  shadow,
  size,
  semanticValues,
  space,
  themeFamily,
  TIERS,
  zIndex,
};

// Export token types
export type { AnimationTransitionToken } from './animation.js';
export type { BorderColorToken } from './border.js';
export type { BreakpointToken, Tier } from './breakpoint.js';
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
export type { SemanticGap, SemanticPadding, SemanticSpace, ThemeFamily, ThemeFamilyAxis } from './themeFamily.js';
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
export type { GapValue, PaddingValue, SpaceToken, SpaceValue } from './space.js';
export type { ZIndexLayer, ZIndexValue } from './z-index.js';
export type { LayoutToken } from './layout.js';
export { CHROMA_CEILING, CHROMA_PER_SATURATION, chromaTaper, RAMP, STATE_STEPS } from './color.js';
export type { Polarity } from './color.js';
export { AVATAR_TONES, avatarToneColor, avatarToneRing } from './color.js';
export type { AvatarTone } from './color.js';
export type { RoleToken } from './role.js';

/**
 * Complete design token system.
 * This object combines all token categories into a single, organized structure
 * for applications that need access to the full design system.
 */
export const tokens = {
  animation,
  border,
  breakpoint,
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
