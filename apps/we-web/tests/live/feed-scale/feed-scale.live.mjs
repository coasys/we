/**
 * The Feed of a space holding a million messages: how long the newest page and the page before it take
 * to appear, how long the executor takes to answer the Feed's query while they load, and what the
 * executor holds in memory to do it. See README.md for what is measured, and how, and why.
 *
 * One test, in order — each step stands on the one before:
 *
 * 1. An executor, the built app, Chromium (`../harness.mjs`), and one account.
 * 2. A shared space made in the app, and one line typed into its Feed — the message every seeded one
 *    is a copy of (`seed.mjs`, `messageShape`).
 * 3. The seeding, through the executor's own write path, with the browser closed and the space's
 *    auto-processor (the app's standing watch) removed for it. Then a check that what the Feed will
 *    read is what was meant: the newest message's flag link is the seeded author's, at the seeded
 *    time, verified; and the executor's own answer to the Feed's query is newest first. Then the
 *    executor's idle CPU over a quiet spell.
 * 4. `FEED_SCALE_RUNS` loads of the space (5): the first in a fresh browser profile (cold), the rest
 *    reloads of it (warm). The app registers its watch again as it opens the space, as it does for
 *    anyone. Each load times the newest page by the page's own marks, then scrolls to the older edge
 *    and times the page before it, and keeps every call the page made. Then the executor's CPU over
 *    the loads, and its idle CPU with the watch the app registered.
 * 5. `results.json` and one summary line, the job log's last.
 *
 * Environment (all optional):
 *
 * | Variable | Default | |
 * |---|---|---|
 * | `FEED_SCALE_MESSAGES` | 1000000 | messages seeded (at least 200) |
 * | `FEED_SCALE_RUNS` | 5 | loads of the space; the first is cold |
 * | `FEED_SCALE_ARTIFACTS` | a new dir under `$TMPDIR` | `results.json`, `metrics.json`, the executor log, screenshots |
 * | `PERF_RESULTS_DIR` | (none) | also write `feed-scale.json` (the metrics alone) here, for ad4m's `scripts/perf/record` |
 * | `FEED_SCALE_SEED_MODE` | `hybrid` | `hybrid`, `executor` (seeding only; the run then stops) or `signed` (`seed.mjs`) |
 * | `FEED_SCALE_BATCH` | 100 | messages per write batch |
 * | `FEED_SCALE_BATCHES_IN_FLIGHT` | 8 | batches written at once |
 * | `FEED_SCALE_SIGNED_IN_FLIGHT` | 512 | signed links written at once (`hybrid`, `signed`) |
 * | `FEED_SCALE_CLIENTS` | 8 | executor connections the seeding spreads over |
 * | `FEED_SCALE_PAGE_TIMEOUT` | 600000 | how long one page may take to appear, and the suite's own Feed query from outside the page, ms |
 * | `FEED_SCALE_IDLE_SECONDS` | 30 | each quiet spell the executor's idle CPU is read over (after the seeding, after the loads) |
 * | `FEED_SCALE_KEEP_STORE` | (none) | a directory the executor uses as its data directory, kept after the run (with `feed-scale-store.json` inside), for `FEED_SCALE_REUSE_STORE` |
 * | `FEED_SCALE_REUSE_STORE` | (none) | a store KEEP kept: the space and the seeding are skipped and the load phase runs on what is there |
 *
 * The executor keeps its data under `$TMPDIR` (the harness's data directory): at a million messages
 * that is tens of gigabytes, so point `TMPDIR` at a disk that has them.
 *
 * A slow answer is a result, not a failure: a run whose page never draws is recorded with why it
 * could not — the executor refusing the page's feed call (its SPARQL eval deadline,
 * `query_deadline_secs`, 30 s on `dev`, kills a query it cannot answer in time: the page then has
 * nothing to draw) or the timeout passing — in `detail.runs[].outcome` and in the
 * `feed.*_page.failures` metrics, and the run goes on to the next load.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Ad4mClient, LinkQuery } from '@coasys/ad4m';

import { device, launchBrowser, serveApp, signUp, sleep, startExecutor } from '../harness.mjs';
import { createSpace, dismissNamePrompt, openSpace } from '../space.mjs';
import { JOB, cpuSeconds, loadPhases, memory, metrics, summaryLine } from './results.mjs';
import { MODES, PROCESSOR_ID, messageShape, processorIds, seedMessages } from './seed.mjs';
import { openWriter } from './writer.mjs';

const env = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name}=${raw} is not a positive whole number`);
  return n;
};

const envPath = (name) => (process.env[name] ? resolve(process.env[name]) : null);

const KEEP_STORE = envPath('FEED_SCALE_KEEP_STORE');
const REUSE_STORE = envPath('FEED_SCALE_REUSE_STORE');
if (KEEP_STORE && REUSE_STORE) {
  throw new Error('set FEED_SCALE_KEEP_STORE or FEED_SCALE_REUSE_STORE, not both');
}
const STORE_META_FILE = 'feed-scale-store.json';
// On reuse the kept store says how big it is: the rows the loads look for are counted from it.
const STORE_META = REUSE_STORE
  ? (() => {
      try {
        return JSON.parse(readFileSync(join(REUSE_STORE, STORE_META_FILE), 'utf8'));
      } catch {
        throw new Error(
          `FEED_SCALE_REUSE_STORE=${REUSE_STORE} has no readable ${STORE_META_FILE}: it is not a store the suite kept`,
        );
      }
    })()
  : null;
const MESSAGES = STORE_META?.messages ?? env('FEED_SCALE_MESSAGES', 1_000_000);
if (STORE_META && process.env.FEED_SCALE_MESSAGES && env('FEED_SCALE_MESSAGES', 0) !== STORE_META.messages) {
  throw new Error(
    `FEED_SCALE_MESSAGES=${process.env.FEED_SCALE_MESSAGES} but the kept store holds ${STORE_META.messages} messages`,
  );
}
if (KEEP_STORE && existsSync(KEEP_STORE) && readdirSync(KEEP_STORE).length) {
  throw new Error(`FEED_SCALE_KEEP_STORE=${KEEP_STORE} is not an empty directory`);
}
const RUNS = env('FEED_SCALE_RUNS', 5);
const MODE = process.env.FEED_SCALE_SEED_MODE || 'hybrid';
const BATCH = env('FEED_SCALE_BATCH', 100);
const BATCHES_IN_FLIGHT = env('FEED_SCALE_BATCHES_IN_FLIGHT', 8);
const SIGNED_IN_FLIGHT = env('FEED_SCALE_SIGNED_IN_FLIGHT', 512);
const CLIENTS = env('FEED_SCALE_CLIENTS', 8);
const PAGE_TIMEOUT = env('FEED_SCALE_PAGE_TIMEOUT', 600_000);
const IDLE_SECONDS = env('FEED_SCALE_IDLE_SECONDS', 30);
const ARTIFACTS = process.env.FEED_SCALE_ARTIFACTS
  ? resolve(process.env.FEED_SCALE_ARTIFACTS)
  : mkdtempSync(join(tmpdir(), 'feed-scale-'));
mkdirSync(ARTIFACTS, { recursive: true });

if (!MODES.includes(MODE)) throw new Error(`FEED_SCALE_SEED_MODE=${MODE}: one of ${MODES.join(', ')}`);
// The older page is rows 51 to 150: fewer messages than that and it has nothing to show.
if (MESSAGES < 200) throw new Error(`FEED_SCALE_MESSAGES=${MESSAGES}: at least 200`);

/** The Feed's first window and the window after one "load older" (`@we/module-feed`, `feed.ts`). */
const FIRST_PAGE = 50;
const SECOND_WINDOW = 150;

