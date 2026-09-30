import type { ThemeOverrides } from '@we/schema-shared';
import blackCss from '@we/themes/black?raw';
import cyberpunkCss from '@we/themes/cyberpunk?raw';
import darkCss from '@we/themes/dark?raw';
import lightCss from '@we/themes/light?raw';
import { THEME_PRESETS } from '@we/themes/presets';
import retroCss from '@we/themes/retro?raw';

/**
 * A built-in theme, ready for the app to apply.
 *
 * The *parameters* come from `@we/themes/presets` — the design system owns what a theme is, so a
 * second host does not have to copy the numbers. What is added here is the per-theme CSS string,
 * which is a bundler concern (`?raw`) rather than a design-system one.
 */
export type ThemeRegistryEntry = {
  name: string;
  icon: string;
  css: string | null;
  overrides: ThemeOverrides | null;
};

export const themeRegistry: Record<string, ThemeRegistryEntry> = {
  light: { ...THEME_PRESETS.light, css: lightCss || null, overrides: THEME_PRESETS.light.parameters },
  dark: { ...THEME_PRESETS.dark, css: darkCss || null, overrides: THEME_PRESETS.dark.parameters },
  black: { ...THEME_PRESETS.black, css: blackCss || null, overrides: THEME_PRESETS.black.parameters },
  retro: { ...THEME_PRESETS.retro, css: retroCss || null, overrides: THEME_PRESETS.retro.parameters },
  cyberpunk: {
    ...THEME_PRESETS.cyberpunk,
    css: cyberpunkCss || null,
    overrides: THEME_PRESETS.cyberpunk.parameters,
  },
  // No stylesheet: both are entirely parameters and pinned roles. That is the point of them — a
  // theme needing hand-written CSS is a theme the parametric system could not express, and these
  // two were built to find out how far it stretches.
  channels: { ...THEME_PRESETS.channels, css: null, overrides: THEME_PRESETS.channels.parameters },
  timeline: { ...THEME_PRESETS.timeline, css: null, overrides: THEME_PRESETS.timeline.parameters },
};

export type ThemeKey = keyof typeof themeRegistry;

export function isValidThemeKey(key: unknown): key is ThemeKey {
  return typeof key === 'string' && key in themeRegistry;
}
