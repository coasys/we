import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/we-validate-schemas.ts'],
  format: ['esm'],
  dts: { entry: ['src/index.ts'] },
  clean: true,
});
