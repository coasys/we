/**
 * The Tauri config's name, identifier and content security policy come from the seed: the generator
 * writes them into `src-tauri/tauri.seed.conf.json`, and `tauri.conf.json` holds WE's own seed's
 * values for a build without that file. These tests keep the two in step with `@we/csp` and with
 * `scripts/seed.cjs`.
 */
import { buildContentSecurityPolicy } from '@we/csp';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../../..');
const seedFile = require(resolve(root, 'scripts/seed.cjs')) as {
  tauriOf(seed: unknown): {
    productName: string;
    identifier: string;
    mainBinaryName: string;
    formerIdentifier: string | null;
  };
};
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

const conf = readJson('apps/we-tauri/src-tauri/tauri.conf.json');
const weSeed = readJson('we-seed.json');

describe("tauri.conf.json, for WE's own seed", () => {
  it('has the policy @we/csp builds, as the page has it in its meta tag', () => {
    expect(conf.app.security.csp).toBe(buildContentSecurityPolicy({ host: 'tauri', seed: weSeed }));
    expect(conf.app.security.devCsp).toBe(buildContentSecurityPolicy({ host: 'tauri', seed: weSeed, dev: true }));
  });

  it('keeps style-src as the policy writes it, so no nonce turns off its inline styles', () => {
    expect(conf.app.security.dangerousDisableAssetCspModification).toEqual(['style-src']);
  });

  it('runs no evaluated script in a packaged build', () => {
    const scripts = (conf.app.security.csp as string).split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scripts).not.toMatch(/'unsafe-eval'|'unsafe-inline'/);
  });

  it("has the name and identifier the generator writes for WE's own seed", () => {
    const tauri = seedFile.tauriOf(weSeed);
    expect([conf.productName, conf.identifier, conf.mainBinaryName]).toEqual([
      tauri.productName,
      tauri.identifier,
      tauri.mainBinaryName,
    ]);
  });

  it('lets the app make its main window, so the window can carry its navigation rules', () => {
    expect(conf.app.windows).toHaveLength(1);
    expect(conf.app.windows[0]).toMatchObject({ label: 'main', create: false });
  });
});

describe('the Tauri identifier', () => {
  it("is <appId>.tauri, and WE's own is io.weco.we.tauri", () => {
    expect(seedFile.tauriOf(weSeed)).toEqual({
      productName: 'WE',
      identifier: 'io.weco.we.tauri',
      mainBinaryName: 'we',
      formerIdentifier: null,
    });
    expect(seedFile.tauriOf({ desktop: { productName: 'My App', appId: 'io.example.app' } })).toMatchObject({
      identifier: 'io.example.app.tauri',
      mainBinaryName: 'my-app',
      formerIdentifier: null,
    });
  });

  it('is org.coasys.app for the Coasys app, which moves its data from the identifier it had', () => {
    expect(seedFile.tauriOf(readJson('seeds/coasys.seed.json'))).toEqual({
      productName: 'Coasys',
      identifier: 'org.coasys.app',
      mainBinaryName: 'coasys',
      formerIdentifier: 'io.coasys.app.tauri',
    });
  });
});
