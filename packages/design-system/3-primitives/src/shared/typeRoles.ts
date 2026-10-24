import { typeRoleDeclarations } from '@we/tokens';

/**
 * The heading role's declarations for headings a component draws in its own CSS — markdown and
 * sanitised HTML — so a theme's `typeStyles.heading` reaches them as it reaches `we-text`'s heading
 * variants. The face falls back to `headingFontFamily`, the broad setting, and then to inheriting.
 */
export const headingType = (weight: string): string =>
  typeRoleDeclarations('heading', { weight, family: 'var(--we-theme-heading-font-family)' });
