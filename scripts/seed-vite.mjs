/**
 * The seed, as an app's Vite build sees it.
 *
 *   plugins: [weSeed(), …]
 *
 * - `import seed from '@we/seed-file'` is the seed this build is for (`WE_SEED`, or `we-seed.json`).
 *   Apps import it under that name rather than by a path, so the path is decided in one place.
 * - For any seed but WE's own, the shell's `*.generated.ts` registries resolve to that seed's copies
 *   under `packages/app-shell/.seed-build/<name>/`, which the generators wrote there instead of over
 *   the checked-in ones. See `scripts/seed.cjs`.
 * - The page's `<title>` is the seed's desktop product name where it sets one. A cartridge's brand
 *   names the window at runtime as well; this is the name before anything has run.
 * - `__WE_DEV_FEATURES__` is `true` when Vite is serving, or when the build is made with
 *   `WE_DEV_FEATURES=true`, and `false` otherwise. Every app takes this plugin, so this is the one
 *   place that decides whether a build has developer features. See `devFeatures.ts` in
 *   `@we/module-shared`.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

const seedFile = createRequire(import.meta.url)('./seed.cjs');

const SHELL_DIR = resolve(seedFile.REPO_ROOT, 'packages/app-shell');
const REGISTRIES_DIR = join(SHELL_DIR, 'src/shared/registries');

/** The seed this build is for, as an absolute path — for a plugin that takes a seed file. */
export const seedPath = () => seedFile.seedPath();

export function weSeed() {
  const seed = seedFile.readSeed();
  const generated = seedFile.generatedDir(SHELL_DIR);
  const productName = seed.desktop?.productName;

  return {
    name: 'we-seed',
    enforce: 'pre',
    config(_config, { command }) {
      return {
        resolve: { alias: { '@we/seed-file': seedFile.seedPath() } },
        define: { __WE_DEV_FEATURES__: JSON.stringify(devFeatures(command)) },
      };
    },
    resolveId(source, importer) {
      if (!generated || !importer) return null;
      const name = generatedRegistry(source, importer);
      return name ? seedRegistryFile(generated, name) : null;
    },
    transformIndexHtml(html) {
      if (!productName) return html;
      return html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(productName)}</title>`);
    },
  };
}

/**
 * Whether a build has developer features: always while serving, and in a build only when asked for.
 * An explicit `WE_DEV_FEATURES=false` turns them off while serving too, to look at what ships.
 */
export function devFeatures(command, env = process.env) {
  if (env.WE_DEV_FEATURES === 'true') return true;
  if (env.WE_DEV_FEATURES === 'false') return false;
  return command === 'serve';
}

/**
 * The registry an import names, when it is one of the shell's generated registries: `./X.generated`
 * from inside the registries directory, or `@shared/registries/X.generated` from anywhere.
 */
export function generatedRegistry(source, importer) {
  const aliased = /^@shared\/registries\/([A-Za-z]+\.generated)(\.ts)?$/.exec(source);
  if (aliased) return aliased[1];
  const relative = /^\.\/([A-Za-z]+\.generated)(\.ts)?$/.exec(source);
  if (relative && dirname(importer.split('?')[0]) === REGISTRIES_DIR) return relative[1];
  return null;
}

/** That registry's file for this seed, refusing clearly when the shell was not generated for it. */
export function seedRegistryFile(generated, name) {
  const file = join(generated, `${name}.ts`);
  if (!existsSync(file)) {
    throw new Error(
      `${basename(file)} has not been generated for ${seedFile.seedLabel()}. Generate the shell's registries with the ` +
        'same WE_SEED first (`WE_SEED=… pnpm --filter @we/app-shell build`).',
    );
  }
  return file;
}

/** The same redirect for esbuild (tsup), so the shell's own `dist` agrees with the apps. */
export function weSeedEsbuild() {
  const generated = seedFile.generatedDir(SHELL_DIR);
  return {
    name: 'we-seed',
    setup(build) {
      if (!generated) return;
      build.onResolve({ filter: /\.generated(\.ts)?$/ }, (args) => {
        const name = generatedRegistry(args.path, args.importer);
        return name ? { path: seedRegistryFile(generated, name) } : undefined;
      });
    },
  };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
