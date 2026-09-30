#!/usr/bin/env node
// Regenerates src/primitives/leaflet-css.ts from the installed leaflet package.
// Run after upgrading leaflet: node scripts/generate-leaflet-css.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { format, resolveConfig } from 'prettier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cssPath = path.resolve(__dirname, '../node_modules/leaflet/dist/leaflet.css');
const outPath = path.resolve(__dirname, '../src/primitives/leaflet-css.ts');

const css = fs.readFileSync(cssPath, 'utf8');
const raw = [
  '// Auto-generated from leaflet/dist/leaflet.css — do not edit manually.',
  '// Regenerate by running: node scripts/generate-leaflet-css.mjs',
  `export const leafletCss: string = ${JSON.stringify(css)};`,
  '',
].join('\n');

// Raw JSON.stringify output doesn't match the repo's Prettier config (quote
// style, etc.), so format before writing to avoid spurious diffs on rerun.
const config = await resolveConfig(outPath);
const output = await format(raw, { ...config, filepath: outPath });

fs.writeFileSync(outPath, output);
console.log(`[generate-leaflet-css] Written ${output.length} bytes → src/primitives/leaflet-css.ts`);
