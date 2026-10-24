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
 * How a change moves, as named curves rather than keywords written in each component.
 *
 * - `standard`: a change in place — a colour, a size.
 * - `out`: something arriving or answering — it starts fast and settles, so even a short hover
 *   lands most of its change.
 * - `in`: something leaving — it starts slowly and gets out of the way.
 *
 * A theme restyles motion by moving these, the way it moves the durations with `animationSpeed`.
 */
export type AnimationEasingToken = 'standard' | 'out' | 'in';
export const animationEasing = {
  standard: 'ease',
  out: 'ease-out',
  in: 'ease-in',
} satisfies Record<AnimationEasingToken, string>;

/**
 * Complete animation token object that combines all animation categories.
 */
export const animation = {
  transition: animationTransition,
  easing: animationEasing,
};
