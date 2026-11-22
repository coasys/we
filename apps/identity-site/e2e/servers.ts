/**
 * The network around the frame in the browser tests, as real HTTP and WebSocket servers on local
 * ports: the site (the built `dist-e2e` with its `_headers` applied), the registry, the identity
 * store, an executor, and the page of an embedding app on its own origin.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { WebSocketServer } from 'ws';

import { parseHeaders } from '../headers.ts';
import { FakeExecutor, fakeRegistry, FakeStore, world } from '../tests/fakes.ts';
import { loadWasm } from '../tests/wasm.ts';

export const PORTS = { site: 4400, platform: 4401, store: 4402, executor: 4403, app: 4410, stranger: 4411 };
export const SITE = `http://127.0.0.1:${PORTS.site}`;
export const APP_ORIGIN = `http://localhost:${PORTS.app}`;
export const STRANGER_ORIGIN = `http://localhost:${PORTS.stranger}`;
/** What the person's device lists as its executor, and what the frame answers an app with. */
export const EXECUTOR = world.executorAddress;
/** The same place as the origin the frame signs into a statement's `audience`. */
export const EXECUTOR_ORIGIN = `http://127.0.0.1:${PORTS.executor}`;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

function listen(port: number, handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** A Fetch-style handler as a Node listener, with CORS for the frame's calls from another origin. */
function adapt(handle: (request: Request) => Promise<Response>): http.RequestListener {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return void res.writeHead(204, CORS).end();
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const response = await handle(
      new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: body.length && req.method !== 'GET' ? body : undefined,
      }),
    );
    res
      .writeHead(response.status, { ...Object.fromEntries(response.headers), ...CORS })
      .end(Buffer.from(await response.arrayBuffer()));
  };
}

/** Serves `dist` the way Cloudflare Pages does: `/connect` is `connect/index.html`, and `_headers` rules apply. */
function siteListener(dist: string): http.RequestListener {
  const rules = parseHeaders(readFileSync(path.join(dist, '_headers'), 'utf8'));
  const matches = (rule: string, url: string) =>
    rule.endsWith('/*') ? url.startsWith(rule.slice(0, -1)) : rule === url;
  return (req, res) => {
    const url = new URL(req.url ?? '/', SITE).pathname;
    let file = path.join(dist, url);
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, url, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end();
    const type =
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[
        path.extname(file)
      ] ?? 'application/octet-stream';
    const headers = Object.assign(
      { 'content-type': type },
      ...rules.filter((r) => matches(r.path, url.replace(/\/$/, '') || '/')).map((r) => r.headers),
    );
    res.writeHead(200, headers).end(readFileSync(file));
  };
}

/**
 * The embedding app's page: a frame on the site and a log of every message the page receives. The
 * page sends its request when the test says so (`sendRequest`), after the test has put the browser
 * key where the frame looks for it.
 */
const embedder = `<!doctype html><title>app</title><iframe id="f" src="${SITE}/connect" width="400" height="500"></iframe>
<script>
  window.log = [];
  window.frameWindow = () => document.getElementById('f').contentWindow;
  addEventListener('message', (e) => window.log.push({ origin: e.origin, data: e.data }));
  window.sendRequest = () => window.frameWindow().postMessage({ type: 'connect', app: { appId: 'app1', name: 'Notes', description: 'Notes' },
    origin: location.origin, capabilities: [], state: 'state-1', codeChallenge: 'pkce-challenge' }, '${SITE}');
  window.sendToFrame = (m) => window.frameWindow().postMessage(m, '${SITE}');
</script>`;

export interface World {
  store: FakeStore;
  executor: FakeExecutor;
  close(): Promise<void>;
}

export async function startWorld(dist: string): Promise<World> {
  loadWasm();
  const store = new FakeStore(`http://127.0.0.1:${PORTS.store}`);
  const executor = new FakeExecutor(EXECUTOR_ORIGIN, { app1: [APP_ORIGIN] });
  const servers = await Promise.all([
    listen(PORTS.site, siteListener(dist)),
    listen(
      PORTS.platform,
      adapt(fakeRegistry({ app1: { name: 'Notes', origins: [APP_ORIGIN], firstParty: false } }) as never),
    ),
    listen(
      PORTS.store,
      adapt((r) => store.fetch(r)),
    ),
    listen(PORTS.app, (_req, res) => void res.writeHead(200, { 'content-type': 'text/html' }).end(embedder)),
    listen(PORTS.stranger, (_req, res) => void res.writeHead(200, { 'content-type': 'text/html' }).end(embedder)),
  ]);
  // The executor speaks the ad4m client's wire: `{id, type, params}` in, `{id, result}` or `{id, error}` out.
  const executorHttp = await listen(PORTS.executor, (_req, res) => void res.writeHead(426).end());
  const sockets = new WebSocketServer({ server: executorHttp });
  sockets.on('connection', (socket) =>
    socket.on('message', (raw) => {
      const { id, type, params } = JSON.parse(String(raw));
      if (type === 'user.sessionChallenge')
        return socket.send(JSON.stringify({ id, result: executor.sessionChallenge() }));
      if (type === 'user.loginWithKey') {
        const answer = executor.login(params.proof, params.appId);
        return socket.send(
          JSON.stringify(
            typeof answer === 'string' ? { id, error: { code: 403, message: answer } } : { id, result: answer },
          ),
        );
      }
      socket.send(JSON.stringify({ id, error: { code: 404, message: `no method ${type}` } }));
    }),
  );
  return {
    store,
    executor,
    close: () =>
      Promise.all(
        [...servers, executorHttp].map((s) => new Promise<void>((r) => (s.closeAllConnections(), s.close(() => r())))),
      ).then(() => void sockets.close()),
  };
}
