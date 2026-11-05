import type { UserConfig } from 'vite';

export const IDENTITY_CSP: string;

export function identityWindowConfig(options: { root: string; outDir: string }): UserConfig;
