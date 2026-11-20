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
  /** The seeded tag's action hash, as text — what the outcome's `tags` must hold after Tag. */
  let seedTagHash;

  /** A Holochain hash as its `u…` base64url text, whichever form the zome answered in. */
  const hashText = (hash) => (typeof hash === 'string' ? hash : `u${Buffer.from(hash).toString('base64url')}`);

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
    seedTagHash = hashText((await stockMod.createTag(stockH, SEED_TAG_TEXT)).actionHash);

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
    The five write families — S2-3's acceptance gate, skipped on the a9 pin where mounted
    classes could not write at all (`call actions cannot run inside a batch` on create;
    `internal: call action reached execute_commands` on update/delete). On the S2-0 pin
    every one dispatches through `perspective.instance*`, whose mount-aware execution
    answers the declared `call` actions; all five pass against executor `92690f459` and
    the post-35dc46f3 SDK lib. The commit series carries the per-test evidence.
  */

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
      // The tag the button names, not merely a tag: a write of the wrong hash is one tag too.
      (r) => Array.isArray(r?.entry?.tags) && r.entry.tags.length === 1 && hashText(r.entry.tags[0]) === seedTagHash,
      { timeout: 120_000, what: `stock to show "${SEED_TAG}" carrying exactly ${SEED_TAG_TEXT} (${seedTagHash})` },
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

/*
  S2-4's gate: the expanded outcome on the live mount, both directions. An outcome opened from
  the list and edited in its dialog lands on stock as one `update_outcome` — title and
  description together — and a stock-side `update_outcome` redraws the open dialog, because
  the dialog reads its outcome by id through the same subscription the list uses.

  `ACORN_SHOTS=<dir>` also saves the dialog reading and editing, for the step's report.
*/
describe('the expanded outcome on the live mount', () => {
  const tag = Date.now().toString(36);
  const SEED_OPEN = `EO open ${tag}`;
  const EDITED = `EO edited ${tag}`;
  const EDITED_DESC = `A description written in the expanded outcome ${tag}`;
  const SEED_STOCK = `EO stock ${tag}`;
  const STOCK_EDITED = `EO stock-edited ${tag}`;
  const STOCK_DESC = `A description the stock side wrote ${tag}`;
  const SHOTS = process.env.ACORN_SHOTS;

  let stockMod;
  let stockH;
  let page;
  let stockSeed;

  const fetchOutcomes = () =>
    stockMod.stockCall(stockH, 'projects', 'fetch_outcomes', { input: { All: null }, local: true });

  before(async () => {
    stockMod = await import(rigFile('stock.mjs'));
    stockH = await stockMod.connect();
    await stockMod.createOutcome(stockH, SEED_OPEN, { description: 'seeded on the stock side' });
    stockSeed = await stockMod.createOutcome(stockH, SEED_STOCK);

    const joined = await datasetNamed('Acorn project');
    page = await tab('expanded');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(app.url);
    await answerNamePrompt(page, 'Acorn Dev');
    await page.goto(`${app.url}/space/${joined.uuid}`);
    await page.waitForURL(/\/space\//, { timeout: 300_000 });
  });

  after(async () => {
    if (stockH) await stockMod.closeStock(stockH).catch(() => {});
  });

  /** The open dialog — the one `we-modal` the outcome list draws. */
  const dialog = () => page.locator('we-modal');

  it('expanded outcome edit writes through', async () => {
    await page.getByRole('button', { name: `Open ${SEED_OPEN}`, exact: true }).click({ timeout: 300_000 });
    await dialog().getByText('seeded on the stock side').waitFor({ state: 'visible', timeout: 60_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'expanded-outcome-view.png') });

    await dialog().getByRole('button', { name: 'Edit outcome', exact: true }).click();
    await fillHeld([
      [dialog().getByRole('textbox', { name: 'Title' }), EDITED],
      [dialog().getByRole('textbox', { name: 'Description' }), EDITED_DESC],
    ]);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'expanded-outcome-editing.png') });
    await dialog().getByRole('button', { name: 'Save', exact: true }).click();

    await h.until(
      async () => (await fetchOutcomes()).find((r) => r.entry?.content === EDITED),
      (r) => r?.entry?.description === EDITED_DESC,
      { timeout: 120_000, what: `stock fetch_outcomes to show "${EDITED}" with the new description` },
    );
    // Back to reading, drawn from the record the save wrote.
    await dialog().getByRole('button', { name: 'Edit outcome', exact: true }).waitFor({ timeout: 60_000 });
    await dialog().getByText(EDITED_DESC).waitFor({ state: 'visible', timeout: 60_000 });
  });

  it('stock-side edit shows in the expanded outcome', async () => {
    // Close the last dialog and open the stock seed's.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Open ${SEED_STOCK}`, exact: true }).click({ timeout: 300_000 });
    await dialog().getByText('No description').waitFor({ state: 'visible', timeout: 60_000 });

    const current = (await fetchOutcomes()).find((r) => r.entry?.content === SEED_STOCK);
    assert.ok(current, `stock lost "${SEED_STOCK}"`);
    await stockMod.updateOutcome(stockH, stockSeed.actionHash, {
      ...current.entry,
      content: STOCK_EDITED,
      description: STOCK_DESC,
      timestampUpdated: Math.floor(Date.now() / 1000),
    });

    // stock → AD4M is gossip plus the mount's resync: the suite's slow direction.
    await dialog().getByText(STOCK_DESC).waitFor({ state: 'visible', timeout: 300_000 });
    await dialog().getByText(STOCK_EDITED, { exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  });
});

