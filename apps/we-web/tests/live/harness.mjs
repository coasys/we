/**
 * What the live web tests stand on: a multi-user executor, accounts on it, the built web app served,
 * and Chromium with a fake camera and microphone.
 *
 * Each piece is what a person's setup has, run on one machine: the executor is the one WE pins
 * (`scripts/ad4m-executor.mjs`, or `AD4M_EXECUTOR`), started in multi-user mode as a hosted node
 * is; the app is `apps/we-web/dist`, the build `pnpm build:web` writes; and a browser context is a
 * browser profile — one device. Two pages in one context are two tabs of that device, sharing its
 * `localStorage` (where the device id lives) and its `BroadcastChannel`s.
 *
 * Isolated from anything else on the machine: a fresh data directory, free ports, and no
 * bootstrap, proxy or mDNS, so the executor never joins a network.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ad4mClient } from '@coasys/ad4m';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..', '..');
const ROOT = resolve(WEB, '..', '..');
const DIST = join(WEB, 'dist');

export function freePort() {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rejects after `ms`: a call whose socket never opened neither resolves nor rejects. */
function within(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, fail) => setTimeout(() => fail(new Error(`${what}: no answer in ${ms}ms`)), ms)),
  ]);
}

function executorBinary() {
  const chosen = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ad4m-executor.mjs'), '--path'], {
    encoding: 'utf8',
  });
  if (chosen.status !== 0) throw new Error(`Could not work out which executor to run:\n${chosen.stderr}`);
  const binary = chosen.stdout.trim();
  if (!existsSync(binary)) {
    throw new Error(`No executor at ${binary}. Run \`pnpm ad4m:executor\`, or set AD4M_EXECUTOR.`);
  }
  return binary;
}

/**
 * A multi-user executor with its main agent made — which a hosted node needs before anyone can
 * sign up, since the main agent signs every user's token.
 */
export async function startExecutor({ mcp = false } = {}) {
  const binary = executorBinary();
  const dataPath = mkdtempSync(join(tmpdir(), 'we-live-web-'));
  const [port, hcAdminPort, hcAppPort] = [await freePort(), await freePort(), await freePort()];
  const mcpPort = mcp ? await freePort() : null;
  const adminCredential = randomUUID();
  const output = [];

  const init = spawnSync(binary, ['init', '--data-path', dataPath], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`ad4m-executor init failed: ${init.stderr || init.error}`);

  // prettier-ignore
  const child = spawn(binary, [
    'run', '--app-data-path', dataPath, '--port', String(port),
    '--admin-credential', adminCredential, '--enable-multi-user', 'true',
    '--hc-admin-port', String(hcAdminPort), '--hc-app-port', String(hcAppPort),
    '--hc-use-bootstrap', 'false', '--hc-use-proxy', 'false', '--hc-use-local-proxy', 'false',
    '--hc-use-mdns', 'false', '--run-dapp-server', 'false',
    ...(mcpPort ? ['--enable-mcp', 'true', '--mcp-port', String(mcpPort)] : []),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  let exit = null;
  const exited = new Promise((done) =>
    child.on('exit', (code, signal) => {
      exit = `code ${code}, signal ${signal}`;
      done();
    }),
  );
  const orphanGuard = () => child.kill('SIGKILL');
  process.once('exit', orphanGuard);

  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    process.off('exit', orphanGuard);
    if (exit === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(10_000)]);
      if (exit === null) child.kill('SIGKILL');
      await exited;
    }
    if (process.env.WE_LIVE_LOG) writeFileSync(process.env.WE_LIVE_LOG, output.join(''));
    rmSync(dataPath, { recursive: true, force: true });
  };

  try {
    const deadline = Date.now() + 120_000;
    let admin;
    for (;;) {
      if (exit) throw new Error(`The executor exited before it was ready: ${exit}`);
      const client = new Ad4mClient(url, adminCredential);
      try {
        await within(client.agent.status(), 3_000, 'agent.status');
        admin = client;
        break;
      } catch {
        client.close?.();
        if (Date.now() > deadline) throw new Error('The executor did not answer within two minutes.');
        await sleep(1_000);
      }
    }
    const status = await admin.agent.status();
    if (!status.isInitialized) await within(admin.agent.generate('we-live'), 120_000, 'agent.generate');
    const mcpUrl = mcpPort ? `http://127.0.0.1:${mcpPort}/mcp` : undefined;
    return { url, admin, output, stop, mcpUrl };
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n--- executor output ---\n${output.join('').slice(-8_000)}`);
  }
}

/** An account on the executor, signed in: what ad4m-connect's email and password screen ends with. */
export async function signUp(executor, email, password = 'test123') {
  await within(executor.admin.agent.createUser(email, password), 120_000, 'agent.createUser');
  await executor.admin.runtime.setUserFreeAccess?.(email, true);
  const token = await within(executor.admin.agent.loginUser(email, password), 60_000, 'agent.loginUser');
  const client = new Ad4mClient(executor.url, token);
  const { did } = await client.agent.me();
  return { email, password, token, did, client };
}

/**
 * Makes an OpenAI-compatible endpoint the executor's default language model — the one call
 * extraction runs on. Needs the admin client: the default is the executor's, not one account's.
 * Resolves with the model's id.
 */
export async function registerLlm(admin, { name = 'we-live-llm', baseUrl, apiKey = 'none', model }) {
  const id = await within(
    admin.ai.addModel({ name, modelType: 'LLM', api: { baseUrl, apiKey, model, apiType: 'OPEN_AI' } }),
    60_000,
    'ai.addModel',
  );
  await within(admin.ai.setDefaultModel('LLM', id), 30_000, 'ai.setDefaultModel');
  return id;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** `apps/we-web/dist`, as `vite preview` serves it: a file when there is one, else the app. */
export async function serveApp() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`No web build at ${DIST}. Run \`pnpm build:web\` first.`);
  }
  const index = readFileSync(join(DIST, 'index.html'));
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST, path);
    if (file.startsWith(DIST) && existsSync(file) && extname(file)) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(index);
  });
  const port = await freePort();
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) };
}

