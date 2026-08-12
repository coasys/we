/**
 * Export the bundled templates as marketplace-ready records.
 *
 * ## Why this exists
 *
 * Templates in this repo are validated: they are `.schema.ts`, typechecked, and walked by
 * `pnpm --filter @we/schema-shared validate`, so a renamed prop or a deleted component breaks the
 * build. A template in the marketplace is a `Template.schema` **string** in a perspective, checked
 * by nothing — so the moment the two are maintained separately, the published copy starts rotting
 * and nobody finds out until someone installs it.
 *
 * Publishing by hand is fine exactly once. This makes the marketplace copy a *derivative* of the
 * validated source, so re-publishing after a fix is one command rather than six careful ones.
 *
 * ## What it does and does not do
 *
 * It writes a JSON bundle. It does **not** talk to a backend, because publishing is an authored act
 * by a specific agent into a specific space: it needs a running executor, an unlocked agent, and
 * the marketplace dataset joined — none of which a build script should assume, and all of which the
 * app already has. So this produces the payload and the app consumes it through
 * `templateStore.publishToMarketplace`.
 *
 * Splitting it that way also keeps the destructive half where a human is watching. A script that
 * could overwrite every published template in a shared space, run from CI, is a bad idea
 * independent of how careful the script is.
 *
 * Run: `pnpm --filter @we/app-shell publish-templates [outfile]`
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outPath = process.argv[2] ?? resolve(repoRoot, 'template-bundle.json');

// Run under `tsx` (see the package script): the schemas are TypeScript importing TypeScript, and
// tsx is already how the schema validator runs them without a build step.
const seed = JSON.parse(await readFile(resolve(repoRoot, 'we-seed.json'), 'utf8'));
const ids = seed.templates ?? ['default'];

const { bundledTemplates } = await import(resolve(here, '../src/shared/registries/bundledTemplates.generated.ts'));

const templates = [];
for (const id of ids) {
  const schema = bundledTemplates[id];
  if (!schema) {
    console.error(`seed names "${id}" but the generated registry has no such template — run generate-templates first`);
    process.exit(1);
  }
  const meta = schema.meta ?? {};
  templates.push({
    slug: id,
    name: meta.name ?? id,
    description: meta.description ?? '',
    icon: meta.icon ?? 'file',
    // Stringified here rather than at the call site because that is the shape `Template.schema`
    // stores, and doing it now means the bundle is exactly what gets written.
    schema: JSON.stringify(schema),
  });
}

await writeFile(outPath, `${JSON.stringify({ templates }, null, 2)}\n`, 'utf8');
console.log(`${outPath} — ${templates.length} template(s): ${templates.map((t) => t.slug).join(', ')}`);
console.log('Install into a marketplace space from the app: Settings → Templates → Publish.');
