import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Solid's browser build. Under node's default conditions solid-js resolves to its server build,
  // where an effect never runs again after its first run — every guarantee would pass or fail for
  // the wrong reason.
  resolve: { conditions: ['development', 'browser'], dedupe: ['solid-js', 'solid-js/web'] },
  test: {
    // Loaded through vite rather than by node, so solid-js/web and the port share one copy of
    // solid-js. Left to node, solid-js/web is loaded under node's conditions as a second copy: a
    // component's root then owns nothing the port creates, and disposing it stops nothing.
    server: { deps: { inline: [/solid-js/] } },
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'happy-dom',
  },
});
