/**
 * navigation.json's half of the vectors test: re-run every script through the app-shell recorder
 * (mounted RouteStore + real jsdom history) and compare with the committed expects — here, in the
 * solid project, because the node project resolves solid-js to its SSR build.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type NavigationExpect, runNavigationScript } from '../../../app-shell/tests/support/recordNavigation.ts';
import { NAVIGATION_CASES } from '../src/cases/navigation';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');

interface VectorFile {
  version: number;
  cases: { id: string; note: string; start: string; steps: unknown[]; expect: NavigationExpect[] }[];
}

const committed = JSON.parse(readFileSync(join(VECTORS, 'navigation.json'), 'utf8')) as VectorFile;

describe('navigation vectors re-record to the committed content', () => {
  it('covers every committed case id', () => {
    expect(new Set(NAVIGATION_CASES.map((c) => c.id))).toEqual(new Set(committed.cases.map((c) => c.id)));
  });

  for (const c of committed.cases) {
    it(`${c.id}`, async () => {
      const script = NAVIGATION_CASES.find((s) => s.id === c.id);
      expect(script, `case ${c.id} missing from src/cases/navigation.ts`).toBeTruthy();
      const expect_ = await runNavigationScript({ id: c.id, start: c.start, steps: script!.steps });
      expect(expect_).toEqual(c.expect);
    });
  }
});
