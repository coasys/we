import type { UserConfig } from 'vite';

export const IDENTITY_CSP: string;

/** A theme as a bundle carries it: its parameters, light and dark sides included. */
export interface IdentityTheme {
  overrides: Record<string, unknown>;
}

/** An app's name, and its mark as SVG text. */
export interface IdentityBrand {
  name: string;
  mark?: string;
}

export function identityWindowConfig(options: {
  root: string;
  outDir: string;
  /** The theme the app's screens before a session are drawn in; WE's light and dark when absent. */
  theme?: IdentityTheme;
  /** The app's name and mark for the window's header; absent, the window names no app. */
  brand?: IdentityBrand;
}): UserConfig;

export const IDENTITY_THEME_MODULE: string;

export const IDENTITY_BRAND_MODULE: string;

export function identityThemeCss(
  theme?: IdentityTheme,
  fontUrl?: (face: { family: string; src: string }) => string,
): string;

export function identityBrand(brand?: IdentityBrand): { name: string; mark: string | null } | null;
