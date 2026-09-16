#!/usr/bin/env node
/**
 * Scaffold a feature module.
 *
 *   pnpm create-module <id> "<Name>" [--icon <phosphor-icon>]
 *
 * Writes `packages/module-system/<id>/` in the shape of the notes module — a manifest, a declared
 * entity, a panel the host owns the openness of, a part a template can place, and a test that lints
 * the definition — then says what to add to the seed and the shell's dependencies. Nothing is
 * registered by this script: the seed is the list, and adding to it is a decision.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const [id, name, ...rest] = process.argv.slice(2);
if (!id || !name) {
  console.error('Usage: pnpm create-module <id> "<Name>" [--icon <phosphor-icon>]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(
    `"${id}" must be lower-case letters, digits and dashes — it names a store, a predicate subtree and a package.`,
  );
  process.exit(1);
}
const iconAt = rest.indexOf('--icon');
const icon = iconAt >= 0 ? rest[iconAt + 1] : 'puzzle-piece';
const dir = resolve(repoRoot, 'packages/module-system', id);
if (existsSync(dir)) {
  console.error(`${dir} already exists.`);
  process.exit(1);
}

const Entity =
  name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('') || 'Item';
const storeVar = `${id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Module`;

const files = {
  'package.json': `{
  "name": "@we/module-${id}",
  "version": "0.1.0",
  "description": "${name} feature module",
  "license": "MIT",
  "type": "module",
  "scripts": {
    "build:steps": "tsup",
    "build": "we-build",
    "dev": "tsup --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "dependencies": {
    "@we/backend-shared": "workspace:*"
  },
  "peerDependencies": {
    "@we/module-shared": "workspace:*",
    "@we/schema-shared": "workspace:*"
  },
  "devDependencies": {
    "@we/cli": "workspace:*",
    "@we/module-shared": "workspace:*",
    "@we/module-testing": "workspace:*",
    "@we/schema-kit": "workspace:*",
    "@we/schema-shared": "workspace:*",
    "tsup": "^8.5.1",
    "typescript": "^5.7.2",
    "vitest": "^4.1.11"
  },
  "we": { "module": true }
}
`,
  'tsconfig.json': `{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
`,
  'tsup.config.ts': `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  external: ['@we/schema-shared', '@we/module-shared'],
});
`,
  'vitest.config.ts': `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { exclude: ['**/node_modules/**', 'dist/**'], environment: 'node', globals: true },
});
`,
  'src/entities.ts': `import type { EntityManifest } from '@we/backend-shared';

/**
 * What this module stores, declared rather than written against a backend.
 *
 * Predicates are minted under \`we://module/${id}/<property>\` for you. Reuse core vocabulary freely by
 * name (\`name\`, \`title\`, \`description\` bind to \`we://name\` and friends) — shared words are the point.
 */
export const ${id.toUpperCase().replace(/-/g, '_')}_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    ${Entity}: {
      authoring: { fields: ['title'] },
      display: { title: 'title' },
      properties: {
        title: { type: 'string', required: true, default: '' },
        version: { type: 'number', default: 0 },
      },
      relations: {},
    },
  },
};
`,
  'src/Panel.schema.ts': `import type { SchemaNode } from '@we/schema-shared';

/**
 * The panel. Everything here is a fragment: \`Column\`, \`we-text\` and the rest are registry keys, not
 * imports, so this module ships no framework code. Whether the panel is open is the host's — the rail
 * toggles it, a template opens it, the titlebar closes it.
 */
export const panel: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400' },
  $queries: { rows: { entity: '${Entity}', order: { createdAt: 'desc' }, limit: 50 } },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm' }, children: ['${name}'] },
    {
      type: '$if',
      props: {
        condition: { $: 'local.rowsLoaded && !count(local.rows)' },
        then: { type: 'we-text', props: { color: 'text-faint' }, children: ['Nothing here yet.'] },
      },
    },
    {
      type: '$each',
      props: { items: { $: 'local.rows' }, as: 'row' },
      children: [{ type: '$part', props: { id: '${id}.card' } }],
    },
  ],
};

/** One record, drawn over the row bound as \`row\`. Public API: keep it small and name it for what it is. */
export const card: SchemaNode = {
  type: 'Column',
  props: { p: 'surface', bg: 'surface', r: 'surface', border: '1px solid border' },
  children: [{ type: 'we-text', children: [{ $: 'row.title' }] }],
};
`,
  'src/index.ts': `/**
 * ${name} — <one sentence about what a community gets when they turn this on>.
 *
 * A module declares what it contributes and the host decides where it renders. Read
 * \`docs/guides/writing-a-module.md\` first, then \`@we/module-shared\`'s \`module.ts\`.
 */
import { defineModule, type ModuleDefinition, type ModuleHost } from '@we/module-shared';

import { ${id.toUpperCase().replace(/-/g, '_')}_MANIFEST } from './entities';
import { card, panel } from './Panel.schema';

export const ${storeVar}: ModuleDefinition = defineModule({
  manifest: {
    id: '${id}',
    name: '${name}',
    description: '<what a person is turning on>',
    icon: '${icon}',
    // Ask only for what the store reaches: e.g. requires: { kernels: ['records'] }. A module with no
    // store needs no kernels at all.
  },
  contributes: {
    entities: { manifest: ${id.toUpperCase().replace(/-/g, '_')}_MANIFEST },
    parts: { card },
    panels: [{ name: 'main', title: '${name}', icon: '${icon}', node: panel, bid: { edge: 'right', size: 'md' } }],
  },
  // createStore: (deps) => ({ ... }) — only for what a declaration cannot say. Mark what templates may
  // reach with deps.state / deps.action and a sentence each; everything else stays private.
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => ${storeVar};
`,
  'src/index.test.ts': `import { lintModule } from '@we/module-testing';
import { describe, expect, it } from 'vitest';

import { createModule, ${storeVar} } from './index';

describe('${name}', () => {
  it('is a definition the registry would accept', () => {
    const lint = lintModule(${storeVar});
    expect(lint.problems).toEqual([]);
    expect(lint.warnings).toEqual([]);
  });

  it('exports the factory the generated registry imports', () => {
    expect(createModule({ components: {} })).toBe(${storeVar});
  });
});
`,
};

for (const [rel, content] of Object.entries(files)) {
  const path = resolve(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

console.log(`Created packages/module-system/${id}/ (${Object.keys(files).length} files).

Next:
  1. Add "@we/module-${id}": "workspace:*" to packages/app-shell/package.json dependencies
     (and to packages/ai-context/package.json devDependencies, so the reference documents it).
  2. Add "${id}" to we-seed.json "modules" — or { "id": "${id}", "enabled": false } to ship it
     for communities to opt into.
  3. pnpm install && pnpm --filter @we/module-${id} build
  4. pnpm --filter @we/app-shell generate-modules && pnpm --filter @we/ai-context generate-context
  5. pnpm validate:schemas && pnpm --filter @we/module-${id} test

Then read docs/guides/writing-a-module.md for what each contribution is for.`);
