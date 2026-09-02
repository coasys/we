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
  appId: 'io.weco.electron',
  productName: 'WE',
  // The same 512x512 mark the Tauri build ships, so the two desktop apps are not
  // two different icons. electron-builder derives every other size from it.
  icon: 'build/icon.png',
  directories: {
    output: 'dist-electron',
  },
  files: ['dist/**/*', 'electron/**/*'],
  extraResources,
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
