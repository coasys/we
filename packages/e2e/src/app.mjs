/**
 * A built app, served the way a deployment serves it — with its Content-Security-Policy as a header.
 *
 * The policy is the production one `@we/csp` builds for the host, from the seed the build was made
 * for, the same policy Netlify serves from the build's `_headers`. So a journey is also a check that
 * the app still works under it: what the policy refuses is refused here as it would be for a person,
 * where a server that sent no header would let it pass.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { buildContentSecurityPolicy } from '@we/csp';

import { ROOT } from './env.mjs';
import { freePort } from './executor.mjs';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
};

/** The seed a build is for: `WE_SEED`, or `we-seed.json` (`scripts/seed.cjs`). */
export function currentSeed() {
  return createRequire(import.meta.url)(join(ROOT, 'scripts', 'seed.cjs')).readSeed();
}

/** The production policy a host serves for a seed, as a header (so with `frame-ancestors`). */
export function productionCsp({ host = 'web', seed = currentSeed() } = {}) {
  return buildContentSecurityPolicy({ host, dev: false, seed });
}

/**
 * Serves `dir` as `vite preview` does — a file when there is one, else the app's `index.html` — on a
 * free port on 127.0.0.1, every response carrying the production policy.
 *
 * - `seed` — the seed the build was made for, whose content sources the policy allows. Default the
 *   one this process would build (`WE_SEED`, or `we-seed.json`).
 * - `host` — which host's policy: `web` (default), `tauri` or `electron`.
 */
export async function serveDist(dir, { seed, host = 'web' } = {}) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`No build at ${root}. Build it first (\`pnpm build:web\` for the web app).`);
  }
  const policy = productionCsp({ host, seed: seed ?? currentSeed() });
  const index = readFileSync(join(root, 'index.html'));
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(
      /^(\.\.[/\\])+/,
      '',
    );
    const file = join(root, path);
    const headers = { 'content-security-policy': policy };
    if (file.startsWith(root + sep) && existsSync(file) && extname(file)) {
      res.writeHead(200, { ...headers, 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(200, { ...headers, 'content-type': 'text/html' });
    res.end(index);
  });
  const port = await freePort();
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${port}`,
    policy,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
