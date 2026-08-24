/**
 * Writes the bundled-view registry from the deployment seed.
 *
 * The sibling of `generateTemplateRegistry.mjs`, for the same build-time reason: filtering a static
 * map at boot hides a view from the section list while still shipping every byte of it. Generating
 * the imports means an unselected view is never referenced, so the bundler never reaches it — a
 * deployment building a project tool ships tasks and calendar and pays nothing for the Cesium globe.
 *
 * Run: `pnpm --filter @we/app-shell generate-views`
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outPath = resolve(here, '../src/shared/registries/bundledViews.generated.ts');

/**
 * Every view this monorepo can bundle: id → { module, export }.
 *
 * As with templates, the catalogue is written rather than discovered, because a view's *id* is a
 * stable public name — it appears in `we-seed.json`, in `Space.enabledViews`, and in an agent's
 * hidden list — while its file path is an implementation detail. Deriving one from the other would
 * make moving a file a breaking change for every space that had turned a section off.
 */
const CATALOGUE = {
  about: { module: '@we/template-views', export: 'aboutView' },
  cards: { module: '@we/template-views', export: 'cardsView' },
  graph: { module: '@we/template-views', export: 'graphView' },
  globe: { module: '@we/template-views', export: 'globeView' },
  tasks: { module: '@we/template-views', export: 'tasksView' },
  calendar: { module: '@we/template-views', export: 'calendarView' },
  flux: { module: '@we/template-views', export: 'fluxView' },
};

const seed = JSON.parse(await readFile(resolve(repoRoot, 'we-seed.json'), 'utf8'));
const requested = seed.views ?? Object.keys(CATALOGUE);

const unknown = requested.filter((id) => !(id in CATALOGUE));
if (unknown.length) {
  console.error(
    `we-seed.json declares views this monorepo does not contain: ${unknown.join(', ')}\n` +
      `Known ids: ${Object.keys(CATALOGUE).join(', ')}`,
  );
  process.exit(1);
}

/*
  Unlike templates, there is no view a deployment cannot decline.

  `default` is forced into the template list because a space whose template is missing renders
  nothing and reads as a broken app. A space with no sections is not that: the shell still paints,
  the nav strip is simply empty, and a deployment that wants a space to be only its chrome — a
  landing page, a kiosk — is expressing a real choice rather than tripping over one.
*/
const ids = requested;

const byModule = new Map();
for (const id of ids) {
  const entry = CATALOGUE[id];
  if (!byModule.has(entry.module)) byModule.set(entry.module, []);
  byModule.get(entry.module).push({ id, export: entry.export });
}

const imports = [...byModule.entries()]
  .map(([module, entries]) => {
    const names = [...new Set(entries.map((e) => e.export))].sort();
    return `import { ${names.join(', ')} } from '${module}';`;
  })
  .join('\n');

const members = ids.map((id) => `  ${JSON.stringify(id)}: ${CATALOGUE[id].export},`).join('\n');

const output = `/**
 * The views compiled into this build.
 *
 * GENERATED FILE — do not edit. Rewritten by \`pnpm --filter @we/app-shell generate-views\`
 * from \`we-seed.json\`'s \`views\` list. Change the seed and regenerate; editing this by hand
 * is undone by the next build.
 *
 * Key order is the seed's order, and it is load-bearing: it is the default order sections appear in.
 */
import type { TemplateSchema } from '@we/schema-shared';
${imports}

export const bundledViews: Record<string, TemplateSchema> = {
${members}
};
`;

const prettierConfig = await resolveConfig(outPath);
await writeFile(outPath, await format(output, { ...prettierConfig, filepath: outPath }), 'utf8');
console.log(`bundledViews.generated.ts — ${ids.length} view(s): ${ids.join(', ')}`);
