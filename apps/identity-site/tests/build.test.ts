import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { endpoints } from '../config/endpoints.mjs';
import { parseHeaders } from '../headers.ts';
import { checkLive, urlOf } from '../scripts/check-live.ts';

const STORE_KEY = 'did:key:z6MkBuildTestOnly';

function build(env: string): string {
  const out = mkdtempSync(path.join(tmpdir(), `identity-site-${env}-`));
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
    env: { ...process.env, COASYS_ENV: env, COASYS_STORE_KEY: STORE_KEY },
    stdio: 'pipe',
  });
  return out;
}

const filesUnder = (dir: string, base = dir): string[] =>
  readdirSync(dir).flatMap((n) =>
    statSync(path.join(dir, n)).isDirectory()
      ? filesUnder(path.join(dir, n), base)
      : [path.relative(base, path.join(dir, n))],
  );

const staging = endpoints('staging', STORE_KEY);
const production = endpoints('production', STORE_KEY);
let stagingDist = '';
let productionDist = '';

beforeAll(() => {
  stagingDist = build('staging');
  productionDist = build('production');
}, 120_000);

const rules = (dist: string) => parseHeaders(readFileSync(path.join(dist, '_headers'), 'utf8'));
const rule = (dist: string, p: string) => rules(dist).find((r) => r.path === p)!.headers;
const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe('dist/_headers', () => {
  it('has one rule for each page, the assets and .well-known', () => {
    expect(rules(stagingDist).map((r) => r.path)).toEqual(['/', '/o', '/connect', '/assets/*', '/.well-known/*']);
  });

  it('lets only the listed origins frame /connect, in each environment', () => {
    const csp = rule(stagingDist, '/connect')['Content-Security-Policy'];
    expect(directive(csp, 'frame-ancestors')).toBe('https://staging.coasys.app');
    expect(directive(rule(productionDist, '/connect')['Content-Security-Policy'], 'frame-ancestors')).toBe(
      'https://coasys.app',
    );
    expect(rule(stagingDist, '/connect')['X-Frame-Options']).toBeUndefined();
    expect(rule(stagingDist, '/connect')['Cross-Origin-Opener-Policy']).toBe('unsafe-none');
    expect(rule(stagingDist, '/connect')['Cross-Origin-Embedder-Policy']).toBeUndefined();
    expect(rule(stagingDist, '/connect')['Cross-Origin-Resource-Policy']).toBe('cross-origin');
  });

  it('forbids framing of every other route', () => {
    for (const p of ['/', '/o', '/assets/*', '/.well-known/*']) {
      const headers = rule(stagingDist, p);
      expect(directive(headers['Content-Security-Policy'], 'frame-ancestors'), p).toBe("'none'");
      expect(headers['X-Frame-Options'], p).toBe('DENY');
      expect(headers['Cross-Origin-Opener-Policy'], p).toBe('same-origin');
      expect(headers['Cross-Origin-Embedder-Policy'], p).toBe('require-corp');
    }
  });

  it('sends no referrer, no sniffing and HSTS on every route', () => {
    for (const { path: p, headers } of rules(productionDist)) {
      expect(headers['Referrer-Policy'], p).toBe('no-referrer');
      expect(headers['X-Content-Type-Options'], p).toBe('nosniff');
      expect(headers['Strict-Transport-Security'], p).toContain('max-age=');
      expect(headers['Permissions-Policy'], p).toContain('microphone=()');
    }
  });

  it('keeps pages out of every cache and fingerprinted assets in it', () => {
    expect(rule(stagingDist, '/connect')['Cache-Control']).toBe('no-store');
    expect(rule(stagingDist, '/assets/*')['Cache-Control']).toContain('immutable');
  });

  it('has a policy with no inline code, no eval and no third party', () => {
    for (const { path: p, headers } of rules(productionDist)) {
      const csp = headers['Content-Security-Policy'];
      expect(csp, p).toContain("default-src 'none'");
      expect(directive(csp, 'script-src'), p).toBe(p === '/connect' ? "'self' 'wasm-unsafe-eval'" : "'self'");
      expect(directive(csp, 'style-src'), p).toBe("'self'");
      expect(csp, p).not.toMatch(/unsafe-inline|(?<!wasm-)unsafe-eval|\*/);
      expect(directive(csp, 'require-trusted-types-for'), p).toBe("'script'");
      expect(directive(csp, 'form-action'), p).toBe("'none'");
      expect(directive(csp, 'base-uri'), p).toBe("'none'");
      expect(csp, p).toContain('upgrade-insecure-requests');
    }
  });

  it('allows the platform and the store, and no other host, in connect-src of the other routes', () => {
    expect(directive(rule(productionDist, '/')['Content-Security-Policy'], 'connect-src')).toBe(
      `'self' ${production.store} ${production.platform}`,
    );
  });

  it('lets /connect reach any executor over https and wss, and no other route', () => {
    expect(directive(rule(productionDist, '/connect')['Content-Security-Policy'], 'connect-src')).toMatch(
      / https: wss:/,
    );
    expect(directive(rule(productionDist, '/o')['Content-Security-Policy'], 'connect-src')).not.toMatch(/ https:( |$)/);
  });
});

