import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // This is the key: esbuild natively supports legacy TS decorators
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    },
  },
  test: {
    testTimeout: 600_000,  // 10 min — seeding 100k links takes time
    hookTimeout: 300_000,  // 5 min — executor startup + seeding
    sequence: { concurrent: false },
    reporters: ['verbose'],
    include: ['benchmarks/**/*.bench.ts'],
    isolate: false,
  },
});
