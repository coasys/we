/**
 * web We on the Acorn rig: a signed-in agent creates an Acorn project and joins the one the
 * stock side holds, each time through the sidebar's "Acorn projects" dialog — and the executor
 * then shows what design §L.4 promises: the project language mounted on the dataset, the space
 * carrying `defaultTemplateId: 'acorn'`, and the project's own records crossing the DHT to the
 * stock conductor (and back).
 *
 * The rig is the same one the acorn-ad4m tests stand on — a kitsune bootstrap, a plain Holochain
 * conductor running the Acorn DNA's clone cell, and the a9 executor — started by `rig/start.sh`
 * before this file runs (the acceptance commands in the brief). This test starts none of that; it
 * finds the rig through `rig/.run/env`, as the rig's own drivers do (`envfile.mjs`), and drives its
 * executor through `ad4m.mjs`'s JSON-RPC socket — the same frames the app's `acornLifecycle` port
 * sends from inside the browser.
 *
 * The web session is a real grant: `agent.requestCapability` → `permitCapability` (the loopback
 * socket is the operator on the rig's credential-less executor) → `generateJwt`, stored where
 * ad4m-connect reads it by `harness.mjs`'s `device`. Every UI step is a click or a field — the
 * only shortcuts are the ones the browser cannot take: installing the base language bundle into
 * the executor's language store, and reading the stock conductor's cell.
 *
 *   AD4M_EXECUTOR=/home/data/code/ad4m-acorn-target/release/ad4m-executor \
 *     /home/data/code/acorn-ad4m/rig/start.sh
 *   node --test apps/we-web/tests/live/acorn.live.mjs
 *   /home/data/code/acorn-ad4m/rig/stop.sh
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';

import * as h from './harness.mjs';
import { dismissNamePrompt } from './space.mjs';

const exec = promisify(execFile);

/** The rig checkout: `acorn-ad4m/rig`. Overridable for a rig living somewhere else. */
const RIG = process.env.ACORN_RIG ?? '/home/data/code/acorn-ad4m/rig';

const rigFile = (name) => pathToFileURL(join(RIG, name)).href;

/** The rig's own drivers — imported so this test speaks exactly the wire the rig was built for. */
let ad4m;
let env;

/** One stock-side call: `node stock.mjs <args...>` in the rig, its stdout back as text. */
async function stock(args, timeout = 120_000) {
  const { stdout } = await exec(process.execPath, [join(RIG, 'stock.mjs'), ...args], {
    cwd: RIG,
    timeout,
  });
  return stdout.trim();
}

/** The rig's clone-cell seed as the passphrase a person would type (`uid-a-b` → `a b`). */
const passphraseFor = (seed) => seed.replace(/^uid-/, '').split('-').join(' ');

/** `uid-` + the passphrase's words hyphen-joined — `acornSeed`'s twin. */
const seedFor = (passphrase) => `uid-${passphrase.split(' ').join('-')}`;

/**
 * A main-agent grant, minted the way an app's connect flow ends: the request is anonymous, the
 * loopback socket on a credential-less executor answers `permitCapability` as the operator, and
 * `generateJwt` redeems the code once. The same AuthInfo the connector sends.
 */
async function mintToken() {
  const auth = {
    appName: 'WE',
    appDesc: 'Social media for the new internet',
    appDomain: 'localhost',
    appUrl: 'ad4m.weco.io',
    appIconPath: 'https://avatars.githubusercontent.com/u/34165012',
    capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
  };
  const requestId = await ad4m.rpc('agent.requestCapability', { authInfo: auth });
  const rand = await ad4m.rpc('agent.permitCapability', {
    auth: JSON.stringify({ requestId, auth }),
  });
  return ad4m.rpc('agent.generateJwt', { requestId, rand });
}

/** The dataset the executor holds under `name`, once it exists. */
function datasetNamed(name) {
  return h.until(async () => (await ad4m.rpc('perspective.all', {})).find((p) => p.name === name), Boolean, {
    timeout: 120_000,
    what: `a perspective named "${name}"`,
  });
}

/**
 * What §L.4 leaves behind on the executor: the mount, and the space's acorn template flag.
 * Polled, not read once — the route lands on `/space/…` when `switchDataset` makes the dataset
 * current, while init and the template write are still running behind it.
 */
async function assertMountedAcornSpace(dataset, name) {
  const { mounts, target } = await h.until(
    async () => {
      const [mounts, templateLinks] = await Promise.all([
        ad4m.rpc('perspective.mounts', { uuid: dataset.uuid }),
        ad4m.rpc('perspective.queryLinks', { uuid: dataset.uuid, predicate: 'we://default_template_id' }),
      ]);
      return { mounts, target: templateLinks[0]?.data?.target };
    },
    // The model layer literal-encodes scalar targets: 'acorn' rides as literal:string:acorn.
    (r) => r.mounts.length === 1 && r.target === 'literal:string:acorn',
    { timeout: 120_000, what: `${name}: one mounted language + default_template_id 'acorn'` },
  );
  return mounts[0];
}

