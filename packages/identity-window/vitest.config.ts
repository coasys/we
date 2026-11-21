import { defineConfig } from 'vitest/config';

import { identityWindowConfig } from './vite.js';

// The window's own plugins, so a test that loads `window.ts` resolves its theme stylesheet.
export default defineConfig({ plugins: identityWindowConfig({ root: '.', outDir: 'dist' }).plugins });
