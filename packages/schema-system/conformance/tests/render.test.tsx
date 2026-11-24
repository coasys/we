/**
 * render.json's half of the vectors test: run every case through the real renderer again and compare
 * with the committed expects — in the solid project, because the node project resolves solid-js to
 * its server build, where effects never run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RENDER_CASES, type RenderCase } from '../src/cases/render';
import { type RenderExpect, runRenderCase } from './support/renderRecorder';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');

const committed = JSON.parse(readFileSync(join(VECTORS, 'render.json'), 'utf8')) as {
  version: number;
  cases: (RenderCase & { expect: RenderExpect[] })[];
};

describe('render vectors re-record to the committed content', () => {
  it('covers every committed case id, and only those', () => {
    expect(RENDER_CASES.map((c) => c.id)).toEqual(committed.cases.map((c) => c.id));
  });

  for (const c of committed.cases) {
    it(c.id, async () => {
      const input = RENDER_CASES.find((r) => r.id === c.id);
      expect(input, `case ${c.id} missing from src/cases/render.ts`).toBeTruthy();
      // The input as committed is the input as written: a changed case is a new id.
      expect(JSON.parse(JSON.stringify({ ...input, expect: c.expect }))).toEqual(c);
      expect(await runRenderCase(input!)).toEqual(c.expect);
    });
  }
});
