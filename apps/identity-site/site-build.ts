import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { identityWindowConfig } from '@coasys/identity-portal/vite';
import type { Plugin } from 'vite';

import { renderHeaders, type SiteEndpoints } from './headers.ts';

const integrity = (bytes: Buffer) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, base) : [path.relative(base, full)];
  });
}

const versionOf = (pkg: string) =>
  JSON.parse(readFileSync(path.resolve('node_modules', pkg, 'package.json'), 'utf8')).version as string;

function commit(): string {
  return process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
}

/**
 * After the bundle is written: subresource integrity on every script and stylesheet tag, then
 * `_headers`, then the build manifest with the hash of every file, so the deploy and any visitor
 * can compare the live site with the build.
 */
export function siteOutputs(endpoints: SiteEndpoints): Plugin {
  let dist = '';
  return {
    name: 'site-outputs',
    apply: 'build',
    configResolved: (config) => {
      dist = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of filesUnder(dist).filter((f) => f.endsWith('.html'))) {
        const html = path.join(dist, file);
        const text = readFileSync(html, 'utf8').replace(/<(script|link)\b[^>]*>/g, (tag) => {
          const href = /(?:src|href)="(\/[^"]+)"/.exec(tag)?.[1];
          if (!href || (!/type="module"/.test(tag) && !/rel="stylesheet"/.test(tag))) return tag;
          const hash = integrity(readFileSync(path.join(dist, href)));
          return tag.replace(/\s*\/?>$/, ` integrity="${hash}">`);
        });
        writeFileSync(html, text);
      }
      writeFileSync(path.join(dist, '_headers'), renderHeaders(endpoints));
      const files = Object.fromEntries(
        filesUnder(dist)
          .sort()
          .map((f) => [
            f,
            createHash('sha256')
              .update(readFileSync(path.join(dist, f)))
              .digest('hex'),
          ]),
      );
      mkdirSync(path.join(dist, '.well-known'), { recursive: true });
      writeFileSync(
        path.join(dist, '.well-known/identity-site-build.json'),
        JSON.stringify(
          {
            commit: commit(),
            identityPortal: versionOf('@coasys/identity-portal'),
            connect: versionOf('@coasys/connect'),
            identityWasm: versionOf('@coasys/identity-wasm'),
            files,
          },
          null,
          2,
        ) + '\n',
      );
    },
  };
}

/**
 * The identity portal's theme plugin, without its `identity-csp` plugin: that one writes a meta
 * policy that allows only the Tauri bridge, and this site needs the network. `_headers` carries
 * the site's policy instead (headers.ts).
 */
export const portalPlugins = (): Plugin[] =>
  (identityWindowConfig({ root: '.', outDir: 'dist' }).plugins as Plugin[]).filter((p) => p.name !== 'identity-csp');
