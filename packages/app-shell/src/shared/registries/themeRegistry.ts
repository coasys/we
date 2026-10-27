import { DEV_FEATURES } from '@we/module-shared';
import type { ThemeOverrides } from '@we/schema-shared';
import blackCss from '@we/themes/black?raw';
import cyberpunkCss from '@we/themes/cyberpunk?raw';
import darkCss from '@we/themes/dark?raw';
import lightCss from '@we/themes/light?raw';
import { SHOWCASE_THEME_PRESETS, THEME_PRESETS } from '@we/themes/presets';
import retroCss from '@we/themes/retro?raw';

import { seedBundleThemes } from './seedBundles';

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
  /*
    The showcase templates' themes, named after the products those templates imitate, so only in a
    build with developer features, as the templates are (`DEV_FEATURES`). In a production build the
    spread folds to nothing and `SHOWCASE_THEME_PRESETS` goes unused.

    No stylesheet: both are entirely parameters and pinned roles. That is the point of them — a
    theme needing hand-written CSS is a theme the parametric system could not express, and these
    two were built to find out how far it stretches.
  */
  ...(DEV_FEATURES && {
    discord: {
      ...SHOWCASE_THEME_PRESETS.discord,
      css: null,
      overrides: SHOWCASE_THEME_PRESETS.discord.parameters,
    },
    twitter: {
      ...SHOWCASE_THEME_PRESETS.twitter,
      css: null,
      overrides: SHOWCASE_THEME_PRESETS.twitter.parameters,
    },
  }),
  // The themes the seed's bundles bring, built in beside these.
  ...Object.fromEntries(
    Object.values(seedBundleThemes).map((theme) => [
      theme.id,
      {
        name: theme.name,
        icon: theme.icon ?? 'palette',
        css: theme.css ?? null,
        overrides: theme.overrides as ThemeOverrides,
      },
    ]),
  ),
};

export type ThemeKey = keyof typeof themeRegistry;

export function isValidThemeKey(key: unknown): key is ThemeKey {
  return typeof key === 'string' && key in themeRegistry;
}