const log = (line) => console.log(`[feed-scale ${new Date().toISOString()}] ${line}`);

/**
 * Message `i`'s row. Its words end ` #i` (`seed.mjs`, `words`), and the leading space keeps `#12`
 * from matching `#112`.
 */
const row = (page, i) => page.getByText(new RegExp(` #${i}$`)).first();

/**
 * Installed in every document the reader loads, before the app's own scripts: notes, by the page's
 * own clock (`Date.now()`, the same clock as the suite's), when the newest message first became
 * visible, when the window's last row and the older window's last row were first in the DOM, and when
 * the document finished loading. Read back with `window.__feedScaleMarks`.
 *
 * This is what the newest page is timed by, rather than by the moment a locator's polling notices: a
 * locator re-checks at intervals of up to half a second, which would be the suite's wait, not the
 * app's. The locators still run, as the gate that the rows are there and as Playwright reads them.
 *
 * Visible is checked on the next animation frames after the row is attached: in the layout, with a
 * size, and inside the viewport. A row that is replaced before it is seen is looked for again.
 */
function feedMarks({ newest, last, older }) {
  const want = { newestVisible: ` #${newest}`, lastAttached: ` #${last}`, olderAttached: ` #${older}` };
  const marks = {};
  const found = {};
  window.__feedScaleMarks = marks;
  document.addEventListener('DOMContentLoaded', () => (marks.domContentLoaded ??= Date.now()));
  window.addEventListener('load', () => (marks.load ??= Date.now()));
  const holding = (node, tail) => {
    if (node.nodeType === Node.TEXT_NODE) return node.data.trimEnd().endsWith(tail) ? node.parentElement : null;
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) if (t.data.trimEnd().endsWith(tail)) return t.parentElement;
    return null;
  };
  const untilVisible = (el) => {
    const step = () => {
      if (!el.isConnected) {
        found.newestVisible = null;
        return;
      }
      const r = el.getBoundingClientRect();
      const shown = el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
      if (shown && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) {
        marks.newestVisible = Date.now();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const scan = (node) => {
    const text = node.nodeType === Node.TEXT_NODE ? node.data : node.textContent;
    if (!text) return;
    for (const [name, tail] of Object.entries(want)) {
      if (found[name] || marks[name] !== undefined || !text.includes(tail)) continue;
      const el = holding(node, tail);
      if (!el) continue;
      found[name] = el;
      if (name === 'newestVisible') {
        marks.newestAttached ??= Date.now();
        untilVisible(el);
      } else {
        marks[name] = Date.now();
      }
    }
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') scan(r.target);
      else for (const n of r.addedNodes) scan(n);
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
}

/** The executor's CPU seconds so far, user and system, or null off Linux. */
const CLK_TCK = (() => {
  const n = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout?.trim());
  return n > 0 ? n : 100;
})();
const cpuOf = (pid) => {
  try {
    return cpuSeconds(readFileSync(`/proc/${pid}/stat`, 'utf8'), CLK_TCK);
  } catch {
    return null;
  }
};

/**
 * The executor's CPU over `seconds` in which nothing asks it anything: a percent of one core. What it
 * spends here is its own background work — at this size, mostly the auto-processor's ticks.
 */
async function idleCpuPercent(pid, seconds) {
  const before = cpuOf(pid);
  const t = performance.now();
  await sleep(seconds * 1_000);
  const after = cpuOf(pid);
  if (before === null || after === null) return null;
  return ((after - before) / ((performance.now() - t) / 1_000)) * 100;
}

/** The ids of the auto-processors registered in the space, read off its links. */
const watchesIn = async (perspective) =>
  processorIds(await perspective.get(new LinkQuery({ predicate: PROCESSOR_ID })));

/**
 * Every call the page makes to the executor, as the executor answered it: the time from the request
 * frame leaving the page to its answer arriving, over a socket to an executor on the same machine.
 *
 * The Feed's are the model queries over the space's collection (`parent` is its root), marked `feed`.
 * Its window read is several of these at once — its messages (`TextBlock`), the calls, one per kind
 * extraction finds — and draws when the last answers, so each is kept with its class. Every other
 * call is kept too: what the page waits for before the Feed asks is part of the newest page's time.
 */
function watchFeedQueries(page, root) {
  const seen = [];
  // Calls asked and not yet answered, over every socket: what a stuck load is still waiting on.
  const pending = new Map();
  seen.unanswered = () => [...pending.values()];
  page.on('websocket', (ws) => {
    // A reload closes the socket; what it never answered is no longer anything the page waits on.
    ws.on('close', () => {
      for (const key of pending.keys()) if (key.startsWith(`${ws.url()} `)) pending.delete(key);
    });
    ws.on('framesent', ({ payload }) => {
      let message;
      try {
        message = JSON.parse(String(payload));
      } catch {
        return;
      }
      if (typeof message?.type !== 'string' || message.id === undefined) return;
      const asked = {
        type: message.type,
        className: null,
        limit: null,
        feed: false,
        query: null,
        sent: performance.now(),
      };
      if (message.type === 'perspective.modelQuery') {
        asked.className = [message.params?.class_name].flat().join('|');
        // As sent, so a slow one can be told apart from another of its class in results.json.
        asked.query = message.params?.query_json ?? null;
        try {
          const query = JSON.parse(message.params.query_json);
          asked.limit = query.limit ?? null;
          asked.feed = query.parent?.id === root;
        } catch {
          // A query this cannot read is still a call the page waited for.
        }
      }
      pending.set(`${ws.url()} ${message.id}`, asked);
    });
    ws.on('framereceived', ({ payload }) => {
      let message;
      try {
        message = JSON.parse(String(payload));
      } catch {
        return;
      }
      const key = `${ws.url()} ${message.id}`;
      const asked = pending.get(key);
      if (!asked) return;
      pending.delete(key);
      let rows = null;
      try {
        const result = typeof message.result === 'string' ? JSON.parse(message.result) : message.result;
        rows = result?.instances?.length ?? null;
      } catch {
        // An answer that is not a result (an error frame): kept, with no row count.
      }
      seen.push({
        type: asked.type,
        feed: asked.feed,
        className: asked.className,
        limit: asked.limit,
        query: asked.query,
        sent: asked.sent,
        ms: performance.now() - asked.sent,
        rows,
        error: message.error ?? null,
      });
    });
  });
  return seen;
}

/**
 * Scrolls the Feed to its top: the older edge, with the newest at the bottom, where the Feed asks for
 * the page before. The scroller is the `[part="base"]` inside the `we-scroll-area` the rows are slotted
 * into; pinned to its end it is `column-reverse`, so its top is the most negative `scrollTop` and the
 * browser clamps whatever is past it.
 */
function scrollToOlderEdge(locator) {
  return locator.evaluate((el) => {
    const area = el.closest('we-scroll-area');
    const base = area?.shadowRoot?.querySelector('[part="base"]');
    if (!base) throw new Error('the Feed row is not inside a we-scroll-area');
    // Either way round, the top is the lowest scrollTop: 0 for an ordinary scroller, negative for a
    // reversed one; the browser clamps this to it.
    base.scrollTop = -base.scrollHeight;
    return { scrollTop: base.scrollTop, scrollHeight: base.scrollHeight, clientHeight: base.clientHeight };
  });
}

const rssOf = (pid) => {
  try {
    return memory(readFileSync(`/proc/${pid}/status`, 'utf8'));
  } catch {
    return { rss: null, peak: null };
  }
};

/**
 * The most the executor has held: the kernel's high-water mark, or a reading taken earlier when that
 * was higher — the mark is kept from per-thread counters the kernel folds in lazily, so it can trail
 * a reading by a few MiB.
 */
const peakOf = (now) => {
  const seen = [now.peak, now.rss, run.rss.afterSeed, run.rss.afterUi].filter((n) => typeof n === 'number');
  return seen.length ? Math.max(...seen) : null;
};

const run = {
  messages: MESSAGES,
  mode: STORE_META?.mode ?? MODE,
  seed: null,
  newest: [],
  older: [],
  queries: [],
  otherQueries: [],
  cpu: {},
  rss: {},
};
const detail = { runs: [], seed: null, direct: [], settings: {}, watch: {} };

/** Signs in to an account a kept store already holds: what `signUp` ends with, without the signup. */
async function signIn(executor, email, password = 'test123') {
  const token = await executor.admin.agent.loginUser(email, password);
  const client = new Ad4mClient(executor.url, token);
  const { did } = await client.agent.me();
  return { email, password, token, did, client };
}

/** An error frame's message, whatever shape it took. */
const errText = (e) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e)));

