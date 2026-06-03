import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/**/*.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // Preserve directory structure for tokens
  outExtension: () => ({ js: '.js' }),
  splitting: false,
  treeshake: false,
  // Run custom plugin after build
  async onSuccess() {
    // Import and run CSS generator after build
    const { generateCSS } = await import('./scripts/generate-css.js');
    await generateCSS();
  },
});
