/**
 * The Feed of a space holding a million messages: how long the newest page and the page before it take
 * to appear, how long the executor takes to answer the Feed's query while they load, and what the
 * executor holds in memory to do it. See README.md for what is measured, and how, and why.
 *
 * One test, in order — each step stands on the one before:
 *
 * 1. An executor, the built app, Chromium (`@we/e2e`), and one account.
 * 2. A shared space made in the app, and one line typed into its Feed — the message every seeded one
 *    is a copy of (`seed.mjs`, `messageShape`).
 * 3. The seeding: every link generated already signed into a file on worker threads, then loaded by
 *    the executor's `runtime.importData`, with the browser closed and the space's auto-processor
 *    (the app's standing watch) removed for it. Then a check that what the Feed will read is what
 *    was meant: the newest message's flag link is the seeded author's, at the seeded time, verified;
 *    and the executor's own answer to the Feed's query is newest first. Then the executor's idle
 *    CPU over a quiet spell.
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
 * | `FEED_SCALE_WORKERS` | `os.availableParallelism()` | worker threads the links file is generated on |
 * | `FEED_SCALE_PAGE_TIMEOUT` | 600000 | how long one page may take to appear, and the suite's own Feed query from outside the page, ms |
 * | `FEED_SCALE_IDLE_SECONDS` | 30 | each quiet spell the executor's idle CPU is read over (after the seeding, after the loads) |
 *
 * The executor keeps its data under `$TMPDIR` (`@we/e2e`'s data directory): at a million messages
 * that is tens of gigabytes, so point `TMPDIR` at a disk that has them.
 *
 * A slow answer is a result, not a failure: a run whose page never draws is recorded with why it
 * could not — the executor refusing the page's feed call (its SPARQL eval deadline,
 * `query_deadline_secs`, 30 s on `dev`, kills a query it cannot answer in time: the page then has
 * nothing to draw) or the timeout passing — in `detail.runs[].outcome` and in the
 * `feed.*_page.failures` metrics, and the run goes on to the next load.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { LinkQuery } from '@coasys/ad4m';
import * as h from '@we/e2e';

import { createSpace, dismissNamePrompt, openSpace } from '../steps/space.mjs';
import {
  JOB,
  MESSAGE_CLASS,
  cpuSeconds,
  idleAfterLoadsSkipped,
  loadPhases,
  memory,
  metrics,
  summaryLine,
} from './results.mjs';
import { PROCESSOR_ID, messageShape, processorIds, seedMessages } from './seed.mjs';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

const env = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name}=${raw} is not a positive whole number`);
  return n;
};

const MESSAGES = env('FEED_SCALE_MESSAGES', 1_000_000);
const RUNS = env('FEED_SCALE_RUNS', 5);
const WORKERS = env('FEED_SCALE_WORKERS', availableParallelism());
const PAGE_TIMEOUT = env('FEED_SCALE_PAGE_TIMEOUT', 600_000);
const IDLE_SECONDS = env('FEED_SCALE_IDLE_SECONDS', 30);
const ARTIFACTS = process.env.FEED_SCALE_ARTIFACTS
  ? resolve(process.env.FEED_SCALE_ARTIFACTS)
  : mkdtempSync(join(tmpdir(), 'feed-scale-'));
mkdirSync(ARTIFACTS, { recursive: true });

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
        // Replaced before it was seen: look for the replacement now, which may already be in the
        // document, rather than wait for a later mutation that may never come.
        found.newestVisible = null;
        scan(document.body);
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
  await h.sleep(seconds * 1_000);
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
  // The load a call belongs to: a reply can arrive in a later load's window than the one that sent
  // it (the old socket takes a moment to close), and must not land in that load's numbers.
  // `next()` marks the start of a load; `seen.load` is its generation.
  seen.load = 0;
  seen.next = () => ++seen.load;
  // Calls asked and not yet answered, by socket: what a stuck load is still waiting on. One map per
  // socket, not one keyed by URL — the SDK can abandon a socket and reconnect to the same URL while
  // the old one is still closing, and the old one's close must not drop the replacement's calls.
  const pendingBySocket = new Map();
  seen.unanswered = () => [...pendingBySocket.values()].flatMap((pending) => [...pending.values()]);
  page.on('websocket', (ws) => {
    // A reload closes the socket; what it never answered is no longer anything the page waits on.
    const pending = new Map();
    pendingBySocket.set(ws, pending);
    ws.on('close', () => pendingBySocket.delete(ws));
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
        load: seen.load,
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
      pending.set(message.id, asked);
    });
    ws.on('framereceived', ({ payload }) => {
      let message;
      try {
        message = JSON.parse(String(payload));
      } catch {
        return;
      }
      const asked = pending.get(message.id);
      if (!asked) return;
      pending.delete(message.id);
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
        load: asked.load,
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
  loads: RUNS,
  seed: null,
  newest: [],
  newestCold: null,
  older: [],
  queries: [],
  otherQueries: [],
  cpu: {},
  rss: {},
};
const detail = { runs: [], seed: null, direct: [], settings: {}, watch: {} };

/** An error frame's message, whatever shape it took. */
const errText = (e) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e)));

