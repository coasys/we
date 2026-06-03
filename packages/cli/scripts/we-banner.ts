import { readFile } from 'node:fs/promises';

import { printBuildBanner } from '../src/banner.js';

// Read package.json
const pkg = JSON.parse(await readFile('package.json', 'utf8'));

// Print banner
await printBuildBanner(pkg);
