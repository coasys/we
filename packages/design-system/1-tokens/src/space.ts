/**
 * SPACE TOKEN DEFINITIONS
 * This file defines spacing tokens that serve as the source of truth for the design system.
 */

// Literal union type for numbered space values
export type SpaceToken = '0' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '1000';

// Branded type to allow both tokens and raw spacing values (px, rem, %, etc.) while preserving autocomplete
export type SpaceValue = SpaceToken | (string & {});

/**
 * Spacing scale from 100-1000.
 * These values define standardized spacing for margins, padding, and layout.
 * The scale follows a consistent progression with appropriate values for various UI contexts.
 */
export const space = {
  '0': '0rem', // No spacing
  '100': '0.25rem', // ~4px - Micro spacing
  '200': '0.38rem', // ~6px - Tiny spacing
  '300': '0.5rem', // ~8px - Small spacing
  '400': '1rem', // ~16px - Default spacing
  '500': '1.5rem', // ~24px - Medium spacing
  '600': '2rem', // ~32px - Large spacing
  '700': '2.38rem', // ~38px - Extra large spacing
  '800': '2.75rem', // ~44px - Huge spacing
  '900': '3.25rem', // ~52px - Gigantic spacing
  '1000': '4rem', // ~64px - Extreme spacing
} satisfies Record<SpaceToken, string>;
