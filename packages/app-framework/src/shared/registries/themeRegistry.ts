import type { ThemeOverrides } from '@we/schema-shared';
import blackCss from '@we/themes/black?raw';
import cyberpunkCss from '@we/themes/cyberpunk?raw';
import darkCss from '@we/themes/dark?raw';
import lightCss from '@we/themes/light?raw';
import retroCss from '@we/themes/retro?raw';

export type ThemeRegistryEntry = {
  name: string;
  icon: string;
  css: string | null;
  overrides: ThemeOverrides | null;
};

export const themeRegistry: Record<string, ThemeRegistryEntry> = {
  light: {
    name: 'Light',
    icon: 'sun',
    css: lightCss || null,
    overrides: { multiplier: 1, subtractor: '0%', saturation: '60%', neutralSaturation: '10%' },
  },
  dark: {
    name: 'Dark',
    icon: 'moon',
    css: darkCss || null,
    overrides: { multiplier: -1, subtractor: '108%', saturation: '50%', neutralSaturation: '20%' },
  },
  black: {
    name: 'Black',
    icon: 'square',
    css: blackCss || null,
    overrides: { multiplier: -1, subtractor: '100%', saturation: '50%', neutralSaturation: '20%' },
  },
  retro: {
    name: 'Retro',
    icon: 'floppy-disk',
    css: retroCss || null,
    overrides: {
      primaryHue: 230,
      multiplier: 1,
      subtractor: '0%',
      saturation: '60%',
      neutralSaturation: '10%',
    },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    icon: 'cpu',
    css: cyberpunkCss || null,
    overrides: { multiplier: -1, subtractor: '110%', saturation: '60%', neutralSaturation: '10%' },
  },
};

export type ThemeKey = keyof typeof themeRegistry;

export function isValidThemeKey(key: unknown): key is ThemeKey {
  return typeof key === 'string' && key in themeRegistry;
}
