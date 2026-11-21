import { defineConfig } from 'vitest/config';

import { identityWindowConfig } from './vite.js';

export default defineConfig({
  // The window's own plugins, so a test that loads `window.ts` resolves its theme stylesheet.
  plugins: identityWindowConfig({ root: '.', outDir: 'dist' }).plugins,
  test: {
    // The window's stylesheet is read as text by its tests (`identity.css?raw`): left out, vitest
    // hands every stylesheet over empty.
    css: { include: [/identity\.css/] },
  },
});
