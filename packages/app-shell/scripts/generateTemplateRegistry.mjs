/**
 * Writes the bundled-template registry from the deployment seed.
 *
 * Build-time rather than runtime selection, and the difference is the whole point. Filtering a
 * static map at boot hides a template from the picker while still shipping every byte of it — every
 * showcase template, in a deployment that wanted none of them. Generating the imports means an
 * unselected template is never referenced, so the bundler never reaches it.
 *
 * The generated file is committed and diffed in CI, like `coreManifest.ts` and the ai-context
 * outputs: a generated artifact that is not committed is one that differs between two developers'
 * checkouts for reasons neither can see.
 *
 * Run: `pnpm --filter @we/app-shell generate-templates`
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outPath = resolve(here, '../src/shared/registries/bundledTemplates.generated.ts');

/**
 * Every template this monorepo can bundle: id → { module, export }.
 *
 * The catalogue lives here rather than being discovered from the filesystem, because a template's
 * *id* is a stable public name — it appears in `we-seed.json`, in `AgentSettings.defaultTemplateId`,
 * and in `?template=` share links — while its file path is an implementation detail that has already
 * moved once. Deriving one from the other would make a refactor a breaking change for existing
 * agents' stored settings.
 */
const CATALOGUE = {
  default: { module: '@we/template-default', export: 'defaultTemplate' },
  discord: { module: '@we/template-showcase', export: 'discordTemplate' },
  twitter: { module: '@we/template-showcase', export: 'twitterTemplate' },
  instagram: { module: '@we/template-showcase', export: 'instagramTemplate' },
  youtube: { module: '@we/template-showcase', export: 'youtubeTemplate' },
  kanban: { module: '@we/template-showcase', export: 'kanbanTemplate' },
  events: { module: '@we/template-showcase', export: 'eventsTemplate' },
};

const seed = JSON.parse(await readFile(resolve(repoRoot, 'we-seed.json'), 'utf8'));
const requested = seed.templates ?? ['default'];

const unknown = requested.filter((id) => !(id in CATALOGUE));
if (unknown.length) {
  console.error(
    `we-seed.json declares templates this monorepo does not contain: ${unknown.join(', ')}\n` +
      `Known ids: ${Object.keys(CATALOGUE).join(', ')}`,
  );
  process.exit(1);
}

// `default` is always present. A deployment can decline every showcase template; it cannot decline
// having *any* template, because a space whose configured template is missing renders nothing and
// the failure looks like a broken app rather than a configuration choice.
const ids = requested.includes('default') ? requested : ['default', ...requested];

// Group by source module so the emitted file has one import per package rather than one per
// template — prettier-stable, and it reads as the dependency list it is.
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
 * The templates compiled into this build.
 *
 * GENERATED FILE — do not edit. Rewritten by \`pnpm --filter @we/app-shell generate-templates\`
 * from \`we-seed.json\`'s \`templates\` list. Change the seed and regenerate; editing this by hand
 * is undone by the next build.
 *
 * Generated rather than filtered at runtime so an unselected template leaves the import graph
 * entirely — a deployment that wants none of the showcase templates ships none of their bytes.
 */
import type { TemplateSchema } from '@we/schema-shared';
${imports}

export const bundledTemplates: Record<string, TemplateSchema> = {
${members}
};
`;

await writeFile(outPath, output, 'utf8');
console.log(`bundledTemplates.generated.ts — ${ids.length} template(s): ${ids.join(', ')}`);