function chromePath() {
  const candidates = [
    process.env.WE_CHROME,
    (() => {
      try {
        return chromium.executablePath();
      } catch {
        return undefined;
      }
    })(),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('No Chromium. Set WE_CHROME to one.');
  return found;
}

/**
 * Chromium with a fake camera and microphone. `fakeAudio` names a WAV file the fake microphone plays
 * instead of its beep: 16 kHz mono PCM is what transcription hears best.
 */
export async function launchBrowser({ fakeAudio } = {}) {
  return chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      ...(fakeAudio ? [`--use-file-for-fake-audio-capture=${fakeAudio}`] : []),
    ],
  });
}

/**
 * ad4m-connect keeps its session under its own version: `<version>/ad4m-url`, `<version>/ad4m-token`.
 * `WE_CONNECT_VERSION` names it when the build under test bundles an ad4m-connect other than the
 * installed one — a local ad4m checkout, before it is published.
 */
function connectVersion() {
  if (process.env.WE_CONNECT_VERSION) return process.env.WE_CONNECT_VERSION;
  return JSON.parse(readFileSync(join(WEB, 'node_modules', '@coasys', 'ad4m-connect', 'package.json'), 'utf8')).version;
}

/**
 * One device: a browser profile signed in as `account`, as ad4m-connect leaves one after its
 * "Remote node" screen. Pages opened from it are that device's tabs.
 */
export async function device(browser, executor, account, { name } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.grantPermissions(['camera', 'microphone']);
  const version = connectVersion();
  await context.addInitScript(
    ([version, url, token]) => {
      if (localStorage.getItem(`${version}/ad4m-token`)) return;
      localStorage.setItem(`${version}/ad4m-url`, url);
      localStorage.setItem(`${version}/ad4m-token`, token);
    },
    [version, executor.url, account.token],
  );
  // Every peer connection a page makes, so a test can ask whether a tab still holds one.
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    const made = [];
    window.__wePeerConnections = made;
    window.RTCPeerConnection = class extends Native {
      constructor(...args) {
        super(...args);
        made.push(this);
      }
    };
  });
  const logs = [];
  const tab = async (label) => {
    const page = await context.newPage();
    const tag = `${name ?? account.email}/${label}`;
    page.on('console', (msg) => logs.push(`[${tag}] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[${tag}] pageerror: ${err.message}`));
    return page;
  };
  return { context, tab, logs, close: () => context.close() };
}

/** How many of a page's peer connections are not closed. */
export function openConnections(page) {
  return page.evaluate(() => (window.__wePeerConnections ?? []).filter((pc) => pc.connectionState !== 'closed').length);
}

/**
 * The page's video elements showing a stream, each with how many frames it decoded over `ms`.
 * Shadow roots included: the call's tiles sit inside components.
 */
export function videoFlow(page, ms = 2_000) {
  return page.evaluate(async (ms) => {
    const videos = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'VIDEO' && el.srcObject) videos.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    const frames = () => videos.map((v) => v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0);
    const before = frames();
    await new Promise((done) => setTimeout(done, ms));
    return frames().map((n, i) => ({ width: videos[i].videoWidth, frames: n - before[i] }));
  }, ms);
}

/** Polls `read` until `accept` holds for what it returns, or throws with the last value. */
export async function until(read, accept, { timeout = 60_000, interval = 500, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (error) {
      last = `threw: ${error.message}`;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}. Last: ${JSON.stringify(last, null, 1)?.slice(0, 2_000)}`);
    }
    await sleep(interval);
  }
}
