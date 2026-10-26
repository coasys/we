/**
 * BORDER TOKEN DEFINITIONS
 * This file defines border tokens that serve as the source of truth for the design system.
 * Note: Border radius tokens are in size.ts (RadiusToken/RadiusValue).
 *
 * Border colours are roles — `border`, `border-strong`, `border-hover` and each family's
 * `<family>-border` — and live with the other roles in role.ts. There were two scale positions here
 * as well, `neutral-100` and `neutral-200`, which nothing read and a theme could not follow.
 */

/**
 * Border width specification.
 * Defines the standard border width used throughout the system.
 */
export const borderWidth = '1px';

/**
 * Complete border token object that combines all border categories.
 * This is the main export for consumers who need full border tokens.
 */
export const border = {
  width: borderWidth,
};
