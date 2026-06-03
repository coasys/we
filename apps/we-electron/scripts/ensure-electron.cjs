#!/usr/bin/env node
/**
 * Ensures the Electron binary is properly installed.
 * electron's own install.js can silently fail on some Linux systems,
 * so this script falls back to extracting the cached zip directly.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let electronDir;
try {
  electronDir = path.dirname(require.resolve('electron/package.json'));
} catch {
  console.log('[ensure-electron] electron package not found, skipping.');
  process.exit(0);
}

const pathTxt = path.join(electronDir, 'path.txt');

if (fs.existsSync(pathTxt)) {
  const binary = path.join(electronDir, 'dist', fs.readFileSync(pathTxt, 'utf-8').trim());
  if (fs.existsSync(binary)) {
    console.log('[ensure-electron] Electron binary already installed.');
    process.exit(0);
  }
}

console.log('[ensure-electron] Electron binary missing — running install.js...');

// Try electron's own install.js first
try {
  execSync(`node "${path.join(electronDir, 'install.js')}"`, {
    stdio: 'inherit',
    cwd: electronDir,
    timeout: 120000,
  });
} catch {
  // ignore — install.js errors are non-fatal, we'll check below
}

if (fs.existsSync(pathTxt)) {
  console.log('[ensure-electron] Electron installed via install.js.');
  process.exit(0);
}

// Fallback: find the cached zip and extract with system unzip
console.log('[ensure-electron] install.js did not create path.txt — trying unzip fallback...');

const { version } = require(path.join(electronDir, 'package.json'));
const platform = process.platform;
const arch = process.arch;
const zipName = `electron-v${version}-${platform}-${arch}.zip`;
const cacheDir = path.join(
  process.env.electron_config_cache || path.join(process.env.HOME || process.env.USERPROFILE, '.cache', 'electron'),
);

// Search for the zip in cache subdirectories
let zipPath = null;
if (fs.existsSync(cacheDir)) {
  for (const sub of fs.readdirSync(cacheDir)) {
    const candidate = path.join(cacheDir, sub, zipName);
    if (fs.existsSync(candidate)) {
      zipPath = candidate;
      break;
    }
  }
}

if (!zipPath) {
  console.error(`[ensure-electron] Cached zip not found in ${cacheDir}. Run pnpm install again with network access.`);
  process.exit(1);
}

const distPath = path.join(electronDir, 'dist');
fs.mkdirSync(distPath, { recursive: true });

console.log(`[ensure-electron] Extracting ${zipPath}...`);
try {
  execSync(`unzip -o "${zipPath}" -d "${distPath}"`, { stdio: 'inherit' });
  fs.writeFileSync(
    pathTxt,
    platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron',
  );
  execSync(`chmod +x "${path.join(distPath, 'electron')}"`, { stdio: 'inherit' });
  console.log('[ensure-electron] Electron installed via unzip fallback.');
} catch (e) {
  console.error('[ensure-electron] Unzip fallback failed:', e.message);
  process.exit(1);
}
