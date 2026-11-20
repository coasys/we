import { defineConfig } from 'vitest/config';

// The bridge's tests need none of the app build's plugins.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