describe('the built site', () => {
  it('has the three pages', () => {
    const files = filesUnder(stagingDist);
    expect(files).toEqual(
      expect.arrayContaining([
        'index.html',
        'connect/index.html',
        'o/index.html',
        '_headers',
        '.well-known/identity-site-build.json',
      ]),
    );
  });

  it('has no inline script, style or handler, and an integrity hash that matches each file', () => {
    for (const file of filesUnder(stagingDist).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(path.join(stagingDist, file), 'utf8');
      expect(html, file).not.toMatch(/<style|\son[a-z]+=|style=|<script(?![^>]*\ssrc=)/);
      for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
        const href = /(?:src|href)="(\/[^"]+)"/.exec(tag)?.[1];
        if (!href) continue;
        const sri = /integrity="sha384-([^"]+)"/.exec(tag)?.[1];
        expect(sri, `${file} ${href}`).toBe(
          createHash('sha384')
            .update(readFileSync(path.join(stagingDist, href)))
            .digest('base64'),
        );
      }
    }
  });

  it('names no origin of a third party', () => {
    const allowed = [staging.store, staging.platform, 'http://www.w3.org'];
    for (const file of filesUnder(stagingDist).filter((f) => /\.(js|css|html)$/.test(f))) {
      for (const url of readFileSync(path.join(stagingDist, file), 'utf8').match(/https?:\/\/[a-z0-9.-]+/gi) ?? []) {
        expect(
          allowed.some((a) => a.startsWith(url) || url.startsWith(a)),
          `${file}: ${url}`,
        ).toBe(true);
      }
    }
  });

  it('writes a manifest with the commit, both package versions and the hash of each file', () => {
    const manifest = JSON.parse(readFileSync(path.join(stagingDist, '.well-known/identity-site-build.json'), 'utf8'));
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    const version = (pkg: string) =>
      JSON.parse(readFileSync(path.resolve('node_modules', pkg, 'package.json'), 'utf8')).version;
    expect(manifest.connect).toBe(version('@coasys/connect'));
    expect(manifest.identityPortal).toBe(version('@coasys/identity-portal'));
    const listed = Object.keys(manifest.files).sort();
    expect(listed).toEqual(
      filesUnder(stagingDist)
        .filter((f) => f !== '.well-known/identity-site-build.json')
        .sort(),
    );
    for (const [file, hash] of Object.entries(manifest.files)) {
      expect(
        createHash('sha256')
          .update(readFileSync(path.join(stagingDist, file)))
          .digest('hex'),
        file,
      ).toBe(hash);
    }
  });

  it('builds the same files twice', () => {
    const again = build('staging');
    const hashes = (dir: string) =>
      Object.fromEntries(
        filesUnder(dir).map((f) => [
          f,
          createHash('sha256')
            .update(readFileSync(path.join(dir, f)))
            .digest('hex'),
        ]),
      );
    expect(hashes(again)).toEqual(hashes(stagingDist));
  }, 60_000);
});

describe('the live check of the deploy', () => {
  // A fake of the site that serves the build with its `_headers`, the way Pages does.
  const serve =
    (dist: string, tamper?: string) =>
    async (url: string): Promise<Response> => {
      const { pathname } = new URL(url);
      const file = filesUnder(dist).find((f) => urlOf(f) === pathname);
      if (!file) return new Response('', { status: 404 });
      const rule = rules(dist).find(
        (r) => r.path === pathname || (r.path.endsWith('/*') && pathname.startsWith(r.path.slice(0, -1))),
      );
      const body = readFileSync(path.join(dist, file));
      return new Response(file === tamper ? Buffer.concat([body, Buffer.from(' ')]) : body, { headers: rule?.headers });
    };

  it('finds no difference in the site that is the build', async () => {
    expect(await checkLive(stagingDist, 'https://site.test', serve(stagingDist))).toEqual([]);
  });

  it('names a file whose bytes differ and a route that lost a header', async () => {
    expect(await checkLive(stagingDist, 'https://site.test', serve(stagingDist, 'connect/index.html'))).toEqual([
      '/connect: hash differs',
    ]);
    const lost = async (url: string) => {
      const response = await serve(stagingDist)(url);
      const headers = new Headers(response.headers);
      if (new URL(url).pathname === '/o') headers.delete('Content-Security-Policy');
      return new Response(await response.arrayBuffer(), { status: response.status, headers });
    };
    const problems = await checkLive(stagingDist, 'https://site.test', lost);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^\/o: header Content-Security-Policy is "null"/);
  });
});

describe('the source', () => {
  it('writes no markup from data and runs no string as code', () => {
    const sources = filesUnder('src').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const file of sources) {
      expect(readFileSync(path.join('src', file), 'utf8'), file).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/,
      );
    }
  });
});

describe('endpoints', () => {
  it('refuses an unknown environment and a missing store key', () => {
    expect(() => endpoints('prod', STORE_KEY)).toThrow(/COASYS_ENV/);
    expect(() => endpoints('staging', undefined)).toThrow(/COASYS_STORE_KEY/);
  });
});
