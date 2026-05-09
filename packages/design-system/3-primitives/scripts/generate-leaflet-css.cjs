#!/usr/bin/env node
// Regenerates src/primitives/leaflet-css.ts from the installed leaflet package.
// Run after upgrading leaflet: node scripts/generate-leaflet-css.cjs
const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../node_modules/leaflet/dist/leaflet.css');
const outPath = path.resolve(__dirname, '../src/primitives/leaflet-css.ts');

const css = fs.readFileSync(cssPath, 'utf8');
const output = [
  '// Auto-generated from leaflet/dist/leaflet.css — do not edit manually.',
  '// Regenerate by running: node scripts/generate-leaflet-css.cjs',
  `export const leafletCss: string = ${JSON.stringify(css)};`,
  '',
].join('\n');

fs.writeFileSync(outPath, output);
console.log(`[generate-leaflet-css] Written ${output.length} bytes → src/primitives/leaflet-css.ts`);
