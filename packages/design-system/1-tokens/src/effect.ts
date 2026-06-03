/**
 * EFFECT TOKEN DEFINITIONS
 * This file defines visual effect tokens that serve as the source of truth for the design system.
 */

// Literal union type for depth effect levels
export type DepthToken = 'none' | '100' | '200' | '300' | '400' | '500';

/**
 * Depth effects (shadows) at different elevation levels.
 * These values create the perception of height and layering in the UI.
 */
export const depth = {
  none: 'none',
  '100': '0px 1px 1px 0px rgb(9 30 66 / 50%), 0px 2px 4px 0px rgb(9 30 66 / 15%)',
  '200': '0px 2px 2px 0px rgb(9 30 66 / 6%), 0px 4px 8px -2px rgb(9 30 66 / 25%)',
  '300': '0px 2px 2px 0px rgb(9 30 66 / 6%), 0px 8px 16px -4px rgb(9 30 66 / 25%)',
  '400': '0px 4px 4px 0px rgb(9 30 66 / 6%), 0px 12px 24px -6px rgb(9 30 66 / 25%)',
  '500': '0px 6px 6px 0px rgb(9 30 66 / 10%), 0px 20px 32px -8px rgb(9 30 66 / 25%)',
} satisfies Record<DepthToken, string>;

/**
 * Complete effect token object that combines all visual effect categories.
 * This is the main export for consumers who need effect tokens.
 */
export const effect = { depth };
