/**
 * The drift check of design §2's amendment: `@we/acorn-fixture`'s Acorn vocabulary must be
 * what a live executor *discovers* — the foreign SHACL the mount leaves behind, run through
 * `perspectiveHelpers.getForeignShacl` + `buildEntityManifest`, the same synthesis the app
 * builds its runtime models from. The hand-written manifest is the thing being checked,
 * never the source of truth.
 *
 * It runs only with the acorn rig up (`ACORN_RIG`, or the default checkout holding
 * `rig/.run/env`); without one there is no mount to ask and the suite skips. It is not the
 * fixture's render tests — those live beside the module under `packages/module-system`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Ad4mClient } from '@coasys/ad4m';
import { describe, expect, it } from 'vitest';

import { buildEntityManifest, getForeignShacl } from '../../../backend-system/ad4m/src/perspectiveHelpers.ts';
import { ACORN_MANIFEST } from '../src/index.ts';

const RIG = process.env.ACORN_RIG ?? '/home/data/code/acorn-ad4m/rig';
const rigFile = (name: string) => pathToFileURL(join(RIG, name)).href;
const ENV_PATH = join(RIG, '.run', 'env');

/** The rig's own main-agent grant, minted the way the live test's is — operator on a loopback executor. */
async function mintToken(ad4m: { rpc: (method: string, params?: object) => Promise<unknown> }): Promise<string> {
  const auth = {
    appName: 'WE',
    appDesc: 'Social media for the new internet',
    appDomain: 'localhost',
    appUrl: 'ad4m.weco.io',
    appIconPath: 'https://avatars.githubusercontent.com/u/34165012',
    capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
  };
  const requestId = (await ad4m.rpc('agent.requestCapability', { authInfo: auth })) as string;
  const rand = (await ad4m.rpc('agent.permitCapability', {
    auth: JSON.stringify({ requestId, auth }),
  })) as string;
  return (await ad4m.rpc('agent.generateJwt', { requestId, rand })) as string;
}

describe('the acorn fixture against the mount’s discovered manifest', () => {
  it('declares what the mounted language actually declares', async (t) => {
    if (!existsSync(ENV_PATH)) {
      t.skip(`no rig env at ${ENV_PATH} — start rig/start.sh first`);
      return;
    }
    const envfile = await import(rigFile('envfile.mjs'));
    const ad4m = await import(rigFile('ad4m.mjs'));
    const env = envfile.rigEnv() as Record<string, string>;

    let client: Ad4mClient;
    try {
      client = new Ad4mClient(`http://127.0.0.1:${env.AD4M_PORT}`, await mintToken(ad4m));
      // One round trip is the reachability proof — a stale .run/env fails here, not later.
      await client.perspective.all();
    } catch (error) {
      t.skip(`rig at 127.0.0.1:${env.AD4M_PORT} unreachable — start rig/start.sh first (${String(error)})`);
      return;
    }

    // The mounted dataset is the one holding Acorn's shapes — WE's own spaces never do.
    const mounted = [];
    for (const proxy of await client.perspective.all()) {
      const names = await proxy.getShaclNames().catch(() => [] as string[]);
      if (names.includes('AcornOutcome')) mounted.push(proxy);
    }
    expect(
      mounted.length,
      'no dataset on the executor carries the Acorn shapes — is a project mounted?',
    ).toBeGreaterThan(0);

    // The truth: the foreign-SHACL read the app's own model synthesis performs.
    const discovered = buildEntityManifest(await getForeignShacl(mounted[0]));
    const byName = new Map(discovered.map((entry) => [entry.name, entry]));

    // Every fixture entity is a class the mount really declares.
    const fixtureNames = Object.keys(ACORN_MANIFEST.entities).filter((name) => name.startsWith('Acorn'));
    for (const name of fixtureNames) {
      expect(byName.has(name), `mount declares no "${name}" — the fixture drifted ahead of the language`).toBe(true);
    }

    // Field-level, on the class the step writes: every fixture field is a shape property,
    // with collection and writability answering the same way the fixture promises.
    const outcome = byName.get('AcornOutcome');
    expect(outcome, 'mount declares no AcornOutcome').toBeDefined();
    const discoveredFields = new Map((outcome?.properties ?? []).map((p) => [p.name, p]));
    const fixtureOutcome = ACORN_MANIFEST.entities.AcornOutcome;
    for (const field of [
      ...Object.keys(fixtureOutcome.properties ?? {}),
      ...Object.keys(fixtureOutcome.relations ?? {}),
    ]) {
      expect(discoveredFields.has(field), `mount's AcornOutcome has no "${field}"`).toBe(true);
    }
    expect(discoveredFields.get('content')?.writable).toBe(true);
    expect(discoveredFields.get('description')?.writable).toBe(true);
    expect(discoveredFields.get('tags')?.isCollection).toBe(true);
  });
});
