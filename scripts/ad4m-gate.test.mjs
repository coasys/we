/**
 * The merge gate's rules, against a stubbed GitHub. Worth pinning because the gate is a required
 * check: one that admitted an ad4m commit not on `dev` merges a WE change onto a `dev` whose ad4m
 * cannot run it, and one that refused a good pin blocks every PR that moves it.
 *
 * `node:test` rather than vitest: root tooling, and the gate's workflow runs these itself.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { judge } from './ad4m-gate.mjs';

const BASE = 'a'.repeat(40);
const ON_DEV = 'b'.repeat(40);
const UNMERGED = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const snapshot = (commit) => ({ kind: 'snapshot', commit });

/** How ad4m's history compares, as GitHub's compare API would say it: `${base}...${head}` → status. */
const COMPARE = {
  [`dev...${ON_DEV}`]: 'behind',
  [`dev...${BASE}`]: 'behind',
  [`dev...${OLD}`]: 'behind',
  [`dev...${UNMERGED}`]: 'diverged',
  [`${BASE}...${ON_DEV}`]: 'ahead',
  [`${BASE}...${OLD}`]: 'behind',
};
const PULLS = { [UNMERGED]: [{ number: 1500, state: 'open', merged_at: null }] };

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url).replace('https://api.github.com/repos/coasys/ad4m/', '').replace(/\?.*$/, '');
    const compare = path.match(/^compare\/(.+)$/);
    if (compare) {
      const status = COMPARE[compare[1]];
      return status ? Response.json({ status }) : new Response('', { status: 404 });
    }
    const pulls = path.match(/^commits\/(\w+)\/pulls$/);
    if (pulls) return Response.json(PULLS[pulls[1]] ?? []);
    throw new Error(`unexpected request: ${url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('into dev', () => {
  it('passes a pin that is on ad4m dev and contains the base pin', async () => {
    const verdict = await judge({ pin: snapshot(ON_DEV), basePin: snapshot(BASE), base: 'dev' });
    assert.equal(verdict.ok, true);
  });

  it('passes the base pin itself without asking GitHub anything', async () => {
    globalThis.fetch = () => assert.fail('asked GitHub');
    assert.equal((await judge({ pin: snapshot(BASE), basePin: snapshot(BASE), base: 'dev' })).ok, true);
  });

  it('refuses a pin not on ad4m dev, naming the ad4m PR', async () => {
    const verdict = await judge({ pin: snapshot(UNMERGED), basePin: snapshot(BASE), base: 'dev' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not on ad4m `dev` yet: c{9} \(coasys\/ad4m#1500\)/);
    assert.equal(verdict.fix, undefined);
  });

  it('refuses a pin behind the base pin, and says how to catch up', async () => {
    const verdict = await judge({ pin: snapshot(OLD), basePin: snapshot(BASE), base: 'dev' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /from a{9} to d{9}, which is older/);
    assert.equal(verdict.fix, 'pnpm bump:ad4m dev');
  });

  it('passes a snapshot on ad4m dev moving off a version, which no dev commit descends from', async () => {
    const verdict = await judge({
      pin: snapshot(ON_DEV),
      basePin: { kind: 'version', version: '0.13.1-staging.2' },
      base: 'dev',
    });
    assert.equal(verdict.ok, true);
  });

  it('still refuses a snapshot not on ad4m dev when the base pins a version', async () => {
    const verdict = await judge({
      pin: snapshot(UNMERGED),
      basePin: { kind: 'version', version: '0.13.1-staging.2' },
      base: 'dev',
    });
    assert.equal(verdict.ok, false);
  });

  it('passes a version pin', async () => {
    globalThis.fetch = () => assert.fail('asked GitHub');
    assert.equal(
      (await judge({ pin: { kind: 'version', version: '0.14.0' }, basePin: snapshot(BASE), base: 'dev' })).ok,
      true,
    );
  });
});

describe('into main', () => {
  it('refuses any snapshot, even one on ad4m dev', async () => {
    const verdict = await judge({
      pin: snapshot(ON_DEV),
      basePin: { kind: 'version', version: '0.13.0' },
      base: 'main',
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /must pin an npm version/);
  });

  it('passes a version', async () => {
    const verdict = await judge({
      pin: { kind: 'version', version: '0.14.0' },
      basePin: { kind: 'version', version: '0.13.0' },
      base: 'main',
    });
    assert.equal(verdict.ok, true);
  });
});
