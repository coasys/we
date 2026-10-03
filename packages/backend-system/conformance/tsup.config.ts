import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { entry: ['src/index.ts'] },
  clean: true,
  // The suite registers its cases with the caller's own vitest, so it must not carry a second copy.
  external: ['vitest', '@we/backend-shared', '@we/entities'],
});
