// The edge applies the deploy's own `_headers` and `_redirects` to the names the acceptance world uses.
// Run: `node --test tests/acceptance/web`
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { buildContentSecurityPolicy, webHeadersFile } from '../../../packages/csp/src/index.js';
import { parseHeaders, parseRedirects, startEdge } from './edge.mjs';

const REDIRECTS = ['# comment', '/assets/*  /asset-gone.txt  404', '/*  /index.html  200', ''].join('\n');

async function site(name, html) {
  const root = await mkdtemp(join(tmpdir(), `edge-${name}-`));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), html);
  await writeFile(join(root, 'asset-gone.txt'), 'gone\n');
  await writeFile(join(root, 'assets', 'app.js'), 'export {}\n');
  await writeFile(join(root, '_redirects'), REDIRECTS);
  await writeFile(join(root, '_headers'), webHeadersFile(buildContentSecurityPolicy({ host: 'web', meta: false })));
  return root;
}

describe('the local edge', () => {
  let edge;
  // `fetch` will not send a chosen Host header, so this speaks to the edge with `http`.
  const get = (host, path) =>
    new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port: edge.port, path, headers: { host } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: { get: (name) => res.headers[name] ?? null },
            text: async () => Buffer.concat(chunks).toString(),
          }),
        );
      })
        .on('error', reject)
        .end();
    });

  before(async () => {
    edge = await startEdge({
      'app.coasys.test': await site('app', '<title>app</title>'),
      'coasys-id.test': await site('id', '<title>id</title>'),
    });
  });
  after(() => edge.close());

  test('picks the site by host', async () => {
    assert.match(await (await get('app.coasys.test', '/')).text(), /app/);
    assert.match(await (await get('coasys-id.test', '/')).text(), /id/);
    assert.equal((await get('elsewhere.test', '/')).status, 421);
  });

  test('serves the deploy headers on every response, as Pages does', async () => {
    const response = await get('app.coasys.test', '/assets/app.js');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /frame-src [^;]*https:\/\/coasys\.id/);
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('falls back to the app for a client route, and answers a missing asset with 404', async () => {
    const route = await get('app.coasys.test', '/spaces/abc');
    assert.equal(route.status, 200);
    assert.match(await route.text(), /app/);
    assert.equal((await get('app.coasys.test', '/assets/old-chunk.js')).status, 404);
  });
});

describe('the file parsers', () => {
  test('_headers groups indented lines under their path', () => {
    assert.deepEqual(parseHeaders('/*\n  A: b: c\n/x\n  D: e\n'), [
      { pattern: '/*', headers: [['A', 'b: c']] },
      { pattern: '/x', headers: [['D', 'e']] },
    ]);
    assert.throws(() => parseHeaders('  A: b\n'), /without a path/);
  });

  test('_redirects reads from, to and status', () => {
    assert.deepEqual(parseRedirects('/a /b 301\n/* /index.html\n'), [
      { from: '/a', to: '/b', status: 301 },
      { from: '/*', to: '/index.html', status: 302 },
    ]);
  });
});
