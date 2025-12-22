/**
 * Electron Builder Configuration
 * 
 * Dynamically loads extraResources from the generated seed configuration.
 * This allows electron-builder to read the build configuration that was
 * generated from we-seed.json by the prebuild script.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the generated extraResources configuration
const extraResourcesPath = join(__dirname, 'electron', 'seed-extra-resources.json');
const extraResources = JSON.parse(readFileSync(extraResourcesPath, 'utf8'));

export default {
  appId: 'io.weco.electron',
  productName: 'WE',
  directories: {
    output: 'dist-electron'
  },
  files: [
    'dist/**/*',
    'electron/**/*'
  ],
  extraResources,
  mac: {
    category: 'public.app-category.social-networking'
  },
  linux: {
    target: ['AppImage']
  }
};
