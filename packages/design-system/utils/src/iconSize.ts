import type { SizeToken, SizeValue } from '@we/tokens';

/**
 * IconSize type definition (SizeValue + empty string for default)
 * Allows both design system tokens and raw size values (px, rem, %, etc.)
 */
export type IconSize = '' | SizeValue;

/**
 * Converts IconSize tokens to CSS variable references for calculations
 * Uses the design system size tokens (--we-size-*)
 *
 * @param size - IconSize token or custom CSS value
 * @returns CSS variable reference or custom value
 */
export function iconSizeToVar(size: IconSize): string {
  // If empty, return default
  if (!size) return '26px';

  // Map tokens to CSS variables
  const sizeTokens: Record<SizeToken, string> = {
    xxs: 'var(--we-size-xxs)', // 0.75rem / 12px
    xs: 'var(--we-size-xs)', // 1rem / 16px
    sm: 'var(--we-size-sm)', // 1.5rem / 24px
    md: 'var(--we-size-md)', // 2rem / 32px
    lg: 'var(--we-size-lg)', // 2.5rem / 40px
    xl: 'var(--we-size-xl)', // 3rem / 48px
    xxl: 'var(--we-size-xxl)', // 4rem / 64px
  };

  // If it's a known token, return the CSS variable
  if (size in sizeTokens) return sizeTokens[size as SizeToken];

  // If it's a custom value (e.g., "20px", "2rem"), return as-is
  return size;
}
