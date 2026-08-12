/**
 * Compatibility surface: the theme mapping moved to `@we/themes`.
 *
 * `themeToStyle`/`applyThemeVars` map theme parameters onto design-system CSS custom properties —
 * design-system knowledge. They lived here because schema nodes can carry a `theme`, but that makes
 * schema-shared a consumer of the vocabulary, not its owner. The implementation (and its tests) now
 * sit beside the presets in `@we/themes`; this module re-exports so existing imports keep working.
 */
export { applyThemeVars, roleVar, themeToStyle } from '@we/themes/presets';
