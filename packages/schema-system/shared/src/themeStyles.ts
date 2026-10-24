/**
 * Compatibility surface: the theme mapping moved to `@we/themes`.
 *
 * `themeParametersToStyle`/`applyThemeVars` map theme parameters onto design-system CSS custom properties —
 * design-system knowledge. They lived here because schema nodes can carry a `theme`, but that makes
 * schema-shared a consumer of the vocabulary, not its owner. The implementation (and its tests) now
 * sit beside the presets in `@we/themes`; this module re-exports so existing imports keep working.
 */
export {
  applyThemeVars,
  clearThemeVars,
  fontFaceProblem,
  type FontFaceSetting,
  type DisplayPreferences,
  isDarkPolarity,
  basePolarity,
  migrateOverrides,
  parseOverrides,
  readThemeSettings,
  reconcileSurfaces,
  registerNamedThemes,
  role,
  roleVar,
  setDisplayPreferences,
  setThemeLive,
  previewDisplay,
  rangeForPolarity,
  surfacesForPolarity,
  THEME_SCHEMA_VERSION,
  themeParametersToStyle,
  type ThemeSideName,
  themeSides,
  withThemeSide,
} from '@we/themes/presets';
