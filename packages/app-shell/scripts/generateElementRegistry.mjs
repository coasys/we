/**
 * Writes the foreign-element registry from the deployment seed.
 *
 * The sibling of `generateModuleRegistry.mjs`. A seed's `elements` names custom elements from a
 * library the deployment bundles — `{ "package": "@shoelace-style/shoelace", "define": [...],
 * "tags": ["sl-rating"] }` — and this turns that into the imports that define them, so a template
 * naming `sl-rating` mounts something rather than an empty unknown element.
 *
 * The renderer needs nothing else: it already mounts any hyphenated tag as that tag, sets its props
 * as properties and binds `on:event-name` handlers. What the seed adds is that the deployment has
 * chosen to trust this code, which is what makes the validator accept the tags and the reference
 * document them (see `extractors/foreignElements.ts` in `@we/ai-context`).
 *
 * Run: `pnpm --filter @we/app-shell generate-elements`
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outPath = resolve(here, '../src/shared/registries/foreignElements.generated.ts');
const appShellModules = resolve(here, '../node_modules');

const seed = JSON.parse(await readFile(resolve(repoRoot, 'we-seed.json'), 'utf8'));
const entries = seed.elements ?? [];

const fail = (message) => {
  console.error(`we-seed.json elements: ${message}`);
  process.exit(1);
};

if (!Array.isArray(entries)) fail('must be a list');

/** The tags a package's custom-elements manifest declares, or [] where there is none to read. */
function manifestTags(entry) {
  const dir = resolve(appShellModules, entry.package);
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  const path = entry.manifest ?? pkg.customElements;
  if (!path || !existsSync(resolve(dir, path))) return [];
  const cem = JSON.parse(readFileSync(resolve(dir, path), 'utf8'));
  return (cem.modules ?? []).flatMap((mod) =>
    (mod.declarations ?? []).filter((d) => d.customElement && d.tagName).map((d) => d.tagName),
  );
}

const seen = new Map();
const resolved = entries.map((entry, index) => {
  if (!entry?.package) fail(`entry ${index} names no package`);
  /*
    Checked against the app shell's own dependencies, where the bundler will look — the same check
    and the same reason as the module registry: a missing package otherwise fails the build a minute
    later with a message naming a path nobody wrote.
  */
  if (!existsSync(resolve(appShellModules, entry.package))) {
    fail(`"${entry.package}" is not installed for @we/app-shell — add it to packages/app-shell/package.json`);
  }
  const tags = entry.tags ?? manifestTags(entry);
  if (!tags.length) {
    fail(`"${entry.package}" names no tags and has no custom-elements manifest to read them from — list "tags"`);
  }
  for (const tag of tags) {
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)) fail(`"${tag}" is not a custom-element name`);
    // `we-` is the design system's own namespace; a library element there would shadow a primitive.
    if (tag.startsWith('we-')) fail(`"${tag}" is in WE's own namespace`);
    if (seen.has(tag)) fail(`"${tag}" is named by both ${seen.get(tag)} and ${entry.package}`);
    seen.set(tag, entry.package);
  }
  return { package: entry.package, define: entry.define ?? [entry.package], tags };
});

const imports = resolved
  .flatMap((entry) => entry.define)
  .map((specifier) => `import '${specifier}';`)
  .join('\n');
const tags = resolved.flatMap((entry) => entry.tags);

const output = `/**
 * Custom elements from libraries this deployment bundles.
 *
 * GENERATED FILE — do not edit. Rewritten by \`pnpm --filter @we/app-shell generate-elements\`
 * from \`we-seed.json\`'s \`elements\` list. The imports define the elements; the list is the tags a
 * template may name because of them.
 */
${imports}

export const foreignElementTags: readonly string[] = ${JSON.stringify(tags)};
`;

const prettierConfig = await resolveConfig(outPath);
await writeFile(outPath, await format(output, { ...prettierConfig, filepath: outPath }), 'utf8');
console.log(`foreignElements.generated.ts — ${tags.length} element(s)${tags.length ? `: ${tags.join(', ')}` : ''}`);
