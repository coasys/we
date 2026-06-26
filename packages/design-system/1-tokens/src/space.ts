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
  '0': '0rem', // 0px
  '100': '0.25rem', // 4px — micro
  '200': '0.5rem', // 8px — tight
  '300': '0.75rem', // 12px — compact
  '400': '1rem', // 16px — default
  '500': '1.5rem', // 24px — medium
  '600': '2rem', // 32px — large
  '700': '2.5rem', // 40px — xl
  '800': '3rem', // 48px — 2xl
  '900': '4rem', // 64px — 3xl
  '1000': '6rem', // 96px — 4xl
} satisfies Record<SpaceToken, string>;
