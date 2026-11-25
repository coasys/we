import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderProfileSpec } from '../src/profiles/spec';

const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/spec/profiles');

/*
  The build regenerates these, and CI fails on a tracked file the build changed. This says the same
  thing sooner, in the package's own tests, and names the command.
*/
describe('the profiles spec listing', () => {
  const { json, markdown } = renderProfileSpec();

  it.each([
    ['profiles.json', json],
    ['members.md', markdown],
  ])('%s is what the definitions print — run pnpm --filter @we/schema-shared generate:profiles', (file, expected) => {
    expect(readFileSync(resolve(specDir, file), 'utf-8')).toBe(expected);
  });
});
