import { copyFile } from 'node:fs/promises';

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/we-validate-schemas.ts'],
  format: ['esm'],
  dts: { entry: ['src/index.ts'] },
  clean: true,
  // `assetHooks.mjs` is loaded by `register()` at runtime, by path, in a separate thread — never
  // imported — so tsup does not see it and the built CLI would fail on the first schema that
  // imports an image. Copied rather than bundled for the same reason it is plain `.mjs`.
  async onSuccess() {
    await copyFile('src/cli/assetHooks.mjs', 'dist/cli/assetHooks.mjs');
  },
});
