/**
 * BORDER TOKEN DEFINITIONS
 * This file defines border tokens that serve as the source of truth for the design system.
 * Note: Border radius tokens are in size.ts (RadiusToken/RadiusValue).
 */

import { color } from './color.js';

// Literal union types for border tokens
export type BorderColorToken = 'base' | 'strong';

/**
 * Border width specification.
 * Defines the standard border width used throughout the system.
 */
export const borderWidth = '1px';

/**
 * Border color definitions.
 * These colors reference neutral color tokens and are used for borders in different contexts.
 * The integration with the color system ensures borders adapt to theme changes.
 */
export const borderColor = {
  base: color.neutral['100'], // Light border - subtle boundaries
  strong: color.neutral['200'], // Strong border - more visible boundaries
} satisfies Record<BorderColorToken, string>;

/**
 * Complete border token object that combines all border categories.
 * This is the main export for consumers who need full border tokens.
 */
export const border = {
  width: borderWidth,
  color: borderColor,
};