/** The rail's "Acorn projects" row → the modal — the only door the chrome has. */
async function openProjectsModal(page) {
  await page.getByRole('button', { name: 'Acorn projects', exact: true }).click({ timeout: 120_000 });
}

let app;
let browser;
let device;
const pages = [];

before(async () => {
  assert.ok(
    existsSync(join(RIG, '.run', 'env')),
    `no rig env at ${join(RIG, '.run', 'env')} — run ${join(RIG, 'start.sh')} first`,
  );
  const envfile = await import(rigFile('envfile.mjs'));
  ad4m = await import(rigFile('ad4m.mjs'));
  env = envfile.rigEnv();
  assert.ok(env.AD4M_PORT, 'the rig env names no AD4M_PORT');

  // The bundle the modal's `applyTemplateLocal` templates from — into the executor's store the
  // way the rig tests install it (`publishLocal` is the local-publish path, meta and all).
  const base = ad4m.publishLocal(join(RIG, '..', 'language', 'build', 'bundle.js'));
  assert.ok(base.startsWith('Qmz'), `unexpected base language address: ${base}`);

  const url = `http://127.0.0.1:${env.AD4M_PORT}`;
  const token = await mintToken();
  app = await h.serveApp();
  browser = await h.launchBrowser();
  device = await h.device(browser, { url }, { token, email: 'acorn@rig' }, { name: 'acorn' });
});

after(async () => {
  for (const page of pages) await page.close().catch(() => {});
  await device?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await app?.close();
  ad4m?.close();
});

async function tab(label) {
  const page = await device.tab(label);
  pages.push(page);
  return page;
}

describe('web We on the Acorn rig', () => {
  it('creates a project the stock side can join', async () => {
    const name = `Rig created ${Date.now().toString(36)}`;
    const passphrase = `rig created ${Date.now().toString(36)}`;
    const page = await tab('create');
    try {
      await page.goto(app.url);
      await dismissNamePrompt(page, 'Acorn Dev');

      await openProjectsModal(page);
      await page.getByRole('textbox', { name: 'What the project is called' }).fill(name);
      await page.getByRole('textbox', { name: 'A few words they will type back' }).fill(passphrase);
      await page.getByRole('button', { name: 'Create project' }).click();

      // Mount → init → template → land: the modal closes and the route is the space's.
      await page.waitForURL(/\/space\//, { timeout: 300_000 });
    } catch (e) {
      console.log(
        '--- body text ---\n' +
          (await page
            .locator('body')
            .innerText()
            .catch(() => '<unreadable>')),
      );
      console.log('--- device logs ---\n' + device.logs.slice(-40).join('\n'));
      throw e;
    }

    const dataset = await datasetNamed(name);
    await assertMountedAcornSpace(dataset, name);

    // The proof it is a real project and not only a local perspective: the stock conductor
    // clones the cell by the same network seed and reads the meta web We wrote. The zome
    // call answers the record ({ actionHash, entry }), so the name is read off `entry`.
    await stock(['join', seedFor(passphrase)], 300_000);
    await h.until(
      async () => JSON.parse(await stock(['fetch', 'fetch_project_meta'])),
      (meta) => meta?.entry?.name === name,
      { timeout: 300_000, what: `the stock side to see "${name}"'s project meta` },
    );
  });

  it('joins the stock project by passphrase', async () => {
    const passphrase = passphraseFor(env.SEED || 'uid-rig-test-project');
    const page = await tab('join');
    await page.goto(app.url);
    await dismissNamePrompt(page, 'Acorn Dev');

    await openProjectsModal(page);
    await page.getByRole('textbox', { name: 'The words you were given' }).fill(passphrase);
    await page.getByRole('button', { name: 'Join project' }).click();

    await page.waitForURL(/\/space\//, { timeout: 300_000 });

    const dataset = await datasetNamed('Acorn project');
    await assertMountedAcornSpace(dataset, 'Acorn project');

    // Membership crosses the DHT: the stock cell's agent list picks up the profile the join
    // wrote, next to the rig's own "Stock Rig" — eventually, as gossip does.
    await h.until(
      async () => JSON.parse(await stock(['fetch', 'fetch_agents', '--setup'])),
      (agents) =>
        Array.isArray(agents) &&
        agents.length >= 2 &&
        agents.some((a) => (a.entry?.firstName ?? a.firstName ?? '').startsWith('Acorn')),
      { timeout: 300_000, what: 'the web agent in the stock cell’s member list' },
    );
  });
});
