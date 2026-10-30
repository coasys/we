/**
 * A template marked `dev` in the template catalogue is in a build only where the build has developer
 * features, and a production build does not contain it at all.
 *
 * "Does not contain" is the claim worth testing, and only a real build can test it. Every showcase
 * template but Workshop is marked, and several are named after the products they imitate, which is
 * fine only while they ship to nobody, so hidden from the picker is not enough. This builds the generated registry the way the
 * apps do, with the seed plugin that defines `__WE_DEV_FEATURES__`, minified, and looks for each
 * template's description in what comes out.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  discordTemplate,
  eventsTemplate,
  instagramTemplate,
  scrapbookTemplate,
  themeLabTemplate,
  trelloTemplate,
  twitterTemplate,
  workshopTemplate,
  youtubeTemplate,
} from '@we/template-showcase';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

// Plain ESM shared by every app's Vite config: the plugin that defines `__WE_DEV_FEATURES__`.
import { devFeatures, weSeed } from '../../../scripts/seed-vite.mjs';

const REGISTRY = resolve(import.meta.dirname, '../src/shared/registries/bundledTemplates.generated.ts');
const THEMES = resolve(import.meta.dirname, '../src/shared/registries/themeRegistry.ts');
/** What the marked templates and their themes are named after, which a production build must not say. */
const PRODUCTS = ['Discord', 'Twitter', 'Instagram', 'YouTube', 'Trello'];
/** Every showcase template but Workshop, which ships. */
const DEV_ONLY = [
  discordTemplate,
  twitterTemplate,
  instagramTemplate,
  youtubeTemplate,
  trelloTemplate,
  eventsTemplate,
  scrapbookTemplate,
  themeLabTemplate,
];
const out = mkdtempSync(join(tmpdir(), 'we-dev-only-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

/*
  The themes registry carries the bundles the seed builds in, and those are the deployment's own
  content rather than the showcase: Coasys's About page links Coasys's real Discord. Left out here, so
  a product name in the build can only have come from a showcase template or theme.
*/
const withoutSeedBundles = {
  name: 'without-seed-bundles',
  enforce: 'pre' as const,
  resolveId: (source: string) => (source.endsWith('seedBundles.generated') ? '\0no-seed-bundles' : null),
  load: (id: string) => (id === '\0no-seed-bundles' ? 'export const seedBundles = [];' : null),
};

/** The registry as a production build of an app would emit it, with or without developer features. */
async function built(devFeatures: boolean): Promise<string> {
  const dir = join(out, String(devFeatures));
  const before = process.env.WE_DEV_FEATURES;
  process.env.WE_DEV_FEATURES = String(devFeatures);
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [weSeed(), withoutSeedBundles],
      build: {
        outDir: dir,
        minify: true,
        lib: { entry: { templates: REGISTRY, themes: THEMES }, formats: ['es'] },
      },
    });
  } finally {
    if (before === undefined) delete process.env.WE_DEV_FEATURES;
    else process.env.WE_DEV_FEATURES = before;
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

describe('templates the catalogue marks dev', () => {
  it('are not in a production build at all', async () => {
    const code = await built(false);
    expect(code).toContain(workshopTemplate.meta!.description);
    for (const template of DEV_ONLY) expect(code).not.toContain(template.meta!.description);
  }, 120_000);

  it('are in a build with developer features', async () => {
    const code = await built(true);
    for (const template of DEV_ONLY) expect(code).toContain(template.meta!.description);
  }, 120_000);

  /*
    The showcase themes are named after the same products, and are gated the same way in
    `themeRegistry`. Asked of both registries at once, and of the names themselves: a production
    build should not say any of them, wherever the word would have come from.
  */
  it('leave no product name in a production build, from a template or a theme', async () => {
    const code = await built(false);
    for (const name of PRODUCTS) expect(code, name).not.toContain(name);
    const withDev = await built(true);
    for (const name of PRODUCTS) expect(withDev, name).toContain(name);
  }, 240_000);
});

/*
  Which builds have developer features: every one Vite serves, and a build only when asked, which is
  how Netlify's `dev` and its previews get them and production does not (scripts/netlify-build.sh).
*/
describe('whether a build has developer features', () => {
  it('is on while serving and off in a build, unless the build says otherwise', () => {
    expect(devFeatures('serve', {})).toBe(true);
    expect(devFeatures('build', {})).toBe(false);
    expect(devFeatures('build', { WE_DEV_FEATURES: 'true' })).toBe(true);
    expect(devFeatures('serve', { WE_DEV_FEATURES: 'false' })).toBe(false);
  });
});
