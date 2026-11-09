/**
 * The identity window's bundle, built apart from the app's (`dist/identity/`, from `identity/`), as
 * the Tauri and Electron apps build theirs. The shell serves it on its own scheme
 * (`we-identity://localhost`), rooted at that folder, so the window that shows the 12 words can load
 * nothing of the app's.
 */
import { identityWindowConfig } from '@we/identity-window/vite';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig(
  identityWindowConfig({
    root: resolve(import.meta.dirname, 'identity'),
    outDir: resolve(import.meta.dirname, 'dist/identity'),
  }),
);
