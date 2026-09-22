import { solidPlugin } from 'esbuild-plugin-solid';
import { defineConfig } from 'tsup';

export default defineConfig({
  /*
    Two entries, and the second is not a convenience.

    `signals/index` is the aggregate rules — how a type's signals read as one number — with no Solid
    in it. The host lends them to templates as `signalTally`, and reaching them through `./solid`
    pulled the whole component barrel in, which on the server side is a client-only API called
    where there is no client. A rule about a vocabulary should not require a renderer to ask.
  */
  entry: {
    'solid/index': 'src/frameworks/solid/index.ts',
    'signals/index': 'src/components/signals/aggregate.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  external: ['solid-js', '@we/primitives'],
  esbuildPlugins: [solidPlugin()],
  esbuildOptions(o) {
    o.jsx = 'automatic';
    o.jsxImportSource = 'solid-js';
  },
  onSuccess: 'sass src/styles/index.scss dist/styles/index.css --no-source-map --style=compressed',
});
