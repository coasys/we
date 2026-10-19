/**
 * The merge gate's rules, against a stubbed GitHub. Worth pinning because the gate is a required
 * check: one that admitted an ad4m commit not on `dev` merges a WE change onto a `dev` whose ad4m
 * cannot run it, and one that refused a good pin blocks every PR that moves it.
 *
 * `node:test` rather than vitest: root tooling, and the gate's workflow runs these itself.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { judge, movedOn, setWaitingLabel, WAITING_LABEL } from './ad4m-gate.mjs';

const BASE = 'a'.repeat(40);
const ON_DEV = 'b'.repeat(40);
const UNMERGED = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
/** Commits two npm versions were published from: one after `dev` reached BASE, one before. */
const RELEASED = 'e'.repeat(40);
const STALE = 'f'.repeat(40);
const HEAD = '1'.repeat(40);
const VERSIONS = { '0.14.0': RELEASED, '0.13.9': STALE };
const snapshot = (commit) => ({ kind: 'snapshot', commit });

/** How ad4m's history compares, as GitHub's compare API would say it: `${base}...${head}` → status. */
const COMPARE = {
  [`dev...${ON_DEV}`]: 'behind',
  [`dev...${BASE}`]: 'behind',
  [`dev...${OLD}`]: 'behind',
  [`dev...${UNMERGED}`]: 'diverged',
  [`${BASE}...${ON_DEV}`]: 'ahead',
  [`${BASE}...${OLD}`]: 'behind',
  [`${BASE}...${RELEASED}`]: 'ahead',
  [`${BASE}...${STALE}`]: 'diverged',
};
/** `${base}...${head}` → commits ahead, for `movedOn`. */
const AHEAD = { [`${UNMERGED}...${HEAD}`]: 3 };
const PULLS = { [UNMERGED]: [{ number: 1500, state: 'open', merged_at: null }] };

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const npm = String(url).match(/^https:\/\/registry\.npmjs\.org\/@coasys%2fad4m\/(.+)$/);
    if (npm) return VERSIONS[npm[1]] ? Response.json({ gitHead: VERSIONS[npm[1]] }) : new Response('', { status: 404 });
    const path = String(url).replace('https://api.github.com/repos/coasys/ad4m/', '').replace(/\?.*$/, '');
    const compare = path.match(/^compare\/(.+)$/);
    if (compare) {
      if (AHEAD[compare[1]] !== undefined) return Response.json({ ahead_by: AHEAD[compare[1]] });
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
    assert.equal(verdict.waiting, true);
  });

  it('refuses a pin behind the base pin, and says how to catch up', async () => {
    const verdict = await judge({ pin: snapshot(OLD), basePin: snapshot(BASE), base: 'dev' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.waiting, undefined, 'behind is not waiting on an ad4m change');
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

  it('passes a version that contains the snapshot it replaces', async () => {
    const verdict = await judge({ pin: { kind: 'version', version: '0.14.0' }, basePin: snapshot(BASE), base: 'dev' });
    assert.equal(verdict.ok, true);
  });

  it('refuses a version missing the snapshot it replaces, which would release an older ad4m', async () => {
    const verdict = await judge({ pin: { kind: 'version', version: '0.13.9' }, basePin: snapshot(BASE), base: 'dev' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /does not contain it/);
    assert.equal(verdict.fix, 'pnpm bump:ad4m staging');
  });

  it('passes a version replacing a version without asking anything', async () => {
    globalThis.fetch = () => assert.fail('asked GitHub');
    const verdict = await judge({
      pin: { kind: 'version', version: '0.14.0' },
      basePin: { kind: 'version', version: '0.13.0' },
      base: 'dev',
    });
    assert.equal(verdict.ok, true);
  });
});

describe('an ad4m PR that has moved past the pin', () => {
  const open = { number: 1500, state: 'open', head: { sha: HEAD } };

  it('says how many commits the pin is behind its head', async () => {
    assert.deepEqual(await movedOn(UNMERGED, open), { pr: open, ahead: 3 });
  });

  it('says nothing when the pin is its head', async () => {
    globalThis.fetch = () => assert.fail('asked GitHub');
    assert.equal(await movedOn(HEAD, open), undefined);
  });

  it('says nothing about a merged PR, which the merge rules handle', async () => {
    globalThis.fetch = () => assert.fail('asked GitHub');
    assert.equal(await movedOn(UNMERGED, { ...open, state: 'closed' }), undefined);
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

describe('the waiting-on-ad4m label', () => {
  /** The requests a call makes, as `METHOD path`, answering a PATCH with `patchAnswer`. */
  async function writes(labels, waiting, patchAnswer = {}) {
    const made = [];
    await setWaitingLabel('coasys/we', 7, labels, waiting, async (_, path, options = {}) => {
      made.push(`${options.method ?? 'GET'} ${path}`);
      return options.method === 'PATCH' ? patchAnswer : {};
    });
    return made;
  }
  const name = encodeURIComponent(WAITING_LABEL.name);

  it('writes nothing when the PR already says the right thing', async () => {
    assert.deepEqual(await writes([WAITING_LABEL.name], true), []);
    assert.deepEqual(await writes(['stacked'], false), []);
  });

  it('adds it to a waiting PR, defining the label first', async () => {
    assert.deepEqual(await writes([], true), [
      `PATCH repos/coasys/we/labels/${name}`,
      'POST repos/coasys/we/issues/7/labels',
    ]);
  });

  it('creates the label the first time, when there is nothing to update', async () => {
    assert.deepEqual(await writes([], true, null), [
      `PATCH repos/coasys/we/labels/${name}`,
      'POST repos/coasys/we/labels',
      'POST repos/coasys/we/issues/7/labels',
    ]);
  });

  it('takes it off a PR that is no longer waiting', async () => {
    assert.deepEqual(await writes([WAITING_LABEL.name], false), [`DELETE repos/coasys/we/issues/7/labels/${name}`]);
  });
});
