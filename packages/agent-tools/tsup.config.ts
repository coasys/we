import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: { entry: ['src/index.ts'] },
    clean: true,
  },
  /*
    The single file a host loads by itself. Everything is inlined — the catalogue, the reference,
    zod — and nothing assumes Node or a browser, so the same file runs in Deno, Node or a worker.
    No splitting: the reference is a dynamic import in the package build, so that the editor
    downloads it only when asked, and a split here would turn it into a second file the host would
    have to find.
  */
  {
    entry: { 'agent-tools.bundle': 'src/bundle.ts' },
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    noExternal: [/.*/],
    splitting: false,
    dts: false,
    clean: false,
    esbuildOptions(options) {
      options.mainFields = ['module', 'main'];
      options.conditions = ['import', 'default'];
    },
  },
]);