/**
 * Waits for a part of the page to draw, watching the run's own calls meanwhile. Resolves
 * `{drawn: true}` when `shown()` holds. Ends early, `{drawn: false, kind, error}`, when the page
 * can never get there however long the wait: the executor refused a feed call of this run —
 * its SPARQL eval deadline (`query_deadline_secs`) kills a query it cannot answer in time, so the
 * page has nothing to draw and the refusal, not a missing row, is what the run measured — or the
 * page closed. `kind` is `timeout` when the wait ran out with neither.
 *
 * Only this load generation's calls are watched (`load`), and a refusal counts only when it is of
 * the window being waited on (`limit`): the Feed asks for the 150-row window itself just after the
 * first draw, so its call can be refused while the newest window is still being waited on — that is
 * the older window's failure, not the newest's.
 */
async function waitForRow(page, queries, load, { shown, timeout, pollMs = 250, limit }) {
  const deadline = performance.now() + timeout;
  for (;;) {
    if (page.isClosed()) return { drawn: false, kind: 'page-closed' };
    const refused = queries.find(
      (q) =>
        q.load === load &&
        q.feed &&
        q.className === MESSAGE_CLASS &&
        q.error &&
        (q.limit === null || q.limit === limit),
    );
    if (refused) return { drawn: false, kind: 'feed-call-refused', error: errText(refused.error) };
    if (await shown().catch(() => false)) return { drawn: true };
    if (performance.now() >= deadline) return { drawn: false, kind: 'timeout' };
    await h.sleep(pollMs);
  }
}

