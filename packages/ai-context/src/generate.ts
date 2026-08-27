/**
 * Build-time generate script.
 *
 * 1. Discovers packages with a "context" field in package.json
 * 2. Calls the appropriate extractor for each discovered package
 * 3. Aggregates fragments into unified ContextData
 * 4. Assembles the full context reference
 * 5. Writes instruction files (for local AI agents)
 * 6. Generates schemaContext.ts (for in-app AI)
 *
 * Run via: node --import tsx packages/ai-context/src/generate.ts
 * Or via: pnpm --filter @we/ai-context generate-context
 */

import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContextData, ContextFragment, StoreEntry } from '@we/schema-shared';
import { format, resolveConfig } from 'prettier';

import { aggregateFragments } from './aggregate.js';
import { assembleReference } from './assembler.js';
import {
  type ExtractedStore,
  extractRegisteredComponents,
  extractStores,
  extractWiringMembers,
} from './extractors/appShell.js';
import { extractPrimitives } from './extractors/cem.js';
import { extractModels } from './extractors/models.js';
import { extractPluginCatalog } from './extractors/plugins.js';
import { extractTokens } from './extractors/tokens.js';
import { extractComponentProps } from './extractors/typescript.js';
import { architecture } from './fragments/architecture.js';
import { contributionSurfaces } from './fragments/contribution-surfaces.js';
import { designSystemProps } from './fragments/design-system-props.js';
import { devPatterns } from './fragments/dev-patterns.js';
import { panels } from './fragments/panels.js';
import { patterns } from './fragments/patterns.js';
import { routing } from './fragments/routing.js';
import { rules } from './fragments/rules.js';
import { schemaOperators } from './fragments/schema-operators.js';
import { storePatterns } from './fragments/store-patterns.js';
import { generateStoresText, storeEntries } from './fragments/stores.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From src/generate.ts: up to ai-context/, up to packages/, up to repo root
const packageRoot = resolve(__dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

/** Default source paths per context type (relative to the package directory) */
const DEFAULTS: Record<string, string> = {
  primitives: 'custom-elements.json',
  components: 'src',
  widgets: 'src',
  tokens: 'src',
  models: 'src',
  plugins: 'src/catalog.ts',
};

/**
 * Join the derived store shape to the hand-authored metadata, and say where the two disagree.
 *
 * The source decides *what exists* — a member absent here cannot be named in a schema, and one
 * present is allowed whether or not anybody has described it. The fragment decides *what it means*:
 * the prose in `fragments/stores.ts` and, more load-bearing, `StateMemberMeta`'s
 * `properties`/`model`, which is what lets the validator check one level into a `$store` path.
 *
 * Both directions of drift are reported, because they fail differently. A member with no entry is
 * merely undocumented — the AI reference is thinner than it could be. A fragment entry for a member
 * that no longer exists is worse: it documents something that isn't there, and its metadata would
 * silently license a `$store` path into nothing.
 */
function mergeStoreEntries(
  derived: ExtractedStore[],
  authored: StoreEntry[],
  wiring: Map<string, Set<string>>,
): StoreEntry[] {
  const byName = new Map(authored.map((s) => [s.name, s]));
  const undocumented: string[] = [];
  const stale: string[] = [];

  /*
    Host wiring leaves the list before anything else looks at it.

    `templateSurface.ts` is the one place that decides what a schema may name, and a member it
    classifies as wiring is absent from every bag. Listing it anyway — as the generator did, under
    `unknown` — told an author (and an LLM) that `sessionStore.token` and `templateStore.replaceTemplate`
    were vocabulary with a missing description, when the truth is that no template can reach them.
    Dropped here, the validator reports a reference to one as an unknown member, which is the accurate
    complaint.
  */
  for (const store of derived) {
    const hidden = wiring.get(store.name);
    if (!hidden) continue;
    for (const key of Object.keys(store.state)) if (hidden.has(key)) delete store.state[key];
    store.actions = store.actions.filter((action) => !hidden.has(action));
  }

  /*
    A hand-authored entry with no interface behind it is kept, not dropped.

    `model` is the case that matters: `model.create` / `.update` / `.delete` are bound by the
    template provider rather than declared as a store, so there is no `ModelStore` to read. Dropping
    anything the extractor cannot see would have made every `model.create` in every schema an unknown
    method — a generator quietly deleting vocabulary is worse than one that keeps too much.
  */
  const pseudo = authored.filter((s) => !derived.some((d) => d.name === s.name));
  if (pseudo.length) {
    console.log(`  Stores declared without an interface, kept as authored: ${pseudo.map((s) => s.name).join(', ')}`);
  }

  const merged = derived.map((store) => {
    const hand = byName.get(store.name);
    if (!hand) {
      undocumented.push(store.name);
      return store as StoreEntry;
    }

    const state: StoreEntry['state'] = {};
    for (const [key, meta] of Object.entries(store.state)) {
      // Hand-authored metadata wins: it carries `properties`/`model`, which is the half that cannot
      // be derived. The derived coarse type is the fallback for anything newly added.
      state[key] = hand.state[key] ?? meta;
      if (!hand.state[key]) undocumented.push(`${store.name}.${key}`);
    }
    for (const key of Object.keys(hand.state)) {
      if (!(key in store.state)) stale.push(`${store.name}.${key}`);
    }
    for (const action of hand.actions) {
      if (!store.actions.includes(action)) stale.push(`${store.name}.${action}()`);
    }
    for (const action of store.actions) {
      if (!hand.actions.includes(action)) undocumented.push(`${store.name}.${action}()`);
    }

    return { name: store.name, state, actions: store.actions };
  });

  if (stale.length) {
    console.warn(`  ⚠ fragments/stores.ts describes members that no longer exist: ${stale.join(', ')}`);
    // A stale entry documents vocabulary that resolves to nothing — always wrong, so it fails
    // the build rather than scrolling past as a warning nobody acts on. (The undocumented
    // direction below stays informational: most of those are internal wiring.)
    process.exitCode = 1;
  }
  /*
    Counted, not listed.

    Most undocumented members are internal wiring a schema has no business naming — `provideSpaceLookup`,
    `setNavigateFunction`, `backendPorts` — and nothing here can tell those from a template-facing
    member somebody forgot to write up. Printing a hundred names every run would bury the stale list
    above, which is the half that is always worth acting on. The count is enough to notice a jump.
  */
  if (undocumented.length) {
    console.log(`  ${undocumented.length} store members are valid in schemas but undocumented (mostly internal).`);
  }

  return [...merged, ...pseudo];
}

/**
 * Discover packages with a "context" field in their package.json
 * and extract the appropriate context fragment for each.
 */
async function discoverFragments(): Promise<ContextFragment[]> {
  const fragments: ContextFragment[] = [];

  // Scan all workspace packages recursively (excludes node_modules).
  // Sort so directory numbering (1-tokens, 3-primitives, 4-components, 5-widgets)
  // controls output order — components before widgets.
  const pkgPaths = globSync('packages/**/package.json', {
    cwd: repoRoot,
    exclude: (p) => p.includes('node_modules'),
  }).sort();

  for (const rel of pkgPaths) {
    const abs = resolve(repoRoot, rel);
    const pkg = JSON.parse(readFileSync(abs, 'utf-8'));
    const config = pkg.context;
    if (!config?.type) continue;

    const pkgDir = dirname(abs);
    const src = resolve(pkgDir, config.src ?? DEFAULTS[config.type]);

    console.log(`  Discovered: ${pkg.name ?? rel} (type: ${config.type})`);

    switch (config.type) {
      case 'primitives':
        fragments.push({ primitives: extractPrimitives(src) });
        break;
      case 'components':
        fragments.push({ components: extractComponentProps(src, 'components') });
        break;
      case 'widgets':
        fragments.push({ components: extractComponentProps(src, 'widgets') });
        break;
      case 'tokens':
        fragments.push({ tokens: extractTokens(src) });
        break;
      case 'models':
        fragments.push({ models: await extractModels(src) });
        break;
      case 'plugins':
        fragments.push({ pluginCatalogs: await extractPluginCatalog(src) });
        break;
      default:
        console.warn(`  Warning: unknown context type "${config.type}" in ${rel}`);
    }
  }

  return fragments;
}

/**
 * Formats generated content with the repo's Prettier config before writing.
 * Raw JSON.stringify output doesn't collapse short arrays onto one line the
 * way Prettier does, so re-running the generator with no source changes
 * would otherwise produce a diff against the Prettier-formatted version
 * already on disk.
 */
async function writeFormatted(filepath: string, content: string): Promise<void> {
  const config = await resolveConfig(filepath);
  const formatted = await format(content, { ...config, filepath });
  writeFileSync(filepath, formatted, 'utf-8');
}

async function main() {
  console.log('Generating AI context...');

  // Discover and extract context from all workspace packages
  const fragments = await discoverFragments();
  const contextData = aggregateFragments(fragments);

  // Names come from the source, meaning comes from the fragment. See `extractors/appShell.ts`.
  contextData.storeEntries = mergeStoreEntries(
    extractStores(resolve(repoRoot, 'packages/app-shell/src/frameworks/solid/stores')),
    storeEntries,
    extractWiringMembers(resolve(repoRoot, 'packages/app-shell/src/shared/registries/templateSurface.ts')),
  );

  /*
    Components the host registers that the design-system packages don't document — shell chrome,
    lazy-loaded marketplace cards, a module's contributed widget. Listed so the validator doesn't
    report them as unknown, and derived from the registry rather than remembered: it is the single
    source for what a template may name, and a hand-copied subset of it drifted twice.
  */
  const registered = extractRegisteredComponents(
    resolve(repoRoot, 'packages/app-shell/src/frameworks/solid/registries/componentRegistry.tsx'),
  );
  const documented = new Set([
    ...(contextData.primitives ?? []).map((p) => p.tagName),
    ...(contextData.components ?? []).map((c) => c.name),
  ]);
  contextData.shellComponents = registered.filter((name) => !documented.has(name));

  const context = {
    ...contextData,
    fragments: {
      schemaOperators,
      designSystemProps,
      routing,
      panels,
      // Rebuilt from the merged entries rather than reusing the fragment's own text, so the prose in
      // the reference lists exactly the members the validator accepts.
      stores: generateStoresText(contextData.storeEntries ?? []),
      storePatterns,
      patterns,
      rules,
    },
  };

  // Schema-only reference — used for in-app AI (schemaContext.ts)
  const reference = assembleReference(context);

  // IDE reference — orientation-first for codebase agents: architecture (the map) → contribution
  // surfaces (where a change belongs) → schema authoring reference (the bulk/lookup) → developer
  // patterns (gotchas appendix). Architecture, surfaces and dev-patterns are all excluded from the
  // in-app AI (schemaContext.ts); the `reference` block in the middle stays contiguous because it IS
  // the in-app context.
  //
  // Surfaces sits second because it answers the question that comes after "what is this codebase"
  // and before any of the lookup below: which of nineteen slots does the thing I am about to write
  // belong in. Read later it is useless — by then the file has already been created in the wrong one.
  const ideReference = [architecture.trim(), contributionSurfaces.trim(), reference, devPatterns.trim()].join(
    '\n\n---\n\n',
  );

  // 1. Write instruction file for GitHub Copilot
  const instructionContent = wrapWithFraming(ideReference);
  const copilotPath = resolve(repoRoot, '.github/copilot-instructions.md');
  mkdirSync(dirname(copilotPath), { recursive: true });
  writeFileSync(copilotPath, instructionContent, 'utf-8');
  console.log(`  Written: ${copilotPath}`);

  // 2. Write CLAUDE.md for Claude Code (terminal agent)
  const claudePath = resolve(repoRoot, 'CLAUDE.md');
  writeFileSync(claudePath, instructionContent, 'utf-8');
  console.log(`  Written: ${claudePath}`);

  // 3. Write Cursor rules file
  const cursorDir = resolve(repoRoot, '.cursor/rules');
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(resolve(cursorDir, 'we-schema.mdc'), instructionContent, 'utf-8');
  console.log(`  Written: ${resolve(cursorDir, 'we-schema.mdc')}`);

  /*
    4. Write AGENTS.md — the same content again, under the name the rest of the field reads.

    The three files above are one per vendor, and the list only grows: an outside contributor
    arriving with a coding agent WE has never heard of gets nothing, and the surfaces guide this
    reference now carries is aimed squarely at that person. AGENTS.md is the cross-tool convention,
    so it costs one more write and stops the answer to "will my agent understand this repo" from
    depending on which agent it is.

    Identical bytes rather than a subset, deliberately. A trimmed variant would be a fourth thing to
    keep in agreement with the fragments, and the ways it would drift are exactly the ways the
    vendor files did before they were generated.
  */
  const agentsPath = resolve(repoRoot, 'AGENTS.md');
  writeFileSync(agentsPath, instructionContent, 'utf-8');
  console.log(`  Written: ${agentsPath}`);

  // 5. Generate schemaContext.ts (runtime constant for in-app AI)
  // Uses the schema-only `reference` — devPatterns are intentionally excluded here
  // because an AI editing JSON templates inside the app doesn't need codebase patterns.
  const schemaContextPath = resolve(packageRoot, 'src/schemaContext.ts');
  const schemaContextContent = [
    '// AUTO-GENERATED by packages/ai-context/src/generate.ts',
    '// Do not edit manually. Run: pnpm --filter @we/ai-context generate-context',
    '',
    `export const schemaContext = ${JSON.stringify(reference)};`,
    '',
  ].join('\n');
  writeFileSync(schemaContextPath, schemaContextContent, 'utf-8');
  console.log(`  Written: ${schemaContextPath}`);

  // 6. Write assembled context JSON (structured data for schema validation CLI)
  // Only the ContextData fields — excludes fragments (AI prompt text, ~50KB)
  const contextJsonPath = resolve(packageRoot, 'context.json');
  const contextJson: ContextData = {
    primitives: context.primitives,
    components: context.components,
    models: context.models,
    tokens: context.tokens,
    storeEntries: context.storeEntries,
    shellComponents: context.shellComponents,
  };
  await writeFormatted(contextJsonPath, JSON.stringify(contextJson, null, 2));
  console.log(`  Written: ${contextJsonPath}`);

  // 7. Generate contextData.ts — the runtime component-metadata constant.
  //
  // Written into @we/schema-shared rather than this package, because it is runtime data consumed
  // beside `getComponentMeta` (schema validation, the editor's inspector) — this package's job is
  // generation, and nothing that runs in an app should need the doc generator in its dependency
  // graph. Same arrangement as CLAUDE.md at the repo root: this tool writes files other places own.
  const contextDataPath = resolve(packageRoot, '../schema-system/shared/src/generated/contextData.ts');
  const contextDataContent = [
    '// AUTO-GENERATED by packages/ai-context/src/generate.ts',
    '// Do not edit manually. Run: pnpm --filter @we/ai-context generate-context',
    `import type { ContextData } from '../contextTypes';`,
    '',
    `export const contextData: ContextData = ${JSON.stringify(contextJson)};`,
    '',
  ].join('\n');
  await writeFormatted(contextDataPath, contextDataContent);
  console.log(`  Written: ${contextDataPath}`);

  console.log('Done.');
}

function wrapWithFraming(reference: string): string {
  return `# WE — Codebase & Schema Reference

This file is auto-generated by \`@we/ai-context\`. Do not edit manually.
Regenerate with: \`pnpm --filter @we/ai-context generate-context\`

This reference serves two modes:
- **Working in the codebase?** Start with **Architecture Orientation** below — what WE is, its
  AD4M runtime, the core concepts, the package layering, and the render pipeline. Then
  **Contribution Surfaces**, which routes what you are about to build to the slot it belongs in,
  and names the file that registers it — the step whose omission fails silently.
- **Authoring a WE UI schema (JSON)?** Skip to the **Schema Structure**, **Component Registry**,
  and **Design Tokens** sections. All schemas must be valid JSON using only the components, props,
  tokens, and patterns documented there.

---

${reference}
`;
}

await main();