/*
  S2-7's gate: the priority view's order is `AcornProjectMeta.topPriorityOutcomes`, and every
  change to it — add, reorder, remove — is a whole-list replace that stock's project meta must
  show in the same order. The reorder is taken with the keyboard on the row's grip, which is the
  same `reorder` event a drag ends in.
*/
describe('the priority view on the live mount', () => {
  const tag = Date.now().toString(36);
  const P1 = `PV one ${tag}`;
  const P2 = `PV two ${tag}`;

  let stockMod;
  let stockH;
  let page;
  let h1;
  let h2;

  const hashText = (hash) => (typeof hash === 'string' ? hash : `u${Buffer.from(hash).toString('base64url')}`);
  /** Stock's own priority list, as `u…` hash text, in its stored order. */
  const stockPriorities = async () => {
    const meta = await stockMod.stockCall(stockH, 'projects', 'fetch_project_meta', { input: null, local: true });
    return (meta?.entry?.topPriorityOutcomes ?? []).map(hashText);
  };
  /** Ours only — other suites' outcomes may be on the list too. */
  const ours = (list) => list.filter((x) => x === h1 || x === h2);

  before(async () => {
    stockMod = await import(rigFile('stock.mjs'));
    stockH = await stockMod.connect();
    h1 = hashText((await stockMod.createOutcome(stockH, P1)).actionHash);
    h2 = hashText((await stockMod.createOutcome(stockH, P2)).actionHash);

    const joined = await datasetNamed('Acorn project');
    page = await tab('priority');
    await page.goto(app.url);
    await answerNamePrompt(page, 'Acorn Dev');
    await page.goto(`${app.url}/space/${joined.uuid}`);
    await page.waitForURL(/\/space\//, { timeout: 300_000 });
    await page.getByRole('button', { name: 'Priority', exact: true }).click({ timeout: 300_000 });
  });

  after(async () => {
    if (stockH) await stockMod.closeStock(stockH).catch(() => {});
  });

  it('prioritise writes through, in order', async () => {
    await page.getByRole('button', { name: `Prioritise ${P1}`, exact: true }).click({ timeout: 300_000 });
    await h.until(stockPriorities, (list) => ours(list).join() === [h1].join(), {
      timeout: 120_000,
      what: `stock topPriorityOutcomes to hold "${P1}"`,
    });
    await page.getByRole('button', { name: `Prioritise ${P2}`, exact: true }).click({ timeout: 120_000 });
    await h.until(stockPriorities, (list) => ours(list).join() === [h1, h2].join(), {
      timeout: 120_000,
      what: `stock topPriorityOutcomes to hold "${P1}", "${P2}" in that order`,
    });
  });

  it('reorder writes through', async () => {
    const grip = page.getByRole('button', { name: `Reorder ${P2}`, exact: true });
    await grip.waitFor({ state: 'visible', timeout: 120_000 });
    await grip.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
    await h.until(stockPriorities, (list) => ours(list).join() === [h2, h1].join(), {
      timeout: 120_000,
      what: `stock topPriorityOutcomes to hold "${P2}" before "${P1}"`,
    });
  });

  it('remove writes through', async () => {
    await page.getByRole('button', { name: `Remove ${P2} from priority`, exact: true }).click({ timeout: 120_000 });
    await h.until(stockPriorities, (list) => ours(list).join() === [h1].join(), {
      timeout: 120_000,
      what: `stock topPriorityOutcomes to drop "${P2}" and keep "${P1}"`,
    });
    await page.getByRole('button', { name: `Prioritise ${P2}`, exact: true }).waitFor({ timeout: 120_000 });
  });
});

/*
  S2-5: the expanded outcome's children, task list and comments. Each write the dialog makes —
  a child (an outcome plus the connection naming its parent), a task added, ticked and removed
  (whole-list replaces of the Small scope's `taskList`), a comment — must reach stock's own
  fetches; and what the stock side writes (a child under the outcome, a comment) must show in the
  open dialog.
*/
describe('children, tasks and comments on the live mount', () => {
  const tag = Date.now().toString(36);
  const PARENT = `CT parent ${tag}`;
  const STOCK_CHILD = `CT stock child ${tag}`;
  const WE_CHILD = `CT we child ${tag}`;
  const SMALL = `CT small ${tag}`;
  const TASK = `CT task ${tag}`;
  const SECOND_TASK = `CT second task ${tag}`;
  const WE_COMMENT = `A comment written in We ${tag}`;
  const STOCK_COMMENT = `A comment the stock side wrote ${tag}`;
  const SHOTS = process.env.ACORN_SHOTS;

  let stockMod;
  let stockH;
  let page;
  let parentSeed;

  const hashText = (hash) => (typeof hash === 'string' ? hash : `u${Buffer.from(hash).toString('base64url')}`);
  const FETCH_ALL = { input: { All: null }, local: true };
  const fetchOutcomes = () => stockMod.stockCall(stockH, 'projects', 'fetch_outcomes', FETCH_ALL);
  const fetchConnections = () => stockMod.stockCall(stockH, 'projects', 'fetch_connections', FETCH_ALL);
  const fetchComments = () => stockMod.stockCall(stockH, 'projects', 'fetch_outcome_comments', FETCH_ALL);
  /** Stock's task list as `{ task, complete }` — key order is the zome's, not ours. */
  const stockTasks = async (content) =>
    ((await fetchOutcomes()).find((r) => r.entry?.content === content)?.entry?.scope?.Small?.taskList ?? []).map(
      (t) => ({ task: t.task, complete: t.complete }),
    );

  const dialog = () => page.locator('we-modal');

  before(async () => {
    stockMod = await import(rigFile('stock.mjs'));
    stockH = await stockMod.connect();
    // An Uncertain parent with one child the stock side made, and a Small outcome for tasks.
    parentSeed = await stockMod.createOutcome(stockH, PARENT, {
      scope: { Uncertain: { smallsEstimate: null, timeFrame: null, inBreakdown: false } },
    });
    await stockMod.createOutcomeUnder(stockH, parentSeed.actionHash, STOCK_CHILD);
    await stockMod.createOutcome(stockH, SMALL);

    const joined = await datasetNamed('Acorn project');
    page = await tab('children');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(app.url);
    await answerNamePrompt(page, 'Acorn Dev');
    await page.goto(`${app.url}/space/${joined.uuid}`);
    await page.waitForURL(/\/space\//, { timeout: 300_000 });
  });

  after(async () => {
    if (stockH) await stockMod.closeStock(stockH).catch(() => {});
  });

  it('a child created in We writes through as an outcome and its connection', async () => {
    await page.getByRole('button', { name: `Open ${PARENT}`, exact: true }).click({ timeout: 300_000 });
    // The stock side's child is drawn under it — the stock → We direction for the tree.
    await dialog()
      .getByRole('button', { name: `Open child ${STOCK_CHILD}`, exact: true })
      .waitFor({ state: 'visible', timeout: 300_000 });

    await fillHeld([[dialog().getByRole('textbox', { name: 'New child outcome' }), WE_CHILD]]);
    await dialog().getByRole('button', { name: 'Add child outcome', exact: true }).click();

    const child = await h.until(
      async () => (await fetchOutcomes()).find((r) => r.entry?.content === WE_CHILD),
      (r) => !!r,
      { timeout: 120_000, what: `stock fetch_outcomes to show "${WE_CHILD}"` },
    );
    assert.ok(
      'Uncertain' in (child.entry.scope ?? {}),
      `"${WE_CHILD}" should be Uncertain, as Acorn's add-child makes it`,
    );
    const parentHash = hashText(parentSeed.actionHash);
    const childHash = hashText(child.actionHash);
    await h.until(
      fetchConnections,
      (conns) =>
        conns.some(
          (c) => hashText(c.entry?.parentActionHash) === parentHash && hashText(c.entry?.childActionHash) === childHash,
        ),
      { timeout: 120_000, what: `stock fetch_connections to link "${PARENT}" → "${WE_CHILD}"` },
    );
    await dialog()
      .getByRole('button', { name: `Open child ${WE_CHILD}`, exact: true })
      .waitFor({ state: 'visible', timeout: 120_000 });
  });

  it('a comment written in We writes through', async () => {
    await fillHeld([[dialog().getByRole('textbox', { name: 'Comment' }), WE_COMMENT]]);
    await dialog().getByRole('button', { name: 'Add comment', exact: true }).click();
    const parentHash = hashText(parentSeed.actionHash);
    await h.until(
      fetchComments,
      (cs) => cs.some((c) => c.entry?.content === WE_COMMENT && hashText(c.entry?.outcomeActionHash) === parentHash),
      { timeout: 120_000, what: `stock fetch_outcome_comments to show "${WE_COMMENT}" on "${PARENT}"` },
    );
    await dialog().getByText(WE_COMMENT).waitFor({ state: 'visible', timeout: 120_000 });
  });

  it('a stock-side comment shows in the open dialog', async () => {
    await stockMod.createComment(stockH, parentSeed.actionHash, STOCK_COMMENT);
    await dialog().getByText(STOCK_COMMENT).waitFor({ state: 'visible', timeout: 300_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'expanded-outcome-children-comments.png') });
  });

  it('opening a child shows it in the same dialog', async () => {
    await dialog()
      .getByRole('button', { name: `Open child ${STOCK_CHILD}`, exact: true })
      .click();
    await dialog()
      .getByRole('button', { name: `Back to ${PARENT}`, exact: true })
      .waitFor({ state: 'visible', timeout: 60_000 });
    // The stock child is Small: it has a task list where the parent had children.
    await dialog()
      .getByRole('button', { name: 'Add task', exact: true })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await dialog()
      .getByRole('button', { name: `Back to ${PARENT}`, exact: true })
      .click();
    await dialog().getByRole('button', { name: 'Add child outcome', exact: true }).waitFor({ timeout: 60_000 });
    await page.keyboard.press('Escape');
  });

  it('tasks added, ticked and removed in We write through', async () => {
    await page.getByRole('button', { name: `Open ${SMALL}`, exact: true }).click({ timeout: 300_000 });
    const field = dialog().getByRole('textbox', { name: 'New task' });
    await field.waitFor({ state: 'visible', timeout: 120_000 });

    await fillHeld([[field, TASK]]);
    await dialog().getByRole('button', { name: 'Add task', exact: true }).click();
    await h.until(
      () => stockTasks(SMALL),
      (tasks) => JSON.stringify(tasks) === JSON.stringify([{ task: TASK, complete: false }]),
      { timeout: 120_000, what: `stock taskList of "${SMALL}" to hold "${TASK}"` },
    );
    await dialog().getByRole('checkbox', { name: TASK }).waitFor({ state: 'visible', timeout: 120_000 });

    await fillHeld([[field, SECOND_TASK]]);
    await dialog().getByRole('button', { name: 'Add task', exact: true }).click();
    await h.until(
      () => stockTasks(SMALL),
      (tasks) => tasks?.length === 2 && tasks[1].task === SECOND_TASK,
      { timeout: 120_000, what: `stock taskList of "${SMALL}" to hold two tasks` },
    );
    await dialog().getByRole('checkbox', { name: SECOND_TASK }).waitFor({ state: 'visible', timeout: 120_000 });

    await dialog().getByRole('checkbox', { name: TASK }).click();
    await h.until(
      () => stockTasks(SMALL),
      (tasks) =>
        JSON.stringify(tasks) ===
        JSON.stringify([
          { task: TASK, complete: true },
          { task: SECOND_TASK, complete: false },
        ]),
      { timeout: 120_000, what: `stock to show "${TASK}" done` },
    );
    await dialog().getByText('Tasks 1/2').waitFor({ state: 'visible', timeout: 120_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'expanded-outcome-tasks.png') });

    await dialog()
      .getByRole('button', { name: `Remove task ${SECOND_TASK}`, exact: true })
      .click();
    await h.until(
      () => stockTasks(SMALL),
      (tasks) => JSON.stringify(tasks) === JSON.stringify([{ task: TASK, complete: true }]),
      { timeout: 120_000, what: `stock taskList of "${SMALL}" to drop "${SECOND_TASK}"` },
    );
    await dialog().getByRole('checkbox', { name: SECOND_TASK }).waitFor({ state: 'detached', timeout: 120_000 });
    await page.keyboard.press('Escape');
  });
});

