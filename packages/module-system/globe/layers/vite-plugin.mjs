/**
 * Serves the layers' own data from the app's origin: in development from this package's `assets/`
 * folder, and in a build copied next to the bundle.
 *
 * The country outlines fetched their borders from GitHub at runtime, so a globe with no network had
 * none, and a failed fetch was an error in the console every time it mounted. Served by the app, they
 * draw offline. The companion of `cesiumAssets()` from `@we/globe-widget/vite`, which does the same
 * for the engine's own files; an app that draws a globe uses both.
 *
 * Plain `.mjs` because the apps' Vite configs import it, and Node runs those as JavaScript.
 *
 * @module
 */
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'assets');

/** Where the files are served from, under the app's base. */
const MOUNT = 'globe-layers/';

const TYPES = {
  '.geojson': 'application/geo+json',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * @returns {import('vite').Plugin}
 */
export function globeLayerAssets() {
  /** @type {string} */
  let base = '/';

  return {
    name: 'we:globe-layer-assets',

    config(config) {
      // Absolute for the reason `cesiumAssets()` gives: a relative base would resolve against the route.
      base = config.base && config.base.startsWith('/') ? config.base : '/';
      return {
        define: { 'import.meta.env.WE_GLOBE_LAYER_ASSETS_URL': JSON.stringify(`${base}${MOUNT}`) },
      };
    },

    configureServer(server) {
      server.middlewares.use(`${base}${MOUNT}`, (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = normalize(join(SOURCE, path));
        if (!file.startsWith(SOURCE + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },

    writeBundle(options) {
      if (!options.dir) return;
      cpSync(SOURCE, join(options.dir, MOUNT), { recursive: true, filter: (src) => !src.endsWith('.md') });
    },
  };
}
