import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/presets.ts', 'src/sanitiseCss.ts'],
  format: ['esm'],
  dts: true,
  // The CSS build writes into the same folder and runs first; cleaning here would delete it.
  clean: false,
});
