/**
 * DESIGN TOKENS SYSTEM
 * This file exports all design tokens and their types from a single entry point.
 */

// Import all token modules
import { animation } from './animation.js';
import { border } from './border.js';
import { color } from './color.js';
import { component } from './component.js';
import { effect } from './effect.js';
import { font } from './font.js';
import { shadow } from './shadow.js';
import { avatarSize, radius, size } from './size.js';
import { space } from './space.js';

// Re-export all token objects
export { animation, border, color, component, effect, font, shadow, size, radius, avatarSize, space };

// Export token types
export type { AnimationTransitionToken } from './animation.js';
export type { BorderColorToken } from './border.js';
export type {
  ColorBaseToken,
  ColorConfigToken,
  ColorHueToken,
  ColorLightnessToken,
  HexColor,
  Percentage,
  ColorToken,
  ColorValue,
} from './color.js';
export type { ScrollbarToken } from './component.js';
export type { DepthToken } from './effect.js';
export type {
  FontFamilyToken,
  FontSizeToken,
  FontSizeValue,
  FontWeightToken,
  LineHeightToken,
  LineHeightValue,
  LetterSpacingToken,
  LetterSpacingValue,
} from './font.js';
export type { ShadowToken, ShadowValue } from './shadow.js';
export type { SizeToken, SizeValue, RadiusToken, RadiusValue, AvatarSizeToken, AvatarSizeValue } from './size.js';
export type { SpaceToken, SpaceValue } from './space.js';

/**
 * Complete design token system.
 * This object combines all token categories into a single, organized structure
 * for applications that need access to the full design system.
 */
export const tokens = { animation, border, color, component, effect, font, shadow, size, radius, avatarSize, space };
