import { globSync } from 'node:fs';
import { basename } from 'node:path';

import { defineConfig } from 'tsup';

// One entry per primitive so `import '@we/primitives/button'` works — the
// package.json `./*` exports map to dist/primitives/*.js, mirroring
// src/primitives (the declaration generator emits the matching
// dist/types/*/primitives/*.d.ts layout).
// Tests excluded: the glob would otherwise make `select.test.ts` a build entry, and vitest then
// picks the compiled copy back up out of `dist` and runs it against bundled code it cannot resolve.
const primitiveEntries = Object.fromEntries(
  globSync('src/primitives/*.ts')
    .filter((file) => !file.endsWith('.test.ts'))
    .map((file) => [`primitives/${basename(file, '.ts')}`, file]),
);

export default defineConfig({
  entry: { index: 'src/index.ts', ...primitiveEntries },
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
  // `@we/drag` MUST be external, and this is load-bearing rather than a size optimisation: the
  // session is a module-level singleton, and `splitting: false` gives every primitive its own
  // bundle — so bundling it would put a *separate* session inside `sortable.js` and
  // `drop-zone.js`, and a drag begun in one would be invisible to the other. Same reason the
  // editor's composer keeps it external.
  external: ['lit', 'jdenticon', 'tslib', '@phosphor-icons/core', '@floating-ui/dom', '@we/drag'],
  onSuccess: 'cp src/types.ts dist/types.ts && tsx scripts/generate-framework-declarations.ts',
});