/**
 * Waits for a part of the page to draw, watching the run's own calls meanwhile. Resolves
 * `{drawn: true}` when `shown()` holds. Ends early, `{drawn: false, kind, error}`, when the page
 * can never get there however long the wait: the executor refused a feed call of this run —
 * its SPARQL eval deadline (`query_deadline_secs`) kills a query it cannot answer in time, so the
 * page has nothing to draw and the refusal, not a missing row, is what the run measured — or the
 * page closed. `kind` is `timeout` when the wait ran out with neither.
 */
async function waitForRow(page, queries, from, { shown, timeout, pollMs = 250 }) {
  const deadline = performance.now() + timeout;
  for (;;) {
    if (page.isClosed()) return { drawn: false, kind: 'page-closed' };
    const refused = queries.slice(from).find((q) => q.feed && q.className === 'TextBlock' && q.error);
    if (refused) return { drawn: false, kind: 'feed-call-refused', error: errText(refused.error) };
    if (await shown().catch(() => false)) return { drawn: true };
    if (performance.now() >= deadline) return { drawn: false, kind: 'timeout' };
    await sleep(pollMs);
  }
}

test(`feed-scale: the Feed of a space with ${MESSAGES} messages`, { timeout: 6 * 3_600_000 }, async () => {
  let executor = null;
  let app = null;
  let browser = null;
  let status = 'failed';
  // The pages open now, so a failure keeps a screenshot of each before its device closes.
  const pages = new Map();
  const closing = async (dev, failed) => {
    if (failed) {
      for (const [name, page] of pages) {
        await page.screenshot({ path: join(ARTIFACTS, `failure-${name}.png`), fullPage: true }).catch(() => {});
      }
    }
    pages.clear();
    await dev.close();
  };
  try {
    executor = await startExecutor(KEEP_STORE || REUSE_STORE ? { dataPath: KEEP_STORE ?? REUSE_STORE } : {});
    // A kept store's agent is locked again after the restart, as every start finds it: unlock it
    // with the passphrase `agent.generate` made it with.
    const agentStatus = await executor.admin.agent.status();
    if (agentStatus.isInitialized && !agentStatus.isUnlocked) {
      await executor.admin.agent.unlock('we-live');
    }
    app = await serveApp();
    browser = await launchBrowser();
    detail.settings = {
      messages: MESSAGES,
      runs: RUNS,
      mode: run.mode,
      batch: BATCH,
      batchesInFlight: BATCHES_IN_FLIGHT,
      signedInFlight: SIGNED_IN_FLIGHT,
      clients: CLIENTS,
      store: KEEP_STORE ? `keep ${KEEP_STORE}` : REUSE_STORE ? `reuse ${REUSE_STORE}` : 'fresh',
    };

    let account;
    let shape;
    let spaceUrl;
    let perspective;
    let seeded = null;
    if (STORE_META) {
      /*
        A store the suite kept: the account, the space and the messages are already in it, and the
        load phase below runs exactly as it does after a seeding. What it needs to know — the space,
        the collection the Feed reads, the newest message's id, author and time — is read back off
        `feed-scale-store.json`, which the run that seeded it wrote into the store.
      */
      account = await signIn(executor, STORE_META.accountEmail ?? 'reader@feed-scale.test');
      spaceUrl = STORE_META.spaceUrl;
      /*
        The space's perspective is in the store, but a restarted executor does not attach a
        neighbourhood perspective the moment it answers `all()` — it has its link language to bring
        back first, which takes seconds at a small store and can take minutes at a million. Wait for
        it (joinFromUrl would make a second, empty perspective for the same neighbourhood).
      */
      const found = performance.now();
      while (performance.now() - found < PAGE_TIMEOUT) {
        const all = await account.client.perspective.all();
        perspective =
          all.find((p) => p.uuid === STORE_META.perspectiveUuid) ?? all.find((p) => p.sharedUrl === spaceUrl);
        if (perspective) break;
        await sleep(2_000);
      }
      assert.ok(perspective, `the kept store has no perspective for the space ${spaceUrl}`);
      log(`the space's perspective attached after ${((performance.now() - found) / 1_000).toFixed(1)} s`);
      shape = { root: STORE_META.root, properties: STORE_META.properties ?? [], links: STORE_META.linksPerMessage };
      seeded = { seconds: null, links: STORE_META.links ?? null, newest: STORE_META.newest };
      detail.store = {
        reused: STORE_META,
        dir: REUSE_STORE,
      };
      // The restarted executor's memory on the seeded store: the same point in the run as
      // `rss.after_seed` on a fresh one.
      run.rss.afterSeed = rssOf(executor.pid).rss;
      log(
        `reusing the kept store at ${REUSE_STORE}: ${MESSAGES} messages, ${STORE_META.links} links ` +
          `(seeded ${STORE_META.seededAt ?? '?'}${STORE_META.seedSeconds ? ` in ${STORE_META.seedSeconds.toFixed(0)} s` : ''})`,
      );
      // A watch the earlier run's loads left registered is taken away: the load phase is measured
      // as it is after a seeding, where the app registers the watch itself when the space opens.
      const left = await watchesIn(perspective);
      for (const id of left) await perspective.removeAutoProcessor(id);
      detail.watch.removedBeforeLoads = left;
      if (left.length) log(`removed ${left.length} auto-processor(s) the kept store still had: ${left.join(', ')}`);
    } else {
      account = await signUp(executor, 'reader@feed-scale.test');

      // 2. The space, and the one line every seeded message is a copy of.
      const writer = await device(browser, executor, account, { name: 'writer' });
      try {
        const page = await writer.tab('main');
        pages.set('writer', page);
        await page.goto(app.url);
        await page.getByRole('textbox', { name: 'Name...', exact: true }).waitFor({ timeout: 120_000 });
        await dismissNamePrompt(page, 'Reader');
        spaceUrl = await createSpace(page, account, 'A million messages');
        await openSpace(page, app, spaceUrl);
        const send = page.getByRole('button', { name: 'Send to the space' });
        await send.waitFor({ timeout: 60_000 });
        await page.locator('[contenteditable="true"]').last().click();
        await page.keyboard.type('the line every seeded message copies');
        await send.click();
        await page.getByText('the line every seeded message copies').first().waitFor({ timeout: 60_000 });
        perspective = (await account.client.perspective.all()).find((p) => p.sharedUrl === spaceUrl);
        const links = await perspective.get(new LinkQuery({}));
        const text = links.find((l) => l.data.predicate === 'we://text' && l.data.target.includes('every%20seeded'));
        assert.ok(text, 'the typed line is not in the space');
        const placed = links.find((l) => l.data.predicate === 'ad4m://has_child' && l.data.target === text.data.source);
        assert.ok(placed, 'the typed line is in no collection');
        shape = messageShape(links, text.data.source, placed.data.source);
        const properties = shape.properties.map((p) => p.predicate).join(', ');
        log(`one message is ${shape.links} links: the flag, ${properties}, has_child`);
      } catch (error) {
        await closing(writer, true);
        throw error;
      }
      await closing(writer, false);

      /*
        The space's standing watch, taken away for the seeding and only for it.

        Opening the space, the app registered an auto-processor over the messages typed into it (its
        own watch, `we-call-<collection>`, which extracts from them as they arrive). It is the product
        working as meant, and the loads below measure it: the app registers it again when the space
        opens. But while it is registered, the executor re-reads every message it covers twice a second,
        so each write of the seeding waits behind a tick that grows with the store, and a million
        messages would take hours. The seeding is setup, not what is measured, so it runs without it.
      */
      const removed = await watchesIn(perspective);
      for (const id of removed) await perspective.removeAutoProcessor(id);
      detail.watch.removedBeforeSeed = removed;
      log(`removed ${removed.length} auto-processor(s) for the seeding: ${removed.join(', ') || 'none'}`);

      // 3. The seeding.
      // Writers with no client-side timeout (writer.mjs): a queued write may wait minutes at a million.
      const clients = [];
      try {
        for (let c = 0; c < CLIENTS; c++) clients.push(await openWriter(executor.url, account.token));
        log(`seeding ${MESSAGES} messages (${MODE})`);
        seeded = await seedMessages({
          clients,
          uuid: perspective.uuid,
          shape,
          count: MESSAGES,
          mode: MODE,
          batch: BATCH,
          batchesInFlight: BATCHES_IN_FLIGHT,
          signedInFlight: SIGNED_IN_FLIGHT,
          onProgress: (written, count) => log(`seeded ${written}/${count}`),
        });
      } finally {
        for (const c of clients) c.close();
      }
      // Nothing should have registered one meanwhile (no page was open); if one did, this rate is not
      // the seeding's own.
      detail.watch.afterSeed = await watchesIn(perspective);
      if (detail.watch.afterSeed.length)
        log(`warning: auto-processor(s) registered during the seeding: ${detail.watch.afterSeed}`);
      run.seed = { seconds: seeded.seconds, links: seeded.links };
      detail.seed = { ...seeded, authors: seeded.authors.length };
      const afterSeed = rssOf(executor.pid);
      run.rss.afterSeed = afterSeed.rss;
      log(
        `seeded ${seeded.messages} messages, ${seeded.links} links in ${seeded.seconds.toFixed(1)} s; ` +
          `executor ${afterSeed.rss?.toFixed(0)} MiB`,
      );
      if (KEEP_STORE) {
        // Everything a later run needs to load this store again, inside the store itself.
        writeFileSync(
          join(KEEP_STORE, STORE_META_FILE),
          `${JSON.stringify(
            {
              version: 1,
              messages: MESSAGES,
              mode: MODE,
              spaceUrl,
              perspectiveUuid: perspective.uuid,
              root: shape.root,
              properties: shape.properties,
              linksPerMessage: shape.links,
              accountEmail: account.email,
              newest: seeded.newest,
              oldest: seeded.oldest,
              links: seeded.links,
              seedSeconds: seeded.seconds,
              seededAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
        );
        log(`kept the seeded store at ${KEEP_STORE} (load it again with FEED_SCALE_REUSE_STORE=${KEEP_STORE})`);
      }
    }

    // `executor` seeds only: each message is the account's, at the moment its batch was written, so
    // batches in flight interleave and the Feed's order is not the seeded order. The pages cannot be
    // timed against message numbers, and the run ends here with the seeding's numbers recorded.
    if (run.mode === 'executor') {
      throw new Error(
        `${STORE_META ? 'a kept store seeded with' : 'FEED_SCALE_SEED_MODE='}executor measures the seeding only: ` +
          'its messages are in write order, so the pages are not timed',
      );
    }

    // What the Feed will read is what was meant. A reused store answers the query only once its
    // perspective's data is loaded back, which trails the handle attaching — wait for it.
    const flagQuery = new LinkQuery({ source: seeded.newest.id, predicate: 'we://flag' });
    let flag;
    const flagWait = performance.now();
    while (!(flag = (await perspective.get(flagQuery))[0]) && performance.now() - flagWait < PAGE_TIMEOUT) {
      await sleep(2_000);
    }
    if (STORE_META && performance.now() - flagWait >= 2_000)
      log(`the kept store's links were queryable after ${((performance.now() - flagWait) / 1_000).toFixed(1)} s`);
    assert.ok(flag, `the newest message ${seeded.newest.id} has no flag`);
    assert.equal(flag.author, seeded.newest.author, 'the newest flag is not its seeded author’s');
    const at = new Date(flag.timestamp).toISOString();
    assert.equal(at, seeded.newest.at, 'the newest flag is not at its seeded time');
    assert.equal(flag.proof?.valid, true, 'the executor did not verify the newest flag');
    const windowQuery = (limit) =>
      JSON.stringify({
        parent: { id: shape.root, predicate: 'ad4m://has_child' },
        include: { thread: { polymorphic: true } },
        order: [['createdAt', 'desc']],
        limit,
        deepQuery: true,
      });
    // The SDK gives up on a call after 30 s; a page is allowed PAGE_TIMEOUT, and so is the same
    // query asked from here. The executor's own SPARQL eval deadline (`query_deadline_secs`,
    // 30 s on `dev`) may still refuse it: that is a measurement, kept in `detail.direct`, not a
    // failure of the suite.
    const askDirect = async (limit, when) => {
      const started = performance.now();
      try {
        const answer = await perspective.modelQuery('TextBlock', windowQuery(limit), { timeoutMs: PAGE_TIMEOUT });
        const ms = performance.now() - started;
        detail.direct.push({ limit, ms, when });
        return answer.instances;
      } catch (error) {
        const ms = performance.now() - started;
        detail.direct.push({ limit, ms, when, error: errText(error) });
        log(
          `the Feed's query from outside the page (${when}, limit ${limit}) failed after ` +
            `${(ms / 1_000).toFixed(1)} s: ${errText(error)}`,
        );
        return null;
      }
    };
    const instances = await askDirect(FIRST_PAGE, STORE_META ? 'on the kept store' : 'after seed');
    if (instances) {
      const numbers = instances
        .map((m) => / #(\d+)$/.exec(m.text ?? '')?.[1])
        .filter(Boolean)
        .map(Number);
      // The typed line is the newest (the seeded ones end an hour ago); every other row is a seeded one.
      assert.equal(instances.length, FIRST_PAGE, `the Feed's query answered ${instances.length} rows`);
      assert.deepEqual(
        numbers,
        Array.from({ length: FIRST_PAGE - 1 }, (_, k) => MESSAGES - 1 - k),
        `the Feed's query is not the newest seeded messages, newest first: ${numbers.slice(0, 5)}…`,
      );
    }

    run.cpu.idleAfterSeed = await idleCpuPercent(executor.pid, IDLE_SECONDS);
    log(`executor idle after the seeding: ${run.cpu.idleAfterSeed?.toFixed(1)}% of a core over ${IDLE_SECONDS} s`);

    // 4. The loads.
    // The run under way, so a failure can say what it asked and what it never heard back.
    let current = null;
    // The executor's CPU seconds when the loads begin.
    let cpuBefore = null;
    const reader = await device(browser, executor, account, { name: 'reader' });
    try {
      const page = await reader.tab('main');
      pages.set('reader', page);
      await page.addLocatorHandler(page.getByRole('textbox', { name: 'Name...', exact: true }), () =>
        dismissNamePrompt(page, 'Reader'),
      );
      const queries = watchFeedQueries(page, shape.root);
      await page.addInitScript(feedMarks, {
        newest: MESSAGES - 1,
        last: MESSAGES - (FIRST_PAGE - 1),
        older: MESSAGES - (SECOND_WINDOW - 1),
      });
      cpuBefore = cpuOf(executor.pid);
      const spacePage = `${app.url}/space/${spaceUrl.replace('neighbourhood://', '')}`;
      // Each call as name:limit:time@when-sent, both in ms from the start of the load.
      const said = (q) =>
        `${q.className ?? q.type}${q.limit === null ? '' : `:${q.limit}`}:${q.ms.toFixed(0)}@${q.sentAfterMs.toFixed(0)}`;
      for (let k = 0; k < RUNS; k++) {
        const kind = k === 0 ? 'cold' : 'warm';
        const from = queries.length;
        const t0 = performance.now();
        const t0Epoch = Date.now();
        current = { run: k + 1, kind, from, t0 };
        run.attempted = k + 1;
        if (k === 0) await page.goto(spacePage);
        else await page.reload();
        // The newest page: the newest seeded message on screen, and the 49th of the window in the
        // DOM. A run that never gets there is recorded with why (a refused feed call, or the
        // timeout) instead of ending the suite: a slow or refused load is a result.
        const drew = await waitForRow(page, queries, from, {
          timeout: PAGE_TIMEOUT,
          shown: async () =>
            (await row(page, MESSAGES - 1).isVisible()) && (await row(page, MESSAGES - (FIRST_PAGE - 1)).count()) > 0,
        });
        // When the suite saw it (or gave up), which trails the page by up to the polling interval.
        const noticed = performance.now() - t0;
        // `sentAfterMs`: how far into the load the page asked; the time before it is the app starting.
        const calls = () => queries.slice(from).map(({ sent, ...q }) => ({ ...q, sentAfterMs: sent - t0 }));
        if (!drew.drawn) {
          const mine = calls().filter((q) => q.feed);
          const failedCalls = mine.filter((q) => q.error);
          run.failedFeedCalls = (run.failedFeedCalls ?? 0) + failedCalls.length;
          run.newestFailures = [...(run.newestFailures ?? []), drew.kind];
          detail.runs.push({
            run: k + 1,
            kind,
            outcome: drew.kind,
            error: drew.error ?? null,
            waitedMs: noticed,
            newestMs: null,
            olderMs: null,
            queries: mine,
            calls: calls().length,
            unanswered: queries.unanswered().map((q) => ({ ...q, sent: undefined, sentAfterMs: q.sent - t0 })),
          });
          log(
            `run ${k + 1} (${kind}) did not draw the newest page in ${(noticed / 1_000).toFixed(1)} s: ` +
              `${drew.kind}${drew.error ? ` (${drew.error})` : ''}; ` +
              `feed calls ${mine.map(said).join(' ') || 'none seen'}`,
          );
          continue;
        }
        // When the page did it, by its own marks (`feedMarks`): the newest page's time.
        const marked = await page.evaluate(() => ({ ...window.__feedScaleMarks }));
        const since = (epoch) => (typeof epoch === 'number' ? epoch - t0Epoch : null);
        const marks = {
          domContentLoaded: since(marked.domContentLoaded),
          load: since(marked.load),
          newestAttached: since(marked.newestAttached),
          newestVisible: since(marked.newestVisible),
          lastAttached: since(marked.lastAttached),
        };
        assert.ok(
          marks.newestVisible !== null && marks.lastAttached !== null,
          `the page did not mark the newest page: ${JSON.stringify(marked)}`,
        );
        const newest = Math.max(marks.newestVisible, marks.lastAttached);
        // Nothing past the first window: the page is the window, not the space.
        const past = await row(page, MESSAGES - FIRST_PAGE - 10).count();
        assert.equal(past, 0, 'the newest page drew more than its window');

        const t1Epoch = Date.now();
        await scrollToOlderEdge(row(page, MESSAGES - (FIRST_PAGE - 1)));
        run.olderAttempted = (run.olderAttempted ?? 0) + 1;
        // The whole run's calls: the Feed may already have asked for this window before the scroll.
        const olderDrew = await waitForRow(page, queries, from, {
          timeout: PAGE_TIMEOUT,
          shown: async () => (await row(page, MESSAGES - (SECOND_WINDOW - 1)).count()) > 0,
        });
        const olderAt = await page.evaluate(() => window.__feedScaleMarks.olderAttached);
        let older = null;
        let olderOutcome = 'drawn';
        if (!olderDrew.drawn) {
          olderOutcome = olderDrew.kind;
          run.olderFailures = [...(run.olderFailures ?? []), olderDrew.kind];
          log(
            `run ${k + 1} (${kind}): the older page did not arrive: ${olderDrew.kind}${olderDrew.error ? ` (${olderDrew.error})` : ''}`,
          );
        } else {
          assert.equal(typeof olderAt, 'number', 'the page did not mark the older window');
          // The Feed may ask for the older window by itself before the scroll (README): then it is 0.
          older = Math.max(0, olderAt - t1Epoch);
          marks.olderAttached = since(olderAt);
        }

        const mine = calls().filter((q) => q.feed);
        run.newest.push(newest);
        if (older !== null) run.older.push(older);
        for (const q of mine) {
          if (q.error) {
            run.failedFeedCalls = (run.failedFeedCalls ?? 0) + 1;
            continue;
          }
          (q.className === 'TextBlock' ? run.queries : run.otherQueries).push(q.ms);
        }
        // The slowest of the page's other calls: what it may have waited on before the Feed asked.
        const slowest = calls()
          .filter((q) => !q.feed)
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 5);
        const phases = { ...loadPhases(calls(), marks), ...marks, noticed };
        detail.runs.push({
          run: k + 1,
          kind,
          outcome: 'drawn',
          newestMs: newest,
          olderMs: older,
          olderOutcome,
          olderBeforeScroll: olderAt !== undefined && olderAt < t1Epoch,
          phases,
          queries: mine,
          calls: calls().length,
          slowestOtherCalls: slowest,
        });
        log(
          `run ${k + 1} (${kind}): newest page ${newest.toFixed(0)} ms, ` +
            `older page ${older === null ? `not drawn (${olderOutcome})` : `${older.toFixed(0)} ms`}; ` +
            `feed queries ${mine.map(said).join(' ') || 'none seen'}; ` +
            `slowest of ${calls().length - mine.length} other calls ${slowest.map(said).join(' ')}`,
        );
        // Where the time went, in ms from the start of the load.
        const at = (n) => (n === null || n === undefined ? '-' : n.toFixed(0));
        log(
          `run ${k + 1} (${kind}) phases: loaded ${at(phases.load)}, first call ${at(phases.firstCall)}, ` +
            `Space answered ${at(phases.spaceAnswered)}, feed asked ${at(phases.feedAsked)} answered ` +
            `${at(phases.feedAnswered)}, ${phases.profiles} profiles answered ${at(phases.profilesAnswered)}, ` +
            `watch registered ${at(phases.watchRegistered)}, newest attached ${at(phases.newestAttached)} ` +
            `visible ${at(phases.newestVisible)}, 49th attached ${at(phases.lastAttached)}, ` +
            `locators noticed ${at(noticed)}`,
        );
        assert.ok(
          mine.some((q) => q.className === 'TextBlock' && !q.error),
          'the page made no Feed query this run',
        );
      }
    } catch (error) {
      if (current) {
        // What the failed run asked, and what it was still waiting on when it gave up.
        const since = (q) => ({ ...q, sent: undefined, sentAfterMs: q.sent - current.t0 });
        detail.failedRun = {
          run: current.run,
          kind: current.kind,
          answered: queries.slice(current.from).map(since),
          unanswered: queries.unanswered().map(since),
        };
        const said = (q) =>
          `${q.className ?? q.type}${q.limit === null ? '' : `:${q.limit}`}@${q.sentAfterMs.toFixed(0)}` +
          `${q.error ? '!' : ''}${q.rows === undefined || q.rows === null ? '' : `=${q.rows}`}`;
        const answeredFeed = detail.failedRun.answered.filter((q) => q.feed).map(said);
        log(
          `run ${current.run} (${current.kind}) failed; feed calls answered ` +
            `${answeredFeed.join(' ') || 'none'}; ` +
            `unanswered ${detail.failedRun.unanswered.map(said).join(' ') || 'none'}`,
        );
      }
      await closing(reader, true);
      throw error;
    }
    const cpuAfter = cpuOf(executor.pid);
    if (cpuBefore !== null && cpuAfter !== null) run.cpu.uiPhase = cpuAfter - cpuBefore;
    await closing(reader, false);
    const afterUi = rssOf(executor.pid);
    run.rss.afterUi = afterUi.rss;
    run.rss.peak = peakOf(afterUi);
    // The app's watch, registered again when the space opened: what the executor now runs.
    detail.watch.afterUi = await watchesIn(perspective);
    run.cpu.idleAfterUi = await idleCpuPercent(executor.pid, IDLE_SECONDS);
    log(
      `executor CPU: ${run.cpu.uiPhase?.toFixed(1)} s over the loads; idle after them ` +
        `${run.cpu.idleAfterUi?.toFixed(1)}% of a core, with auto-processor(s) ${detail.watch.afterUi.join(', ') || 'none'}`,
    );

    // The executor's answer to the same query from outside the page, for comparing with it.
    await askDirect(FIRST_PAGE, 'after loads');
    await askDirect(SECOND_WINDOW, 'after loads');
    status = 'passed';
  } finally {
    if (executor && (run.rss.afterUi === undefined || run.rss.afterUi === null)) {
      const now = rssOf(executor.pid);
      run.rss.peak = peakOf(now);
    }
    const doc = {
      job: JOB,
      status,
      summary: summaryLine(run, status),
      metrics: metrics(run),
      detail: { ...detail, run },
    };
    writeFileSync(join(ARTIFACTS, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
    // The same metrics alone, as `scripts/perf/record` reads a results file (`{"metrics": [...]}`):
    // beside results.json, and in `PERF_RESULTS_DIR` when the job gives one.
    const perf = `${JSON.stringify({ metrics: doc.metrics }, null, 2)}\n`;
    writeFileSync(join(ARTIFACTS, 'metrics.json'), perf);
    if (process.env.PERF_RESULTS_DIR) {
      mkdirSync(process.env.PERF_RESULTS_DIR, { recursive: true });
      writeFileSync(join(process.env.PERF_RESULTS_DIR, `${JOB}.json`), perf);
    }
    await browser?.close().catch(() => {});
    await app?.close().catch(() => {});
    if (executor) {
      try {
        writeFileSync(join(ARTIFACTS, 'executor.log'), executor.output.join(''));
      } catch (error) {
        log(`could not write the executor log: ${error.message}`);
      }
      executor.admin.close?.();
      await executor.stop().catch(() => {});
    }
    log(`artifacts in ${ARTIFACTS}`);
    console.log(summaryLine(run, status));
  }
});