/*
  S2-6: the outcome table on the live mount — the production build's acorn template placing
  `acorn.outcomeTable`. Stock's tree must show as Acorn's table does (a parent and its child, the
  child a level in), Acorn's filters must narrow it, a stock-side child must appear, and a row
  must open the expanded outcome.
*/
describe('the outcome table on the live mount', () => {
  const tag = Date.now().toString(36);
  const PARENT = `OT parent ${tag}`;
  const CHILD = `OT child ${tag}`;
  const LATE = `OT late child ${tag}`;
  const SHOTS = process.env.ACORN_SHOTS;

  let stockMod;
  let stockH;
  let page;
  let parentSeed;

  const rowButton = (content) => page.getByRole('button', { name: `Open ${content}`, exact: true });

  before(async () => {
    stockMod = await import(rigFile('stock.mjs'));
    stockH = await stockMod.connect();
    parentSeed = await stockMod.createOutcome(stockH, PARENT, {
      scope: { Uncertain: { smallsEstimate: null, timeFrame: null, inBreakdown: false } },
    });
    await stockMod.createOutcomeUnder(stockH, parentSeed.actionHash, CHILD);

    const joined = await datasetNamed('Acorn project');
    page = await tab('table');
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(app.url);
    await answerNamePrompt(page, 'Acorn Dev');
    await page.goto(`${app.url}/space/${joined.uuid}`);
    await page.waitForURL(/\/space\//, { timeout: 300_000 });
    await page.getByRole('button', { name: 'Table', exact: true }).click({ timeout: 300_000 });
  });

  after(async () => {
    if (stockH) await stockMod.closeStock(stockH).catch(() => {});
  });

  it("draws stock's tree as Acorn's table, with its filters", async () => {
    await rowButton(PARENT).waitFor({ state: 'visible', timeout: 300_000 });
    await rowButton(CHILD).waitFor({ state: 'visible', timeout: 300_000 });
    // The child sits under its parent, a level in, with a fold toggle on the parent.
    const [parentBox, childBox] = [await rowButton(PARENT).boundingBox(), await rowButton(CHILD).boundingBox()];
    assert.ok(childBox.y > parentBox.y, 'the child row should follow its parent');
    assert.ok(childBox.x > parentBox.x, 'the child row should be indented under its parent');
    await page.getByRole('button', { name: `Collapse ${PARENT}`, exact: true }).waitFor({ timeout: 60_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'outcome-table.png'), fullPage: true });

    await page.getByRole('textbox', { name: 'Filter by keyword or ID number' }).fill(CHILD);
    await rowButton(PARENT).waitFor({ state: 'detached', timeout: 60_000 });
    await rowButton(CHILD).waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByRole('button', { name: 'Uncertain', exact: true }).click();
    // The child is Small: keyword AND scope Uncertain matches nothing of ours.
    await rowButton(CHILD).waitFor({ state: 'detached', timeout: 60_000 });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'outcome-table-filtered.png'), fullPage: true });
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await rowButton(PARENT).waitFor({ state: 'visible', timeout: 60_000 });
  });

  it('a stock-side child appears under its parent', async () => {
    await stockMod.createOutcomeUnder(stockH, parentSeed.actionHash, LATE, 1);
    await rowButton(LATE).waitFor({ state: 'visible', timeout: 300_000 });
    await page.getByRole('button', { name: `Collapse ${PARENT}`, exact: true }).click();
    await rowButton(LATE).waitFor({ state: 'detached', timeout: 60_000 });
    await rowButton(CHILD).waitFor({ state: 'detached', timeout: 60_000 });
    await page.getByRole('button', { name: `Expand ${PARENT}`, exact: true }).click();
    await rowButton(LATE).waitFor({ state: 'visible', timeout: 60_000 });
  });

  it('a row opens the expanded outcome with its children', async () => {
    await rowButton(PARENT).click();
    const dialog = page.locator('we-modal');
    await dialog
      .getByRole('button', { name: `Open child ${CHILD}`, exact: true })
      .waitFor({ state: 'visible', timeout: 120_000 });
    await dialog.getByRole('button', { name: `Open child ${LATE}`, exact: true }).waitFor({ timeout: 60_000 });
    await page.keyboard.press('Escape');
  });
});
