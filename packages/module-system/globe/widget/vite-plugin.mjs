/**
 * Serves Cesium's runtime files from the app's own origin: in development from the installed
 * package, and in a build copied next to the bundle.
 *
 * Cesium's engine code is bundled like any other dependency, but at runtime it also loads its web
 * workers, wasm decoders, widget CSS and textures from a base URL. These used to come from
 * jsDelivr, which meant a globe that needed the network to draw anything, and a third-party host
 * allowed to run script in WE's origin. Served from the app, the globe works offline (apart from
 * the online imagery above Natural Earth II) and the CDN leaves the content security policy.
 *
 * The four folders are copied whole, about 7.8 MB before compression. Picking out individual
 * textures would save a few hundred KB, and the cost of guessing wrong is a 404 when the globe
 * reaches for one.
 *
 * Plain `.mjs` because the apps' Vite configs import it, and Node runs those as JavaScript.
 *
 * @module
 */
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';

/** What Cesium fetches at runtime, relative to `Build/Cesium`. */
const FOLDERS = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

/** Where the files are served from, under the app's base. */
const MOUNT = 'cesium/';

const TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ktx2': 'image/ktx2',
};

/** The installed `cesium` package's built files, resolved from this package's own dependency. */
function cesiumBuildDir() {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');
}

/**
 * @returns {import('vite').Plugin}
 */
export function cesiumAssets() {
  const source = cesiumBuildDir();
  /** @type {string} */
  let base = '/';

  return {
    name: 'we:cesium-assets',

    config(config) {
      // A relative base (`./`, as Tauri builds use) still serves from the root of its own origin,
      // and Cesium resolves this URL against whatever route the app happens to be on, so it has to
      // be absolute.
      base = config.base && config.base.startsWith('/') ? config.base : '/';
      return {
        define: { 'import.meta.env.WE_CESIUM_BASE_URL': JSON.stringify(`${base}${MOUNT}`) },
      };
    },

    configureServer(server) {
      server.middlewares.use(`${base}${MOUNT}`, (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = normalize(join(source, path));
        // Nothing outside the four folders, and nothing outside the package.
        const folder = file.slice(source.length + 1).split(sep)[0];
        if (
          !file.startsWith(source + sep) ||
          !FOLDERS.includes(folder) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          return next();
        }
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },

    writeBundle(options) {
      if (!options.dir) return;
      for (const folder of FOLDERS) {
        cpSync(join(source, folder), join(options.dir, MOUNT, folder), { recursive: true });
      }
    },
  };
}
