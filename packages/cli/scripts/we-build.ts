import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { printBuildBanner } from '../src/banner.js';

const green = '\x1b[32m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

// Read package.json
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

// Start timer
const start = process.hrtime.bigint();

// Print banner
await printBuildBanner(pkg);

// Run the local build steps
const child = spawn('pnpm', ['run', 'build:steps'], { stdio: 'inherit' });
await new Promise((resolve, reject) => {
  child.on('close', (code) => {
    if (code === 0) resolve(null);
    else reject(new Error(`Build failed with code ${code}`));
  });
});

// Print success
const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
// console.log(`\n${green}✅ Build complete in ${durationMs.toFixed(0)}ms: ${bold}${pkg.name}${reset}`);
console.log(`\n${green}✅ ${bold}${pkg.name}${reset}${green} built in ${durationMs.toFixed(0)}ms${reset}`);
