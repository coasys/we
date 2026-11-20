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

/**
 * Fill a form and prove the values stayed. The projects modal's drafts live in `$localState` on
 * its `we-modal` node, and the first seconds of the app are a render storm — seed, themes,
 * templates and profile all land then, and the ones that rebuild the overlay subtree remount the
 * modal and empty the drafts. A click taken in that window lands on a button that just went
 * `disabled` and the gesture dies with it. The drafts surviving a beat is the only signal the
 * storm has passed; a fill that did not hold is done again.
 */
async function fillHeld(fields, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const [locator, value] of fields) await locator.fill(value);
    await new Promise((resolve) => setTimeout(resolve, 500));
    let held = true;
    for (const [locator, value] of fields) {
      if ((await locator.inputValue().catch(() => '')) !== value) held = false;
    }
    if (held) return;
    if (Date.now() > deadline) throw new Error('the form fields did not hold their values');
  }
}

/**
 * The first-run name prompt, answered for the rig's fresh account — where it always comes.
 *
 * `dismissNamePrompt` is a single read of the page: the prompt mounts a beat after the app shell
 * answers, so a fast pass sees no field and leaves the modal to intercept the next click (the
 * "Acorn projects" rail button lost pointer events to exactly that `<we-modal>`). Here the
 * prompt is waited for — not polled once — and the suite waits for the modal to be gone before
 * driving the page further.
 */
