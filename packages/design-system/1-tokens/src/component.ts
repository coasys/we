/**
 * COMPONENT TOKEN DEFINITIONS
 * This file defines component-specific tokens that serve as the source of truth for the design system.
 */

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
  cornerBackground: 'transparent',
  thumbBoxShadow: 'none',
  thumbBorderRadius: 'var(--we-radius-pill)',
  thumbBackground: 'var(--we-color-neutral-100)',
} satisfies Record<ScrollbarToken, string>;

/**
 * Complete component token object that combines all component-specific categories.
 * This is the main export for consumers who need component tokens.
 */
export const component = { scrollbar };
