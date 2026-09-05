/**
 * Electron Builder Configuration
 *
 * Dynamically loads extraResources from the generated seed configuration.
 * This allows electron-builder to read the build configuration that was
 * generated from we-seed.json by the prebuild script.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the generated extraResources configuration
const extraResourcesPath = join(__dirname, 'electron', 'seed-extra-resources.json');
const extraResources = JSON.parse(readFileSync(extraResourcesPath, 'utf8'));

export default {
  /*
    Product first, runtime second — `io.weco.we.tauri` is the counterpart in tauri.conf.json.

    Both hosts are shipped, so they need identifiers that differ: an identifier is what macOS and
    Windows install *by*, so two apps sharing one cannot be installed side by side. The runtime is
    the qualifier rather than the product because the product is the same product either way — the
    old `io.weco.electron` named only the runtime, and left no room to say which app it was.
  */
  appId: 'io.weco.we.electron',
  // Capitalised, because this is the name a person reads — the window title, the .desktop `Name=`,
  // the macOS bundle. The lowercase spelling is for what a machine reads: `executableName` below,
  // the Rust crate, the `@we/*` scope. Nothing should carry both spellings for the same job.
  productName: 'WE',
  // The same 512x512 mark the Tauri build ships, so the two desktop apps are not
  // two different icons. electron-builder derives every other size from it.
  icon: 'build/icon.png',
  directories: {
    output: 'dist-electron',
  },
  /*
    `files` governs what goes into app.asar, which serves the MAIN PROCESS ONLY. The renderer is
    not in here: `extraResources` copies the Vite bundle to `resources/app/dist`, and main.js loads
    it from `process.resourcesPath` (see `launcherDir`).

    electron-builder additionally packs everything in `dependencies`, and that is where 311 MB of a
    345 MB download came from — Cesium, three, leaflet and the @we packages, shipped twice over: once
    compiled and tree-shaken into the 12 MB bundle that runs, and once as raw npm packages nothing
    can reach. Only 0.2 MB of the asar was reachable from `electron/*.js`.

    So the renderer's libraries live in `devDependencies`, which electron-builder never packs, and
    `dependencies` holds exactly what the main process imports: electron-context-menu, express, uuid.
    Adding a runtime `import` to electron/*.js therefore means moving that package back into
    `dependencies` — otherwise it resolves in dev and is absent from the package.
  */
  files: ['dist/**/*', 'electron/**/*'],
  /*
    `icon` above packages the .desktop entry and the hicolor theme; neither gives a *running window*
    an icon, which on Linux comes from `_NET_WM_ICON` and so from BrowserWindow's own `icon` option.
    That needs the file on disk at runtime, so it is copied in beside the executor and the renderer
    bundle — see `windowIcon()` in electron/main.js, which reads it from `process.resourcesPath`.
  */
  extraResources: [...extraResources, { from: 'build/icon.png', to: 'icon.png' }],
  /*
    Without this the artifact is `WE-0.1.0.AppImage`, naming neither platform nor architecture —
    which stops being merely untidy the moment a second target sits beside it in a release.

    The Tauri host emits the same shape with a `tauri` segment (`WE-0.1.0-tauri-linux-x86_64`),
    written by `apps/we-tauri/scripts/rename-bundle.cjs` because Tauri has no equivalent of this
    template. Electron's carries no qualifier: it is the primary download, and a reader should not
    have to know what a runtime is to pick the right file.
  */
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.social-networking',
  },
  linux: {
    target: ['AppImage'],
    // electron-builder 26 defaults the Linux binary name to the sanitized package
    // name rather than productName, which for a scoped name (@we/app-electron)
    // becomes "@weapp-electron" and is rejected as an unsafe file path.
    executableName: 'we',
    // Name the .desktop entry (and its StartupWMClass) after package.json's
    // desktopName, which is also what Electron reports as its own app_id/WM_CLASS —
    // otherwise a desktop environment cannot link the running window to the launcher.
    syncDesktopName: true,
  },
};