async function answerNamePrompt(page, name) {
  const field = page.getByRole('textbox', { name: 'Name...', exact: true });
  const appeared = await field.waitFor({ state: 'visible', timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  if (appeared) {
    await field.fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await field.waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  }
  const later = page.getByRole('button', { name: 'Not now' });
  if (await later.count()) await later.first().click();
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
      await answerNamePrompt(page, 'Acorn Dev');

      await openProjectsModal(page);
      await fillHeld([
        [page.getByRole('textbox', { name: 'What the project is called' }), name],
        [page.getByRole('textbox', { name: 'A few words they will type back' }), passphrase],
      ]);
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
    await answerNamePrompt(page, 'Acorn Dev');

    await openProjectsModal(page);
    await fillHeld([[page.getByRole('textbox', { name: 'The words you were given' }), passphrase]]);
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

/*
  S2-3's gate: the outcomes view on the live mount — the seeded outcomes listed by the
  rendered DOM — and the write families back through the real store path. Reads and writes
  both wait out gossip: stock→AD4M is the slow direction on a cold rig, so DOM waits get
  the suite's 300 s; the mount's own writes publish locally first, and the stock reads poll
  until the entry lands in its shard.

  Stock-side the tests speak the rig's own driver (`stock.mjs`) imported straight, not the
  CLI shim — one websocket instead of a process per call. What the zome answers is the
  truth: a write that only changed WE-side perspective links leaves `fetch_outcomes`
  untouched, which is exactly what these tests are for.
*/
describe('the outcomes view on the live mount', () => {
  const SEED_LIST = `VT list ${Date.now().toString(36)}`;
  const SEED_RENAME = `VT rename ${Date.now().toString(36)}`;
  const SEED_RENAMED = `VT renamed ${Date.now().toString(36)}`;
  const SEED_CLEAR = `VT clear ${Date.now().toString(36)}`;
  const SEED_DESC = 'a description the UI will clear';
  const SEED_TAG = `VT tag ${Date.now().toString(36)}`;
  const SEED_DELETE = `VT delete ${Date.now().toString(36)}`;
  const SEED_TAG_TEXT = `vt-rig-tag-${Date.now().toString(36)}`;
  const CREATE_CONTENT = `VT create ${Date.now().toString(36)}`;

  let stockMod;
  let stockH;
  let page;

  /** `fetch_outcomes` on the rig's setup cell — WireRecords `{actionHash, entry}`. */
  const fetchOutcomes = () =>
    stockMod.stockCall(stockH, 'projects', 'fetch_outcomes', { input: { All: null }, local: true });
  const findByContent = (content) => async () => (await fetchOutcomes()).find((r) => r.entry?.content === content);

  before(async () => {
    stockMod = await import(rigFile('stock.mjs'));
    stockH = await stockMod.connect();
    // One seeded outcome per write family, plus a tag for the collection write — all
    // stock-side, so the tests do not lean on the create path they also prove.
    await stockMod.createOutcome(stockH, SEED_LIST);
    await stockMod.createOutcome(stockH, SEED_RENAME);
    await stockMod.createOutcome(stockH, SEED_CLEAR, { description: SEED_DESC });
    await stockMod.createOutcome(stockH, SEED_TAG);
    await stockMod.createOutcome(stockH, SEED_DELETE);
    await stockMod.createTag(stockH, SEED_TAG_TEXT);

    // Open the project the join test mounted — by route, which is the same place the
    // modal's "Open" lands; the dataset persists on the executor for the suite's life.
    const joined = await datasetNamed('Acorn project');
    page = await tab('outcomes');
    await page.goto(app.url);
    await answerNamePrompt(page, 'Acorn Dev');
    await page.goto(`${app.url}/space/${joined.uuid}`);
    await page.waitForURL(/\/space\//, { timeout: 300_000 });
  });

  after(async () => {
    if (stockH) await stockMod.closeStock(stockH).catch(() => {});
  });

  it('live outcomes listed — the seeded content is on screen, un-navigated', async () => {
    // The landing view is the outcomes list because the space's enabledViews says so —
    // no nav click; the textbox named by the content is the row's own edit field. Exact:
    // the row's notes field is named "Notes: <content>" and a loose name matches both.
    const input = page.getByRole('textbox', { name: SEED_LIST, exact: true });
    await input.waitFor({ state: 'visible', timeout: 300_000 });
  });

  /*
    Every write family is skipped, not deleted — they are the step's acceptance gate and they
    unskip the moment the pin moves. All were reproduced against this rig both through the UI
    and through a `fromSHACL`-built `Ad4mModel` in Node, on the pinned `@coasys/ad4m@667d43e`
    (a9 head) + a9 executor (c9d4a8de1):

    - `Entity.create` → `save()`'s create path wraps itself in a batch when none is given, and
      `createSubject` inside a batch is refused: `call actions cannot run inside a batch` (500).
    - `Entity.update` / `updateRecordField` → `save()` → `innerUpdate` → `setProperty` →
      `executeAction` → `perspective.executeCommands`: a mounted setter is a `call` action and
      `execute_commands` answers `internal: call action reached execute_commands` — the
      `update_subject` RPC that *does* dispatch calls is gated to abstract classes on this SDK.
      `innerUpdate` also skips `""` scalars outright, so empty-clear cannot express itself.
    - `Entity.delete` → `removeSubject` → concrete class → `getActionsFromSHACL` +
      `executeAction` → the same `internal: call action reached execute_commands` (500).

    The fix is S2-0's combined build (`acorn/s2-sdk`: `perspective.instance*` RPCs + the
    `Ad4mModel` dispatch), which does not exist on this box — no branch, no rebuilt executor,
    no pkg.pr.new snapshot. The executor-side calls are proven by direct RPC: `createSubject`
    and `updateSubject` with PLAIN values reach stock in seconds; the SDK never routes a
    concrete mounted class to them, and its `{action,value}` dispatch envelopes marshal as the
    value itself where it does.

    A separate WE-side gap sat on top and is fixed on this branch: `record.*` actions resolved
    entity classes through the global registry only, so a per-dataset model (a mounted
    language's vocabulary) threw "Model not found in registry" before reaching the SDK —
    `recordModel` now takes the dataset like `entityClass` does. Without it the create test
    would fail one step earlier, on every pin.
  */
  const WRITE_GAP =
    'model writes on mounted classes die in the pinned a9 SDK — create: "call actions cannot ' +
    'run inside a batch"; update/delete: "internal: call action reached execute_commands". ' +
    'Needs the S2-0 combined build (acorn/s2-sdk executor + SDK snapshot), never produced';

  it('create writes through', async () => {
    await page.getByRole('textbox', { name: /New outcome/ }).fill(CREATE_CONTENT);
    await page.getByRole('button', { name: 'Add outcome', exact: true }).click();
    await h.until(findByContent(CREATE_CONTENT), (r) => Boolean(r), {
      timeout: 120_000,
      what: `stock fetch_outcomes to show "${CREATE_CONTENT}"`,
    });
  });

  it('rename writes through', async () => {
    const input = page.getByRole('textbox', { name: SEED_RENAME, exact: true });
    await input.waitFor({ state: 'visible', timeout: 120_000 });
    await input.fill(SEED_RENAMED);
    await input.press('Enter');
    await input.blur();
    await h.until(findByContent(SEED_RENAMED), (r) => Boolean(r), {
      timeout: 120_000,
      what: `stock fetch_outcomes to show "${SEED_RENAMED}" — rename reaches stock`,
    });
  });

  it('empty clear writes through', async () => {
    const input = page.getByRole('textbox', { name: `Notes: ${SEED_CLEAR}` });
    await input.waitFor({ state: 'visible', timeout: 120_000 });
    await input.fill('');
    await input.press('Enter');
    await input.blur();
    await h.until(
      async () => (await fetchOutcomes()).find((r) => r.entry?.content === SEED_CLEAR),
      (r) => r !== undefined && !r.entry?.description,
      {
        timeout: 120_000,
        what: `stock fetch_outcomes to show "${SEED_CLEAR}" with no description`,
      },
    );
  });

  it('collection replace writes through', async () => {
    await page.getByRole('button', { name: `Tag ${SEED_TAG_TEXT} → ${SEED_TAG}` }).click({ timeout: 120_000 });
    await h.until(
      async () => (await fetchOutcomes()).find((r) => r.entry?.content === SEED_TAG),
      (r) => Array.isArray(r?.entry?.tags) && r.entry.tags.length === 1,
      { timeout: 120_000, what: `stock to show "${SEED_TAG}" carrying exactly the new tag` },
    );
    await page.getByRole('button', { name: `Untag ${SEED_TAG}` }).click();
    await h.until(
      async () => (await fetchOutcomes()).find((r) => r.entry?.content === SEED_TAG),
      (r) => Array.isArray(r?.entry?.tags) && r.entry.tags.length === 0,
      { timeout: 120_000, what: `stock to show "${SEED_TAG}" with an empty tag list` },
    );
  });

  it('delete writes through', async () => {
    await page.getByRole('button', { name: `Delete ${SEED_DELETE}` }).click({ timeout: 120_000 });
    // The host's own confirm — the only "are you sure" a space action gets.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await h.until(fetchOutcomes, (rows) => !rows.some((r) => r.entry?.content === SEED_DELETE), {
      timeout: 120_000,
      what: `stock fetch_outcomes to drop "${SEED_DELETE}"`,
    });
  });
});
