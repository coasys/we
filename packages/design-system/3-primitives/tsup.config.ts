import { globSync } from 'node:fs';
import { basename } from 'node:path';

import { defineConfig } from 'tsup';

// One entry per primitive so `import '@we/primitives/button'` works — the
// package.json `./*` exports map to dist/components/*.js, matching the
// dist/types/*/components/*.d.ts layout the declaration generator emits.
const componentEntries = Object.fromEntries(
  globSync('src/primitives/*.ts').map((file) => [`components/${basename(file, '.ts')}`, file]),
);

export default defineConfig({
  entry: { index: 'src/index.ts', ...componentEntries },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  minify: true,
  outExtension: () => ({ js: '.js' }),
  esbuildOptions(options) {
    options.preserveSymlinks = false;
  },
  external: ['lit', 'jdenticon', 'tslib', '@phosphor-icons/core', '@floating-ui/dom'],
  onSuccess: 'cp src/types.ts dist/types.ts && tsx scripts/generate-framework-declarations.ts',
});
