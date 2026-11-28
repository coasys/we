import { contentSecurityPolicy, rewriteKnockoutGlobalEval } from '@we/csp/vite';
import { globeLayerAssets } from '@we/globe-layers/vite';
import { cesiumAssets } from '@we/globe-widget/vite';
import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

/*
  The Coasys seed unless the caller chose another. `scripts/seeded.mjs` sets this as well, and writes
  the seed's registries; it is set here too so that `vite` run on its own reads the same seed.
*/
process.env.WE_SEED ??= 'seeds/coasys.seed.json';

const { seedPath, weSeed } = await import('../../scripts/seed-vite.mjs');

/*
  The same build as `apps/we-web`'s — the policy, the globe's assets, the shell's aliases and the
  reasoning behind each are there — with this app's entry, which draws the cartridge before a session
  and hands over to WE's app once a connection is chosen. Its public files are WE's web app's.
*/
export default defineConfig({
  assetsInclude: ['**/*.glb'],
  publicDir: path.resolve(import.meta.dirname, '../we-web/public'),
  plugins: [
    weSeed(),
    solidPlugin(),
    contentSecurityPolicy({ host: 'web', seedFile: seedPath() }),
    rewriteKnockoutGlobalEval(),
    cesiumAssets(),
    globeLayerAssets(),
  ],
  server: {
    port: 3004,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: { allow: ['../..'] },
  },
  build: {
    target: 'esnext',
    // See apps/we-web/vite.config.ts: the chunks above the default are the on-demand viewers.
    chunkSizeWarningLimit: 3500,
  },
  optimizeDeps: { exclude: ['@coasys/ad4m', '@coasys/ad4m-connect'] },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': path.resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
});
