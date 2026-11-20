/**
 * The local edge: what Cloudflare Pages does for a static site, for the names the acceptance world
 * uses (`app.coasys.test`, `coasys-id.test`). It serves each site's folder, applies the site's
 * `_headers` and `_redirects` files exactly as the build wrote them, and picks the site by the
 * request's `Host`. A browser reaches it with a host-resolver rule that maps the `.test` names to
 * 127.0.0.1 and the edge's port, so a page's origin is the name and not `localhost`.
 *
 * It reads the two files the deploy ships rather than a copy of their rules, so a header the build
 * drops, or a redirect the host would not honour, fails here before it fails on the site.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** `_headers`: a path pattern line, then indented `Name: value` lines. */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const at = raw.indexOf(':');
      if (!current || at < 0) throw new Error(`_headers: a header without a path: ${raw}`);
      current.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()]);
    } else {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
    }
  }
  return rules;
}

/** `_redirects`: `from to status`, with a trailing `*` as the only wildcard. */
export function parseRedirects(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const [from, to, status = '302'] = line.trim().split(/\s+/);
      return { from, to, status: Number(status) };
    });
}

function matches(pattern, path) {
  return pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;
}

async function fileAt(root, path) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const full = join(root, safe);
  if (!full.startsWith(root)) return null;
  try {
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Starts the edge on `port` (0 for any). `sites` maps a host name to the folder it serves. Resolves to
 * `{ port, close }`.
 */
export async function startEdge(sites, port = 0) {
  const loaded = new Map();
  for (const [host, root] of Object.entries(sites)) {
    loaded.set(host, {
      root,
      headers: parseHeaders(await readOptional(join(root, '_headers'))),
      redirects: parseRedirects(await readOptional(join(root, '_redirects'))),
    });
  }

  const server = createServer(async (request, response) => {
    const host = (request.headers.host ?? '').replace(/:\d+$/, '');
    const site = loaded.get(host);
    if (!site) {
      response.writeHead(421, { 'content-type': 'text/plain' }).end(`no site for ${host}\n`);
      return;
    }
    const path = decodeURIComponent(new URL(request.url, 'http://edge').pathname);
    let status = 200;
    let file = await fileAt(site.root, path === '/' ? '/index.html' : path);
    if (!file) {
      // A rule applies only where no file matches, as on Pages.
      const rule = site.redirects.find((r) => matches(r.from, path));
      if (rule?.status === 200) file = await fileAt(site.root, rule.to);
      else if (rule) {
        status = rule.status;
        file = await fileAt(site.root, rule.to);
      } else {
        status = 404;
      }
    }
    const headers = {};
    for (const rule of site.headers) {
      if (!matches(rule.pattern, path)) continue;
      for (const [name, value] of rule.headers) headers[name.toLowerCase()] = value;
    }
    if (!file) {
      response.writeHead(status, { ...headers, 'content-type': 'text/plain' }).end('not found\n');
      return;
    }
    headers['content-type'] = TYPES[extname(file)] ?? 'application/octet-stream';
    response.writeHead(status, headers).end(await readFile(file));
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
