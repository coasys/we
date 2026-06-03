import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/components/**/*.ts'],
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
    options.outbase = 'src';
    options.preserveSymlinks = false;
  },
  external: ['lit', 'jdenticon', 'tslib', '@phosphor-icons/core', '@floating-ui/dom'],
  onSuccess: 'cp src/types.ts dist/types.ts && tsx scripts/generate-framework-declarations.ts',
});
