import { defineConfig } from 'vitest/config';

// The live suite, against a real executor — kept out of `vitest run` because it needs a binary
// and minutes, where the ordinary tests need neither. See tests/live/executor.ts.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.ts'],
    globalSetup: ['tests/live/executor.ts'],
    environment: 'node',
    // One executor serves every file, and its perspectives are cheap to keep apart but not free.
    fileParallelism: false,
    hookTimeout: 180_000,
  },
});
