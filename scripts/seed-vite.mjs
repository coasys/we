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
 * - In development, for a seed that builds bundles in, an edit to a cartridge reaches the page (see
 *   `rebuildBundlesOnChange`).
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const seedFile = createRequire(import.meta.url)('./seed.cjs');

const SHELL_DIR = resolve(seedFile.REPO_ROOT, 'packages/app-shell');
const REGISTRIES_DIR = join(SHELL_DIR, 'src/shared/registries');
const BUNDLES_DIR = resolve(seedFile.REPO_ROOT, 'bundles');
/** What a cartridge is written from: the templates packages, and the portable kit beneath them. */
const CARTRIDGE_SOURCES = [
  resolve(seedFile.REPO_ROOT, 'packages/templates'),
  resolve(seedFile.REPO_ROOT, 'packages/schema-system/kit/src'),
];

/** The seed this build is for, as an absolute path — for a plugin that takes a seed file. */
export const seedPath = () => seedFile.seedPath();

export function weSeed() {
  const seed = seedFile.readSeed();
  const generated = seedFile.generatedDir(SHELL_DIR);
  const productName = seed.desktop?.productName;

  return {
    name: 'we-seed',
    enforce: 'pre',
    config() {
      return { resolve: { alias: { '@we/seed-file': seedFile.seedPath() } } };
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
    configureServer(server) {
      if (seed.bundles?.length) rebuildBundlesOnChange(server);
    },
  };
}

const run = promisify(execFile);

/**
 * Keeps a dev server's built-in bundles in step with the cartridges they are written from.
 *
 * A bundle reaches the page through two generated files, and nothing regenerated either: the
 * cartridge is written out as `bundles/<id>.bundle.json` (checked in), and the seed's bundles are
 * copied from there into the shell's `seedBundles.generated.ts`. An edit to a cartridge therefore
 * showed nothing until both were run by hand, and a reload after only the first still drew the old
 * chrome. So, as a chain, each step triggered by the file the one before it writes:
 *
 * 1. A change under the cartridges' sources writes the bundles again
 *    (`pnpm --filter @we/template-cartridges bundle`).
 * 2. A change to a bundle file regenerates the shell's registry for this seed, and reloads the page.
 *
 * Step 2 also catches a bundle file edited or pulled on its own. Runs one at a time, a moment after
 * the last change, so saving several files builds once. Development only: a build runs the
 * generators itself.
 */
function rebuildBundlesOnChange(server) {
  const log = server.config.logger;
  const root = seedFile.REPO_ROOT;
  const inside = (file, dir) => file === dir || file.startsWith(dir + sep);
  const isSource = (file) =>
    CARTRIDGE_SOURCES.some((dir) => inside(file, dir)) &&
    /\.(ts|tsx|json|svg)$/.test(file) &&
    !file.includes(`${sep}node_modules${sep}`) &&
    !/\.test\.tsx?$/.test(file);
  const isBundle = (file) => dirname(file) === BUNDLES_DIR && file.endsWith('.bundle.json');

  let queue = Promise.resolve();
  const timers = new Map();
  /** One step, debounced by name and run after whatever is already running. */
  const schedule = (name, step) => {
    clearTimeout(timers.get(name));
    timers.set(
      name,
      setTimeout(() => {
        queue = queue.then(step).catch((error) => {
          log.error(`[we-seed] ${name} failed:\n${error.stderr || error.message}`, { timestamp: true });
        });
      }, 200),
    );
  };

  const writeBundles = () => run('pnpm', ['--filter', '@we/template-cartridges', 'bundle'], { cwd: root });
  const registry = seedFile.generatedPath(join(REGISTRIES_DIR, 'seedBundles.generated.ts'), SHELL_DIR);
  const read = () => (existsSync(registry) ? readFileSync(registry, 'utf8') : '');
  /*
    Reloads only when the registry actually changed. Every save under the templates rewrites the
    bundles, and most of those saves — a view, a fragment no cartridge uses — change nothing in them;
    Vite has already hot-updated the page for those, and a full reload on top would throw away the
    state the hot update kept.
  */
  const regenerate = async () => {
    const before = read();
    await run(process.execPath, [join(SHELL_DIR, 'scripts/generateBundleRegistry.mjs')], { cwd: root });
    if (read() === before) return;
    log.info(`[we-seed] built-in bundles regenerated for ${seedFile.seedLabel()}`, { timestamp: true });
    server.ws.send({ type: 'full-reload' });
  };

  /*
    Once at start as well. The watcher only sees what changes while the server runs, so a cartridge
    edited, committed or pulled while it was down left the last run's registry in place — a restart
    drew the old app and looked like the edit had not happened. The bundles are written first and the
    registry after, so both are current before anybody has a reason to reload.
  */
  queue = queue
    .then(writeBundles)
    .then(regenerate)
    .catch((error) => {
      log.error(`[we-seed] start-up rebuild failed:\n${error.stderr || error.message}`, { timestamp: true });
    });

  server.watcher.add([...CARTRIDGE_SOURCES, BUNDLES_DIR]);
  const onFile = (file) => {
    if (isBundle(file)) schedule('regenerate', regenerate);
    else if (isSource(file)) schedule('bundle', writeBundles);
  };
  for (const event of ['change', 'add', 'unlink']) server.watcher.on(event, onFile);
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
