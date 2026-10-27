import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  // Contract packages stay the host's single instance — a second copy of the schema types would be a
  // second registry as far as `instanceof` and module identity are concerned.
  external: ['@we/schema-shared', '@we/module-shared'],
});
