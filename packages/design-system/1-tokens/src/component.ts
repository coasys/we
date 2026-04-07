/**
 * COMPONENT TOKEN DEFINITIONS
 * This file defines component-specific tokens that serve as the source of truth for the design system.
 */

import { colorHues, colorLightness } from './color.js';
import { radius } from './size.js';

// Literal union type for scrollbar properties
export type ScrollbarToken =
  | 'width'
  | 'backgroundImage'
  | 'background'
  | 'cornerBackground'
  | 'thumbBoxShadow'
  | 'thumbBorderRadius'
  | 'thumbBackground';

/**
 * Scrollbar styling tokens.
 * These values define the appearance of scrollbars across the system.
 */
export const scrollbar = {
  width: '6px',
  backgroundImage: 'none',
  background: 'transparent',
  cornerBackground: '#dfdfdf',
  thumbBoxShadow: 'none',
  thumbBorderRadius: radius['400'],
  thumbBackground: `hsl(${colorHues.neutral}, 5%, ${colorLightness['100']})`,
} satisfies Record<ScrollbarToken, string>;

/**
 * Complete component token object that combines all component-specific categories.
 * This is the main export for consumers who need component tokens.
 */
export const component = { scrollbar };
