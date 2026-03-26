/**
 * SHADOW TOKEN DEFINITIONS
 * This file defines shadow tokens that serve as the source of truth for the design system.
 */

export type ShadowToken = 'sm' | 'md' | 'lg' | 'xl';
export type ShadowValue = ShadowToken | (string & {});

/**
 * Shadow scale.
 * Named presets for common box-shadow values.
 */
export const shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px rgba(0, 0, 0, 0.15)',
} satisfies Record<ShadowToken, string>;
