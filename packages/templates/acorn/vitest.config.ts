import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // As @we/module-acorn's vitest config: workspace sources resolve through their
    // `development`/`browser`/`solid` export conditions — `@we/schema-solid` ships its
    // renderer as source under `solid`, and `@we/backend-inmemory` under `development`.
    conditions: ['development', 'browser'],
  },
  test: {
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'jsdom',
    globals: true,
  },
});
