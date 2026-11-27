/**
 * The capability-profile half of `pnpm record` — excluded from the default test projects so `pnpm
 * test` never rewrites vectors. Runs every case on WE's own stores and writes `vectors/profiles.json`.
 *
 * A re-record is a change to the contract another host tests against, so its diff is what a reviewer
 * reads.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { CAPABILITY_PROFILES } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { runProfileCase, worldEntities } from '../../../app-shell/tests/support/profileHost.tsx';
import { PROFILE_CASES, PROFILE_WORLDS, profileWorldEntities } from '../src/cases/profiles';
import { PROFILE_VECTORS_FILE, profileRun, type ProfileVectorFile, profileVectorOf } from '../src/profiles';

describe('record profiles.json', () => {
  it('runs every case and writes the vector file', async () => {
    const cases = [];
    for (const c of PROFILE_CASES) cases.push(profileVectorOf(c, await runProfileCase(profileRun(c, PROFILE_WORLDS))));
    const file: ProfileVectorFile = {
      version: 1,
      profiles: Object.fromEntries(CAPABILITY_PROFILES.map((p) => [p.id, p.version])),
      worlds: PROFILE_WORLDS,
      entities: worldEntities(profileWorldEntities()),
      cases,
    };
    writeFileSync(PROFILE_VECTORS_FILE, JSON.stringify(file, null, 2) + '\n');
    /*
      Formatted as the repository formats JSON, so a re-record's diff is only what changed. Through
      prettier's own command: this project resolves packages for the browser, where prettier is its
      standalone build without the config lookup.
    */
    const prettier = createRequire(PROFILE_VECTORS_FILE).resolve('prettier/bin/prettier.cjs');
    execFileSync(process.execPath, [prettier, '--write', PROFILE_VECTORS_FILE]);
    expect(cases.length).toBe(PROFILE_CASES.length);
  }, 600_000);
});
