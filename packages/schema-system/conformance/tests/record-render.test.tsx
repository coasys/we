/**
 * The renderer half of `pnpm record` — excluded from the default test projects so `pnpm test` never
 * rewrites vectors. Runs every render case through the real renderer and writes `vectors/render.json`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RENDER_CASES } from '../src/cases/render';
import { runRenderCase } from './support/renderRecorder';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');

describe('record render.json', () => {
  it('runs every case and writes the vector file', async () => {
    const cases = [];
    for (const c of RENDER_CASES) cases.push({ ...c, expect: await runRenderCase(c) });
    writeFileSync(join(VECTORS, 'render.json'), JSON.stringify({ version: 1, cases }, null, 2) + '\n');
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });
});
