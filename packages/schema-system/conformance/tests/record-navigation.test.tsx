/**
 * The navigation half of `pnpm record` — excluded from the default test projects so `pnpm test`
 * never rewrites vectors. Runs every navigation script through the app-shell recorder and writes
 * `vectors/navigation.json`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runNavigationScript } from '../../../app-shell/tests/support/recordNavigation.ts';
import { NAVIGATION_CASES } from '../src/cases/navigation';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');

describe('record navigation.json', () => {
  it('runs every script and writes the vector file', async () => {
    const cases = [];
    for (const script of NAVIGATION_CASES) {
      const expect_ = await runNavigationScript(script);
      cases.push({
        id: script.id,
        note: script.note,
        schema: script.schema,
        start: script.start,
        steps: script.steps,
        expect: expect_,
      });
    }
    writeFileSync(join(VECTORS, 'navigation.json'), JSON.stringify({ version: 1, cases }, null, 2) + '\n');
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });
});
