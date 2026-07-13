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

import type { ContextData, ContextFragment } from '@we/schema-shared';
import { format, resolveConfig } from 'prettier';

import { aggregateFragments } from './aggregate.js';
import { assembleReference } from './assembler.js';
import { extractPrimitives } from './extractors/cem.js';
import { extractModels } from './extractors/models.js';
import { extractTokens } from './extractors/tokens.js';
import { extractComponentProps } from './extractors/typescript.js';
import { architecture } from './fragments/architecture.js';
import { designSystemProps } from './fragments/design-system-props.js';
import { devPatterns } from './fragments/dev-patterns.js';
import { routing } from './fragments/routing.js';
import { rules } from './fragments/rules.js';
import { schemaOperators } from './fragments/schema-operators.js';
import { storePatterns } from './fragments/store-patterns.js';
import { storeEntries, stores } from './fragments/stores.js';

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
};

/**
 * Discover packages with a "context" field in their package.json
 * and extract the appropriate context fragment for each.
 */
function discoverFragments(): ContextFragment[] {
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
        fragments.push({ models: extractModels(src) });
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
  const fragments = discoverFragments();
  const contextData = aggregateFragments(fragments);

  // Store entries stay manually authored for now
  contextData.storeEntries = storeEntries;

  // Shell/internal components registered in the runtime componentRegistry but intentionally
  // excluded from AI docs (no public props, not for user schemas). Listed here so the
  // validator doesn't flag them as unknown when they appear in shell schemas.
  contextData.shellComponents = ['AiPanel', 'BenchmarkTimer', 'RightPanelContainer', 'DesignToolbar', 'WeCube'];

  const context = {
    ...contextData,
    fragments: { schemaOperators, designSystemProps, routing, stores, storePatterns, rules },
  };

  // Schema-only reference — used for in-app AI (schemaContext.ts)
  const reference = assembleReference(context);

  // IDE reference — orientation-first for codebase agents: architecture (the map) →
  // schema authoring reference (the bulk/lookup) → developer patterns (gotchas appendix).
  // Architecture and dev-patterns are both excluded from the in-app AI (schemaContext.ts);
  // the `reference` block in the middle stays contiguous because it IS the in-app context.
  const ideReference = architecture.trim() + '\n\n---\n\n' + reference + '\n\n---\n\n' + devPatterns.trim();

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

  // 4. Generate schemaContext.ts (runtime constant for in-app AI)
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

  // 5. Write assembled context JSON (structured data for schema validation CLI)
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

  // 6. Generate contextData.ts (runtime constant for schema validation)
  const contextDataPath = resolve(packageRoot, 'src/contextData.ts');
  const contextDataContent = [
    '// AUTO-GENERATED by packages/ai-context/src/generate.ts',
    '// Do not edit manually. Run: pnpm --filter @we/ai-context generate-context',
    `import type { ContextData } from '@we/schema-shared';`,
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
  AD4M runtime, the core concepts, the package layering, and the render pipeline.
- **Authoring a WE UI schema (JSON)?** Skip to the **Schema Structure**, **Component Registry**,
  and **Design Tokens** sections. All schemas must be valid JSON using only the components, props,
  tokens, and patterns documented there.

---

${reference}
`;
}

await main();
