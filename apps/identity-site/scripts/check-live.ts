/**
 * Checks a live site against the build it should be: every served file has the hash the build
 * manifest lists, and every route sends the headers `_headers` names. Exits 1 on any difference,
 * so a deploy can roll back. Usage: node --experimental-strip-types scripts/check-live.ts <dist> <base-url>
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseHeaders } from '../headers.ts';

/** The URL path Pages serves a built file at; `_headers` itself is not served. */
export function urlOf(file: string): string | undefined {
  if (file === '_headers') return undefined;
  if (file === 'index.html') return '/';
  return '/' + file.replace(/\/index\.html$/, '');
}

type Fetch = (url: string) => Promise<Response>;

export async function checkLive(
  dist: string,
  base: string,
  http: Fetch = (url) => fetch(url, { redirect: 'manual' }),
): Promise<string[]> {
  const problems: string[] = [];
  const manifestPath = '.well-known/identity-site-build.json';
  const live = await http(`${base}/${manifestPath}`);
  if (!live.ok) return [`${manifestPath}: ${live.status}`];
  const liveText = await live.text();
  if (liveText !== readFileSync(path.join(dist, manifestPath), 'utf8'))
    problems.push(`${manifestPath}: differs from the build`);
  const manifest = JSON.parse(readFileSync(path.join(dist, manifestPath), 'utf8')) as { files: Record<string, string> };

  for (const [file, hash] of Object.entries(manifest.files)) {
    const url = urlOf(file);
    if (!url) continue;
    const response = await http(`${base}${url}`);
    if (!response.ok) problems.push(`${url}: ${response.status}`);
    else if (
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex') !== hash
    )
      problems.push(`${url}: hash differs`);
  }

  const sample: Record<string, string> = {
    '/assets/*': '/' + Object.keys(manifest.files).find((f) => f.startsWith('assets/'))!,
    '/.well-known/*': `/${manifestPath}`,
  };
  for (const { path: route, headers } of parseHeaders(readFileSync(path.join(dist, '_headers'), 'utf8'))) {
    const url = sample[route] ?? route;
    const response = await http(`${base}${url}`);
    for (const [name, value] of Object.entries(headers)) {
      if (response.headers.get(name) !== value)
        problems.push(`${url}: header ${name} is "${response.headers.get(name)}", expected "${value}"`);
    }
    if (route !== '/connect' && response.headers.get('X-Frame-Options') !== 'DENY')
      problems.push(`${url}: can be framed`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const [dist, base] = process.argv.slice(2);
  const problems = await checkLive(dist, base.replace(/\/$/, ''));
  for (const p of problems) console.error(p);
  console.log(problems.length ? `${problems.length} difference(s)` : `${base} matches the build`);
  process.exit(problems.length ? 1 : 0);
}
