import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

/**
 * Knockout — vendored inside `@cesium/widgets`, and reached by every `import { Viewer } from
 * 'cesium'` — opens its UMD wrapper by finding the global object as `this || (0, eval)("this")`.
 *
 * Under a module, `this` is `undefined`, so that always takes the eval branch; under a production
 * CSP with no 'unsafe-eval' the eval throws at *import* time, before a line of Knockout runs. The
 * rejected chunk import propagates to app boot, which is why a packaged build died with
 * "[we] the app failed to start" rather than merely losing the globe.
 *
 * `globalThis` is what the idiom is reaching for and has been available since ES2020, so the
 * rewrite is exact rather than a workaround. Done here rather than by granting 'unsafe-eval',
 * which would hand every dependency in the bundle a capability one vendored file wanted.
 *
 * The check that it still applies is made at the end of the build rather than per file. Cesium
 * vendors three knockout files — the library, an ES5 plugin and a re-export shim — and only the
 * library carries the idiom, so requiring it of each one fails on two files that are already fine.
 * What actually matters is that *something* was rewritten: a Cesium upgrade that renames or
 * restructures the vendored copy would otherwise leave this a silent no-op, and the symptom is a
 * packaged app that does not boot.
 */
function rewriteKnockoutGlobalEval() {
  const NEEDLE = 'this||(0,eval)("this")';
  let rewrote = false;

  return {
    name: 'we:rewrite-knockout-global-eval',
    apply: 'build' as const,
    transform(code: string, id: string) {
      if (!id.includes('@cesium/widgets') || !code.includes(NEEDLE)) return null;
      rewrote = true;
      return { code: code.replaceAll(NEEDLE, 'this||globalThis'), map: null };
    },
    buildEnd(error?: Error) {
      if (error || rewrote) return;
      throw new Error(
        `[we] no @cesium/widgets file contained \`${NEEDLE}\`, so nothing was rewritten. Knockout's ` +
          'global lookup has changed shape — re-check it against the production CSP (which grants no ' +
          "'unsafe-eval') before dropping this plugin.",
      );
    },
  };
}

export default defineConfig({
  plugins: [solid(), rewriteKnockoutGlobalEval()],
  assetsInclude: ['**/*.glb'],
  base: './',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // Resolve @we/app-shell internal aliases
      '@shared': resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
  server: { port: 3002 },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Above the 500 kB default because the chunks that crossed it are the on-demand Cesium and
    // three.js bundles. See apps/we-web/vite.config.ts for the full reasoning and what it costs.
    chunkSizeWarningLimit: 3500,
  },
  // Never pre-bundle local file: deps — hard links break on rebuild, causing
  // Vite's dep optimizer cache to serve stale content after restart.
  optimizeDeps: { exclude: ['@coasys/ad4m'] },
});
