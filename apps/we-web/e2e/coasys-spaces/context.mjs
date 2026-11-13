/**
 * What every vertical of the coasys-spaces suite stands on: one executor (multi-user, MCP on), one
 * served build of the app, one browser, and the model servers the executor uses (`models.mjs`): a
 * language model, the stub or a real one by tier, and in the real tier a speech-to-text model.
 *
 * The world is made once, on the first vertical that asks, and closed once, after the last. Each
 * vertical then makes its own people (fresh accounts, so one vertical's installs and spaces never leak
 * into the next) and wraps each step in {@link step}, which saves a screenshot of every page the
 * vertical holds when a step fails, skips the steps after it, and keeps the vertical's Playwright
 * trace when anything in it failed.
 *
 * Environment:
 *
 * - `COASYS_SPACES_TIER` — `stub` (default) or `real`.
 * - `COASYS_SPACES_LLM_BASE_URL`, `COASYS_SPACES_LLM_MODEL`, `COASYS_SPACES_LLM_API_KEY` — the real
 *   tier's OpenAI-compatible language model.
 * - `COASYS_SPACES_TRANSCRIPTION_BASE_URL` — the real tier's OpenAI-compatible speech server
 *   (`/v1/audio/transcriptions`, e.g. speaches). Not set: the stub server writes the transcript, and
 *   the run log says so. `COASYS_SPACES_TRANSCRIPTION_MODEL` (default: the transcription model AD4M
 *   recommends) and `COASYS_SPACES_TRANSCRIPTION_API_KEY` go with it. The stub tier uses none of
 *   them: it types its lines into the call.
 * - `COASYS_SPACES_WAV` — the real tier's recording the fake microphone plays.
 * - `COASYS_SPACES_ARTIFACTS` — where failure screenshots, traces and the executor log go; else
 *   `WE_E2E_ARTIFACTS`, as for every journey; else a new temp directory.
 * - `SOCIAL_DNA_PACKAGE` — the social DNA package to install (see `dna.mjs`).
 */
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAd4mBackendPorts } from '@we/backend-ad4m';
import {
  artifactsDir,
  captureFailure,
  device,
  launchBrowser,
  saveArtifact,
  serveDist,
  signUp,
  sleep,
  slug,
  startExecutor,
  until,
} from '@we/e2e';

import { dismissNamePrompt } from '../steps/space.mjs';
import { modelsFor, needsStubServer, registerModels } from './models.mjs';
import { startStubLlm } from './stub-llm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The web build under test: `pnpm build:web`, with `WE_SEED=seeds/coasys.seed.json`. */
const DIST = join(HERE, '..', '..', 'dist');

export const TIER = process.env.COASYS_SPACES_TIER === 'real' ? 'real' : 'stub';
export const STUB = TIER === 'stub';

export const ARTIFACTS = artifactsDir({ dir: process.env.COASYS_SPACES_ARTIFACTS, prefix: 'coasys-spaces-' });

export const DNA_PATH = resolve(process.env.SOCIAL_DNA_PACKAGE ?? join(HERE, 'fixtures', 'software-team.dna.json'));

/** How long a step waits for what extraction, sync or a flow write produces. Longer for a real model. */
export const SLOW = STUB ? 120_000 : 600_000;

/** How long a step may take by default: one {@link SLOW} wait, and two minutes for the screen around it. */
const STEP = SLOW + 120_000;

/**
 * How long a step that holds a call until it finds records may take (`callThatFinds` in
 * `steps.mjs`): the lines landing, then extraction, each up to {@link SLOW}, and five minutes for
 * starting, leaving and reaching the call on the screen.
 */
export const CALL_STEP = 2 * SLOW + 300_000;

/**
 * How long making the world may take: the executor, its models, the served app and the browser. Its
 * own budget, apart from a step's. The executor downloads no model: each runs on a server of its own.
 */
const WORLD = 600_000;

let made = null;

/**
 * What the world has started so far. Kept apart from `made` so that a world which fails half-way —
 * no web build to serve, say — still has its stub and its executor stopped.
 */
const started = { stub: null, executor: null, app: null, browser: null };

/** The shared world, made on first use. */
export function world() {
  made ??= (async () => {
    // The scripted lines, spoken (fixtures/call.wav), unless another recording is named.
    const wav = resolve(process.env.COASYS_SPACES_WAV ?? join(HERE, 'fixtures', 'call.wav'));
    try {
      // In the real tier the stub server only writes the transcript, and only when no speech server
      // is named; `stub` below is the stub tier's language model, which steps read the script from.
      const server = (started.stub = needsStubServer(TIER, process.env) ? await startStubLlm() : null);
      const { llm, transcriber } = modelsFor({ tier: TIER, env: process.env, stub: server });
      const executor = (started.executor = await startExecutor({ mcp: true }));
      await registerModels(executor.admin, { llm, transcriber });
      const app = (started.app = await serveDist(DIST));
      const browser = (started.browser = await launchBrowser({ fakeAudio: STUB ? undefined : wav }));
      return { executor, app, browser, llm, transcriber, stub: STUB ? server : null };
    } catch (error) {
      await stopStarted();
      throw error;
    }
  })();
  return made;
}

