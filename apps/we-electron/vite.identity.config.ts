/**
 * The identity window's bundle, built apart from the app's: `dist/identity/`, from `identity/`, which
 * imports only the shared window (`@we/identity-window`). No template, module or store code is in it,
 * so nothing a template or a post can influence is in the window that shows the 12 words.
 *
 * main.js serves it on the window's own scheme, in development too, so the window always runs the
 * built page under its policy.
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
