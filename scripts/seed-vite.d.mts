import type { Plugin } from 'vite';

/** The seed this build is for, as an absolute path. */
export function seedPath(): string;
/** The seed as an app's Vite build sees it. See `seed-vite.mjs`. */
export function weSeed(): Plugin;
/** The same registry redirect, for esbuild (tsup). */
export function weSeedEsbuild(): { name: string; setup(build: unknown): void };
export function generatedRegistry(source: string, importer: string): string | null;
export function seedRegistryFile(generated: string, name: string): string;