/**
 * Stops whatever the world has started, once each, and leaves the executor's log beside the other
 * artifacts.
 */
async function stopStarted() {
  const { browser, app, executor, stub } = started;
  Object.assign(started, { stub: null, executor: null, app: null, browser: null });
  try {
    await browser?.close().catch(() => {});
    await app?.close().catch(() => {});
    if (executor) {
      saveArtifact(join(ARTIFACTS, 'executor.log'), executor.log());
      try {
        executor.admin.close?.();
      } finally {
        await executor.stop().catch(() => {});
      }
    }
  } finally {
    await stub?.close().catch(() => {});
  }
}

/** Closes the world, whether it was made or failed half-way. */
async function closeWorld() {
  if (!made) return;
  await made.catch(() => null);
  await stopStarted();
  console.log(`coasys-spaces: artifacts in ${ARTIFACTS}`);
}
after(closeWorld);

/**
 * A vertical: one `describe`, its people, and its failure artifacts. `body(v)` declares the steps with
 * `v.step(name, fn)` and `v.todo(words)`, and makes people with `await v.person(name)` inside a step.
 */
export function vertical(name, body) {
  const v = {
    name,
    slug: slug(name),
    failed: false,
    people: [],
    /** A fresh account signed in on its own device, its app open and its name given. */
    async person(display) {
      const w = await world();
      const email = `${slug(display)}-${v.slug}@coasys-spaces.test`;
      const account = await signUp(w.executor, email);
      // Held from here, so the vertical's teardown closes the account's client even if a step below
      // throws; `device`, `page` and `ports` are filled in as they are made.
      const who = { name: display, account, client: account.client, did: account.did, device: null, page: null };
      v.people.push(who);
      const dev = (who.device = await device(w.browser, w.executor, account, { name: `${display}/${v.slug}` }));
      await dev.context.tracing.start({ screenshots: true, snapshots: true, title: `${name}: ${display}` });
      const page = (who.page = await dev.tab('main'));
      await page.goto(w.app.url);
      await page.getByRole('textbox', { name: 'Name...', exact: true }).waitFor({ timeout: 120_000 });
      await dismissNamePrompt(page, display);
      await page.getByRole('textbox', { name: 'Name...', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 });
      // The prompt can come back on a later load, before the saved name has reached the app. It covers
      // the page, so it is answered whenever it stands in the way of an action.
      await page.addLocatorHandler(page.getByRole('textbox', { name: 'Name...', exact: true }), () =>
        dismissNamePrompt(page, display),
      );
      who.ports = createAd4mBackendPorts(account.client, { selfId: () => account.did });
      return who;
    },
    step(title, fn, opts = {}) {
      it(title, { timeout: opts.timeout ?? STEP }, async (t) => {
        if (v.failed) {
          t.skip('an earlier step of this vertical failed');
          return;
        }
        try {
          await fn(t);
        } catch (error) {
          v.failed = true;
          await snapshotAll(v, title);
          throw error;
        }
      });
    },
    todo(words) {
      it.todo(words);
    },
    closers: [],
    /** Something to undo when the vertical ends, pass or fail — a client with no browser, say. */
    onClose(fn) {
      v.closers.push(fn);
    },
  };

  describe(name, () => {
    // Made before the first step, on its own budget: see `WORLD`.
    before(() => world(), { timeout: WORLD });
    after(async () => {
      for (const who of v.people) {
        try {
          if (who.device) {
            try {
              const trace = v.failed ? join(ARTIFACTS, `${v.slug}-${slug(who.name)}.trace.zip`) : undefined;
              await who.device.context.tracing.stop(trace ? { path: trace } : {}).catch(() => {});
              if (v.failed || process.env.WE_LIVE_VERBOSE) {
                saveArtifact(join(ARTIFACTS, `${v.slug}-${slug(who.name)}.console.log`), who.device.logs.join('\n'));
              }
            } finally {
              await who.device.close().catch(() => {});
            }
          }
        } finally {
          // The account's client reconnects its socket for ever once the executor stops, which keeps
          // the test process alive after the last test.
          await Promise.resolve()
            .then(() => who.account.client.close?.())
            .catch(() => {});
        }
      }
      for (const close of v.closers)
        await Promise.resolve()
          .then(close)
          .catch(() => {});
    });
    body(v);
  });
  return v;
}

/**
 * A screenshot and an accessibility snapshot of every page a vertical holds, named for the vertical,
 * the step and the person, and the executor's log so far.
 */
function snapshotAll(v, title) {
  const pages = v.people.flatMap((who) =>
    (who.device?.context.pages() ?? []).map((page, i) => ({ label: `${slug(who.name)}-${i}`, page })),
  );
  return captureFailure({
    dir: ARTIFACTS,
    name: `${v.slug}-${slug(title).slice(0, 60)}`,
    pages,
    executor: started.executor,
  });
}

export { sleep, until };
