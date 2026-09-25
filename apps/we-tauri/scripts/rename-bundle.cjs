#!/usr/bin/env node
/**
 * Rename Tauri's bundle output to the same shape the Electron host emits.
 *
 * Both desktop hosts are shipped, so a release can hold an AppImage from each — and two files
 * called `WE_0.1.0_amd64.AppImage` and `WE-0.1.0-linux-x86_64.AppImage` are the same download
 * as far as a reader can tell. Electron names its artifact from a template
 * (`artifactName` in apps/we-electron/electron-builder.config.js); Tauri has no equivalent, so
 * this does the same job after the fact:
 *
 *     WE_0.1.0_amd64.AppImage  ->  WE-0.1.0-tauri-linux-x86_64.AppImage
 *
 * The `tauri` segment is on this one and not on Electron's deliberately. Electron is the primary
 * download, and somebody choosing a file should not have to know what a runtime is; the qualifier
 * belongs on the variant.
 *
 * Arch names are Electron's spelling rather than Tauri's (`amd64` -> `x86_64`), for the same
 * reason: the two files are read side by side.
 */

const fs = require('fs');
const path = require('path');

/** Tauri's Debian-style arch names to the ones electron-builder writes for an AppImage. */
const ARCH = { amd64: 'x86_64', i386: 'i386', arm64: 'arm64', armhf: 'armv7l' };

/** Must match `productName` in src-tauri/tauri.conf.json — this is the display spelling. */
const PRODUCT = 'WE';

const BUNDLE_DIR = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle');

/**
 * Tauri writes `<productName>_<version>_<arch>.<ext>`. Parsed rather than assembled from the
 * config because the version comes from package.json via tauri.conf.json and the arch from
 * whatever host built it — reading them off the filename is the one place both are already known.
 */
function parse(name) {
  const match = /^(.+)_([^_]+)_([^_]+)\.AppImage$/.exec(name);
  if (!match) return null;
  const [, , version, arch] = match;
  return { version, arch: ARCH[arch] ?? arch };
}

function renameIn(dir) {
  if (!fs.existsSync(dir)) return [];

  const renamed = [];
  for (const entry of fs.readdirSync(dir)) {
    const parsed = parse(entry);
    if (!parsed) continue;

    const target = `${PRODUCT}-${parsed.version}-tauri-linux-${parsed.arch}.AppImage`;
    if (entry === target) continue;

    // Sidecars (`.AppImage.sig`, `.AppImage.tar.gz`) appear once the updater is configured, and
    // they are matched to the AppImage by name — so they move with it or they stop resolving.
    for (const sidecar of fs.readdirSync(dir)) {
      if (!sidecar.startsWith(`${entry}.`)) continue;
      fs.renameSync(path.join(dir, sidecar), path.join(dir, target + sidecar.slice(entry.length)));
    }

    fs.renameSync(path.join(dir, entry), path.join(dir, target));
    renamed.push(target);
  }
  return renamed;
}

const renamed = renameIn(path.join(BUNDLE_DIR, 'appimage'));

if (renamed.length === 0) {
  // Not an error: `tauri build` has already succeeded by the time this runs (it is the left side
  // of the `&&`), and re-running it leaves everything named correctly with nothing to do.
  console.log('ℹ️  No Tauri bundle to rename — already named, or none was produced.');
} else {
  for (const name of renamed) console.log(`✅ Renamed bundle to ${name}`);
}
