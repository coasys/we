/**
 * The identity window's bundle, built apart from the app's: `dist/identity/`, from `identity/`, which
 * imports only the shared window (`@we/identity-window`) and the Tauri bridge. No template, module or
 * store code is in it, so nothing a template or a post can influence is in the window that shows
 * the 12 words.
 *
 * In `tauri dev` the app's own Vite server serves `identity/index.html` without the policy, because
 * Vite's dev client injects inline styles and a websocket the policy forbids.
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
