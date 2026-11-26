/**
 * render.json's and safety.json's half of the vectors test: run every case through the real renderer again and compare
 * with the committed expects — in the solid project, because the node project resolves solid-js to
 * its server build, where effects never run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RENDER_CASES, type RenderCase } from '../src/cases/render';
import { SAFETY_CASES } from '../src/cases/safety';
import { type RenderExpect, runRenderCase } from './support/renderRecorder';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');

type Committed = { version: number; cases: (RenderCase & { expect: RenderExpect[] })[] };
const load = (name: string) => JSON.parse(readFileSync(join(VECTORS, name), 'utf8')) as Committed;

for (const [name, inputs] of [
  ['render.json', RENDER_CASES],
  ['safety.json', SAFETY_CASES],
] as const) {
  const committed = load(name);
  describe(`${name} re-records to the committed content`, () => {
    it('covers every committed case id, and only those', () => {
      expect(inputs.map((c) => c.id)).toEqual(committed.cases.map((c) => c.id));
    });

    for (const c of committed.cases) {
      it(c.id, async () => {
        const input = inputs.find((r) => r.id === c.id);
        expect(input, `case ${c.id} missing from its cases file`).toBeTruthy();
        // The input as committed is the input as written: a changed case is a new id.
        expect(JSON.parse(JSON.stringify({ ...input, expect: c.expect }))).toEqual(c);
        expect(await runRenderCase(input!)).toEqual(c.expect);
      });
    }
  });
}