test(`feed-scale: the Feed of a space with ${MESSAGES} messages`, { timeout: 6 * 3_600_000 }, async (t) => {
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
    executor = await h.startExecutor();
    app = await h.serveDist(DIST);
    browser = await h.launchBrowser();
    detail.settings = { messages: MESSAGES, runs: RUNS, workers: WORKERS };

    let account;
    let shape;
    let spaceUrl;
    let perspective;
    let seeded = null;
    account = await h.signUp(executor, 'reader@feed-scale.test');

    // 2. The space, and the one line every seeded message is a copy of.
    const writer = await h.device(browser, executor, account, { name: 'writer' });
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
      // The Feed draws a sent line before its write lands: wait for the line and its place in a
      // collection to be stored.
      const { links, text, placed } = await h.until(
        async () => {
          const links = await perspective.get(new LinkQuery({}));
          const text = links.find((l) => l.data.predicate === 'we://text' && l.data.target.includes('every%20seeded'));
          const placed =
            text && links.find((l) => l.data.predicate === 'ad4m://has_child' && l.data.target === text.data.source);
          return { links, text, placed };
        },
        (stored) => stored.placed,
        { what: 'the typed line and its place in a collection to be stored' },
      );
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
      opens. But while it is registered, the executor's tick re-reads every message it covers twice
      a second — a read that grows with the store and would run on top of the import. The seeding
      is setup, not what is measured, so it runs without it.
    */
    const removed = await watchesIn(perspective);
    for (const id of removed) await perspective.removeAutoProcessor(id);
    detail.watch.removedBeforeSeed = removed;
    log(`removed ${removed.length} auto-processor(s) for the seeding: ${removed.join(', ') || 'none'}`);

    // 3. The seeding: every link generated already signed into a file under $TMPDIR (not
    // ARTIFACTS: a run stopped mid-import must not leave gigabytes for CI to upload), then
    // loaded into the perspective by `runtime.importData`. The call is operator-only, so it goes
    // as the executor's admin credential on the suite's own socket (writer.mjs, no client-side
    // timeout) — it can run for many minutes at a million messages. The test's own budget bounds it:
    // `t.signal` aborts at the test timeout, the import rejects, and the `finally` below still stops
    // the executor (which deletes its data) after the seed file is gone.
    log(`seeding ${MESSAGES} messages (${WORKERS} generation workers)`);
    seeded = await seedMessages({
      url: executor.url,
      token: executor.adminCredential,
      uuid: perspective.uuid,
      shape,
      count: MESSAGES,
      workers: WORKERS,
      onProgress: (written, count) => log(`generated links for ${written}/${count}`),
      signal: t.signal,
    });
    // Nothing should have registered one meanwhile (no page was open). If one did, the seed timings
    // are not the seeding's own and the idle read below is not a watch-off one: neither is published
    // as the metric it would mislabel — a partial run never sets a baseline it did not earn.
    detail.watch.afterSeed = await watchesIn(perspective);
    const seedRanWatchFree = detail.watch.afterSeed.length === 0;
    if (!seedRanWatchFree) log(`warning: auto-processor(s) registered during the seeding: ${detail.watch.afterSeed}`);
    if (seedRanWatchFree)
      run.seed = { generateSeconds: seeded.generateSeconds, importSeconds: seeded.importSeconds, links: seeded.links };
    detail.seed = { ...seeded, authors: seeded.authors.length };
    const afterSeed = rssOf(executor.pid);
    run.rss.afterSeed = afterSeed.rss;
    log(
      `generated ${seeded.messages} messages (${seeded.links} links) in ${seeded.generateSeconds.toFixed(1)} s, ` +
        `imported in ${seeded.importSeconds.toFixed(1)} s` +
        ` (${seeded.imported} imported, ${seeded.skipped} skipped); ` +
        `executor ${afterSeed.rss?.toFixed(0)} MiB`,
    );

    // What the Feed will read is what was meant: the newest message's flag is its seeded author's,
    // at its seeded time, verified.
    const flagQuery = new LinkQuery({ source: seeded.newest.id, predicate: 'we://flag' });
    let flag;
    const flagWait = performance.now();
    while (!(flag = (await perspective.get(flagQuery))[0]) && performance.now() - flagWait < PAGE_TIMEOUT) {
      await h.sleep(2_000);
    }
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
    const instances = await askDirect(FIRST_PAGE, 'after seed');
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

    // A probe that did not answer may still be running in the executor, so the spell would not be idle.
    if (seedRanWatchFree && instances) {
      run.cpu.idleAfterSeed = await idleCpuPercent(executor.pid, IDLE_SECONDS);
      log(`executor idle after the seeding: ${run.cpu.idleAfterSeed?.toFixed(1)}% of a core over ${IDLE_SECONDS} s`);
    } else {
      log(
        `executor idle after the seeding not measured: ${
          seedRanWatchFree ? 'the direct probe did not answer' : 'an auto-processor is registered'
        }`,
      );
    }

    // 4. The loads.
    // The run under way, so a failure can say what it asked and what it never heard back.
    let current = null;
    // The executor's CPU seconds when the loads begin.
    let cpuBefore = null;
    // The calls of the page that is open, as the executor answered them. Declared beside `current`
    // because the catch below reads them when a run fails; a page that closes during a run is
    // replaced, and the replacement is watched the same way.
    let page = null;
    let queries = null;
    const reader = await h.device(browser, executor, account, { name: 'reader' });
    const openReaderPage = async () => {
      page = await reader.tab('main');
      pages.set('reader', page);
      await page.addLocatorHandler(page.getByRole('textbox', { name: 'Name...', exact: true }), () =>
        dismissNamePrompt(page, 'Reader'),
      );
      queries = watchFeedQueries(page, shape.root);
      await page.addInitScript(feedMarks, {
        newest: MESSAGES - 1,
        last: MESSAGES - (FIRST_PAGE - 1),
        older: MESSAGES - (SECOND_WINDOW - 1),
      });
    };
    // What a run's answered feed calls measured: each reply's round trip joins the executor query
    // metrics, by class; a refused one counts as a failure and is not a latency sample. Runs once
    // per load, on either outcome — a load that never drew may still hold completed calls.
    const tally = (mine) => {
      for (const q of mine) {
        if (q.error) {
          run.failedFeedCalls = (run.failedFeedCalls ?? 0) + 1;
          continue;
        }
        (q.className === MESSAGE_CLASS ? run.queries : run.otherQueries).push(q.ms);
      }
    };
    // The calls already in the numbers, as `watchFeedQueries` keeps them.
    const counted = new WeakSet();
    // The numbers of load `load` are taken: its calls answered so far are counted.
    const taken = (load) => {
      for (const q of queries) if (q.load === load) counted.add(q);
    };
    // A reply that came after its load gave up on it (before that tab's socket closed) is still that
    // load's: counted once, with it, and listed in its detail as `late`. Run between loads and after
    // the reader closes, over the loads up to `upTo` that have an outcome. A replacement tab numbers
    // its loads from 1 again, and this only reads the open tab's calls: their load is the newest
    // entry with that number.
    const tallyLate = (upTo = queries?.load ?? 0) => {
      const late = (queries ?? []).filter((q) => q.feed && !counted.has(q) && q.load <= upTo);
      tally(late);
      for (const q of late) {
        counted.add(q);
        const entry = detail.runs.findLast((r) => r.load === q.load);
        if (entry) (entry.late ??= []).push({ ...q, sent: undefined });
      }
    };
    try {
      await openReaderPage();
      cpuBefore = cpuOf(executor.pid);
      const spacePage = `${app.url}/space/${spaceUrl.replace('neighbourhood://', '')}`;
      // Each call as name:limit:time@when-sent, both in ms from the start of the load.
      const said = (q) =>
        `${q.className ?? q.type}${q.limit === null ? '' : `:${q.limit}`}:${q.ms.toFixed(0)}@${q.sentAfterMs.toFixed(0)}`;
      for (let k = 0; k < RUNS; k++) {
        const kind = k === 0 ? 'cold' : 'warm';
        current = null;
        // A run whose page closed is followed by a fresh tab, instrumented the same. It has nothing
        // loaded to reload, so it navigates as the first run did: `page-closed` stays a recorded
        // load outcome, not the end of the suite.
        const replacement = page.isClosed();
        tallyLate();
        if (replacement) await openReaderPage();
        // A new load generation: a call still unanswered when the last load gave up answers into
        // the old generation, and never lands in this load's numbers.
        const load = queries.next();
        const t0 = performance.now();
        const t0Epoch = Date.now();
        current = { run: k + 1, kind, load, t0 };
        // Navigation and the newest-page wait share the page's budget: a document whose load event
        // stalls until the budget is spent is the run's `timeout` outcome. A page that closes under
        // the navigation is a load outcome, as it is during the wait below; any other navigation
        // error ends the suite.
        let drew = null;
        try {
          if (k === 0 || replacement) await page.goto(spacePage, { timeout: PAGE_TIMEOUT });
          else await page.reload({ timeout: PAGE_TIMEOUT });
        } catch (e) {
          if (page.isClosed()) drew = { drawn: false, kind: 'page-closed', error: e.message };
          else if (e.name === 'TimeoutError') drew = { drawn: false, kind: 'timeout', error: e.message };
          else throw e;
        }
        // The newest page: the newest seeded message on screen, and the 49th of the window in the
        // DOM — and the page's own marks for both, which are what the newest time is calculated
        // from. A run that never gets there is recorded with why (a refused feed call, or the
        // timeout) instead of ending the suite: a slow or refused load is a result.
        drew ??= await waitForRow(page, queries, load, {
          timeout: Math.max(0, t0 + PAGE_TIMEOUT - performance.now()),
          limit: FIRST_PAGE,
          shown: async () =>
            (await row(page, MESSAGES - 1).isVisible()) &&
            (await row(page, MESSAGES - (FIRST_PAGE - 1)).count()) > 0 &&
            (await page.evaluate(
              () =>
                window.__feedScaleMarks?.newestVisible !== undefined &&
                window.__feedScaleMarks?.lastAttached !== undefined,
            )),
        });
        // When the suite saw it (or gave up), which trails the page by up to the polling interval.
        const noticed = performance.now() - t0;
        // `sentAfterMs`: how far into the load the page asked; the time before it is the app starting.
        const calls = () =>
          queries.filter((q) => q.load === load).map(({ sent, ...q }) => ({ ...q, sentAfterMs: sent - t0 }));
        // The marks the newest time is read from live in the page: a tab that closed between the
        // wait and here leaves the load its outcome — page-closed.
        let marked = null;
        if (drew.drawn) {
          try {
            marked = await page.evaluate(() => ({ ...window.__feedScaleMarks }));
          } catch (e) {
            if (!page.isClosed()) throw e;
            drew = { drawn: false, kind: 'page-closed', error: e.message };
          }
        }
        if (!drew.drawn) {
          const mine = calls().filter((q) => q.feed);
          tally(mine);
          taken(load);
          run.attempted = k + 1;
          run.newestFailures = [...(run.newestFailures ?? []), drew.kind];
          detail.runs.push({
            run: k + 1,
            load,
            kind,
            outcome: drew.kind,
            error: drew.error ?? null,
            waitedMs: noticed,
            newestMs: null,
            olderMs: null,
            queries: mine,
            calls: calls().length,
            unanswered: queries
              .unanswered()
              .filter((q) => q.load === load)
              .map((q) => ({ ...q, sent: undefined, sentAfterMs: q.sent - t0 })),
          });
          log(
            `run ${k + 1} (${kind}) did not draw the newest page in ${(noticed / 1_000).toFixed(1)} s: ` +
              `${drew.kind}${drew.error ? ` (${drew.error})` : ''}; ` +
              `feed calls ${mine.map(said).join(' ') || 'none seen'}`,
          );
          continue;
        }
        // When the page did it, by its own marks (`feedMarks`): the newest page's time.
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

        const t1Epoch = Date.now();
        let olderAt;
        let older = null;
        let olderOutcome = 'drawn';
        let olderError = null;
        try {
          await scrollToOlderEdge(row(page, MESSAGES - (FIRST_PAGE - 1)));
          // The whole run's calls: the Feed may already have asked for this window before the
          // scroll. A refusal of it is this window's failure, and only its (`limit`).
          const olderDrew = await waitForRow(page, queries, load, {
            timeout: PAGE_TIMEOUT,
            limit: SECOND_WINDOW,
            shown: async () =>
              (await row(page, MESSAGES - (SECOND_WINDOW - 1)).count()) > 0 &&
              (await page.evaluate(() => typeof window.__feedScaleMarks?.olderAttached === 'number')),
          });
          if (!olderDrew.drawn) {
            // The mark is read only on a drawn page: after a close there is no page to read it from.
            olderOutcome = olderDrew.kind;
            olderError = olderDrew.error;
          } else {
            olderAt = await page.evaluate(() => window.__feedScaleMarks.olderAttached);
            assert.equal(typeof olderAt, 'number', 'the page did not mark the older window');
            // The Feed may ask for the older window by itself before the scroll (README): then it is 0.
            older = Math.max(0, olderAt - t1Epoch);
            marks.olderAttached = since(olderAt);
          }
        } catch (e) {
          // The newest time is already known: a tab closed under the older phase keeps it and
          // records the older phase as page-closed; anything else ends the suite.
          if (!page.isClosed()) throw e;
          olderOutcome = 'page-closed';
          olderError = e.message;
        }
        run.olderAttempted = (run.olderAttempted ?? 0) + 1;
        if (olderOutcome !== 'drawn') {
          run.olderFailures = [...(run.olderFailures ?? []), olderOutcome];
          log(
            `run ${k + 1} (${kind}): the older page did not arrive: ${olderOutcome}${olderError ? ` (${olderError})` : ''}`,
          );
        }

        const mine = calls().filter((q) => q.feed);
        run.newest.push(newest);
        // The cold load's own time, kept apart: when the cold load never draws, no warm reload's
        // time may be reported as it (`feed.newest_page.cold` in `results.mjs`).
        if (kind === 'cold') run.newestCold = newest;
        if (older !== null) run.older.push(older);
        tally(mine);
        taken(load);
        run.attempted = k + 1;
        // The slowest of the page's other calls: what it may have waited on before the Feed asked.
        const slowest = calls()
          .filter((q) => !q.feed)
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 5);
        const phases = { ...loadPhases(calls(), marks), ...marks, noticed };
        detail.runs.push({
          run: k + 1,
          load,
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
          mine.some((q) => q.className === MESSAGE_CLASS && !q.error),
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
          answered: (queries ?? []).filter((q) => q.load === current.load).map(since),
          unanswered: (queries?.unanswered?.() ?? []).filter((q) => q.load === current.load).map(since),
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
      // Only loads with an outcome take their late replies: the failed one, too, when it recorded its
      // outcome before it failed (`run.attempted` is set with the outcome).
      tallyLate(current && run.attempted !== current.run ? current.load - 1 : undefined);
      throw error;
    }
    const cpuAfter = cpuOf(executor.pid);
    // Closing the reader's socket does not stop the queries the executor is still answering for it:
    // count them before it closes (a closed socket's calls leave `unanswered`).
    const unanswered = queries.unanswered();
    await closing(reader, false);
    tallyLate();
    const afterUi = rssOf(executor.pid);
    run.rss.afterUi = afterUi.rss;
    run.rss.peak = peakOf(afterUi);
    // The app's watch, registered again when the space opened: what the executor now runs.
    detail.watch.afterUi = await watchesIn(perspective);
    // The CPU numbers are the watch-on ones: published only when the app really did register its
    // watch again — a load that completed with no watch running must not set them.
    const watchOn = detail.watch.afterUi.length > 0;
    if (watchOn) {
      if (cpuBefore !== null && cpuAfter !== null) run.cpu.uiPhase = cpuAfter - cpuBefore;
      const skipped = idleAfterLoadsSkipped(run, unanswered);
      if (skipped) log(`executor idle after the loads not measured: ${skipped}`);
      else run.cpu.idleAfterUi = await idleCpuPercent(executor.pid, IDLE_SECONDS);
    }
    log(
      `executor CPU: ${run.cpu.uiPhase?.toFixed(1) ?? 'not counted'} s over the loads; idle after them ` +
        `${run.cpu.idleAfterUi?.toFixed(1) ?? 'not measured'}% of a core, ` +
        `with auto-processor(s) ${detail.watch.afterUi.join(', ') || 'none'}`,
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
    try {
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
      h.writeMetrics({ dir: ARTIFACTS, job: JOB, metrics: doc.metrics });
      log(`artifacts in ${ARTIFACTS}`);
    } finally {
      // The browser, the server and the executor go away however writing the artifacts went.
      await browser?.close().catch(() => {});
      await app?.close().catch(() => {});
      if (executor) {
        try {
          writeFileSync(join(ARTIFACTS, 'executor.log'), executor.log());
        } catch (error) {
          log(`could not write the executor log: ${error.message}`);
        }
        executor.admin.close?.();
        await executor.stop().catch(() => {});
      }
    }
    console.log(summaryLine(run, status));
  }
});
