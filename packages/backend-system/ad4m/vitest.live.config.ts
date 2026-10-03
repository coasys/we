import { defineConfig } from 'vitest/config';

// The live suite, against a real executor — kept out of `vitest run` because it needs a binary
// and minutes, where the ordinary tests need neither. See tests/live/executor.ts.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.ts'],
    globalSetup: ['tests/live/executor.ts'],
    environment: 'node',
    // Named rather than left to vitest, which picks a terse reporter under CI and agents: the
    // capability table is console output from a file that passed, and those reporters drop it.
    reporters: ['default'],
    // One executor serves every file, and its perspectives are cheap to keep apart but not free.
    fileParallelism: false,
    hookTimeout: 180_000,
  },
});
