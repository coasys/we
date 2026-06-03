/**
 * ANIMATION TOKEN DEFINITIONS
 * This file defines animation tokens that serve as the source of truth for the design system.
 */

// Literal union type for animation transition levels
export type AnimationTransitionToken = '0' | '100' | '200' | '300' | '400' | '500';

/**
 * Animation transition durations.
 * These values define the speed of transitions and animations throughout the system.
 */
export const animationTransition = {
  '0': '0ms', // Instant - no transition
  '100': '50ms', // Ultra fast - for micro interactions
  '200': '150ms', // Fast - for simple UI feedback
  '300': '250ms', // Medium - standard transitions
  '400': '500ms', // Slow - for more noticeable transitions
  '500': '1000ms', // Very slow - for dramatic effects
} satisfies Record<AnimationTransitionToken, string>;

/**
 * Complete animation token object that combines all animation categories.
 */
export const animation = {
  transition: animationTransition,
};
