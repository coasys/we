/**
 * Writes the bundled-module registry from the deployment seed.
 *
 * The sibling of `generateTemplateRegistry.mjs` and `generateViewRegistry.mjs`, and the one that
 * replaces a hand-maintained map: `bundledModules.ts` used to import six packages and list them by
 * id, and adding a module meant editing that file, the seed and the component registry in step. Now
 * the seed is the list. A module it does not name is never imported, so it leaves the bundle rather
 * than merely the rail.
 *
 * ## A module from outside this repository
 *
 * A seed entry may be `{ "id": "polls", "package": "@acme/we-module-polls" }`. The package is
 * imported like any other, so a deployment adds it as a dependency, names it here, and rebuilds —
 * trusting it the way it trusts `@we/module-call`. A bare id resolves to `@we/module-<id>`.
 *
 * Every module package exports `createModule(host)`. That one shape is what lets this file know
 * nothing about a module but its name.
 *
 * Run: `pnpm --filter @we/app-shell generate-modules`
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outPath = resolve(here, '../src/shared/registries/bundledModules.generated.ts');
const appShellModules = resolve(here, '../node_modules');

const seed = JSON.parse(await readFile(resolve(repoRoot, 'we-seed.json'), 'utf8'));
const entries = (seed.modules ?? []).map((entry) => (typeof entry === 'string' ? { id: entry } : entry));

const bad = entries.filter((entry) => !entry?.id || !/^[a-z][a-z0-9-]*$/.test(entry.id));
if (bad.length) {
  console.error(`we-seed.json has module entries without a usable id: ${JSON.stringify(bad)}`);
  process.exit(1);
}

const seen = new Set();
for (const { id } of entries) {
  if (seen.has(id)) {
    console.error(`we-seed.json names module "${id}" twice`);
    process.exit(1);
  }
  seen.add(id);
}

const resolved = entries.map((entry) => ({ id: entry.id, pkg: entry.package ?? `@we/module-${entry.id}` }));

/*
  Checked against the app shell's own dependencies, which is where a bundler will look. By directory
  rather than by `require.resolve`, because a workspace package that has not been built yet has no
  entry file to resolve and is still a perfectly good dependency. A package that is not here would
  fail the build a minute later with a message naming a path nobody wrote; this names the seed entry
  that asked for it.
*/
const missing = resolved.filter(({ pkg }) => !existsSync(resolve(appShellModules, pkg)));
if (missing.length) {
  console.error(
    `we-seed.json declares modules whose packages are not installed for @we/app-shell:\n` +
      missing.map(({ id, pkg }) => `  ${id} → ${pkg}`).join('\n') +
      `\nAdd each package to packages/app-shell/package.json and run pnpm install.`,
  );
  process.exit(1);
}

const ident = (id) => `module_${id.replace(/-/g, '_')}`;
const imports = resolved.map(({ id, pkg }) => `import { createModule as ${ident(id)} } from '${pkg}';`).join('\n');
const members = resolved.map(({ id }) => `  ${JSON.stringify(id)}: ${ident(id)},`).join('\n');

const output = `/**
 * The feature modules compiled into this build.
 *
 * GENERATED FILE — do not edit. Rewritten by \`pnpm --filter @we/app-shell generate-modules\`
 * from \`we-seed.json\`'s \`modules\` list. Change the seed and regenerate; editing this by hand
 * is undone by the next build.
 *
 * Key order is the seed's order, and it is load-bearing: it is the module rail's order.
 */
import type { ModuleDefinition, ModuleHost } from '@we/module-shared';
${imports}

export const bundledModules: Record<string, (host: ModuleHost) => ModuleDefinition> = {
${members}
};
`;

const prettierConfig = await resolveConfig(outPath);
await writeFile(outPath, await format(output, { ...prettierConfig, filepath: outPath }), 'utf8');
console.log(`bundledModules.generated.ts — ${resolved.length} module(s): ${resolved.map((m) => m.id).join(', ')}`);
