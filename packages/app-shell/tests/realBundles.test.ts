/**
 * The bundles checked in under `bundles/` install cleanly: every template is one this app can draw
 * and every record type is a valid definition against WE's own vocabulary.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { judgeBundle } from '@shared/bundles/judgeBundle';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { readBundle } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const dir = resolve(import.meta.dirname, '../../../bundles');
const files = readdirSync(dir).filter((name) => name.endsWith('.bundle.json'));

describe.each(files)('%s', (file) => {
  const read = readBundle(JSON.parse(readFileSync(resolve(dir, file), 'utf-8')));

  it('is a bundle', () => {
    expect(read.problems).toEqual([]);
  });

  it('would install with nothing refused', () => {
    const judged = judgeBundle(read.bundle!, {
      requiredBy: () => [],
      hasModule: () => true,
      moduleInstalled: () => true,
      moduleName: (id) => id,
      knownEntities: Object.keys(CORE_MANIFEST.entities),
    });
    expect(judged.refusals).toEqual([]);
  });
});
