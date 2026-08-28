import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Everything here is about the DOM: rectangles, the top layer, pointer capture.
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'jsdom',
    globals: true,
  },
});
