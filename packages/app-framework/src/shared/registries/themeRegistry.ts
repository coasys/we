export type Theme = { name: string; icon: string };

export const themeRegistry = {
  light: { name: 'Light', icon: 'sun' },
  dark: { name: 'Dark', icon: 'moon' },
  black: { name: 'Black', icon: 'square' },
  retro: { name: 'Retro', icon: 'floppy-disk' },
  cyberpunk: { name: 'Cyberpunk', icon: 'cpu' },
};

export type ThemeKey = keyof typeof themeRegistry;

export function isValidThemeKey(key: unknown): key is ThemeKey {
  return typeof key === 'string' && key in themeRegistry;
}
