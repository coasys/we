import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assembleReference } from '../assembler.js';
import { extractPrimitives } from '../extractors/cem.js';
import { extractModels } from '../extractors/models.js';
import { extractTokens } from '../extractors/tokens.js';
import { extractComponentProps } from '../extractors/typescript.js';
import { contributionSurfaces } from '../fragments/contribution-surfaces.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const designSystemRoot = resolve(repoRoot, 'packages/design-system');

// Resolve paths explicitly (same as generate.ts does)
//
// `widgets` is a context *type*, not one package: generate.ts walks every package declaring
// `context.type` and merges what it finds. Two declare 'widgets' — @we/widgets, which has held no
// components since CollapsibleSidebar was retired, and @we/graph-solid, which holds GraphView. So
// the widget path here is the graph one; pointing it at 5-widgets asserted a component count that
// deleting the last widget was supposed to take to zero.
const paths = {
  cem: resolve(designSystemRoot, '3-primitives/custom-elements.json'),
  components: resolve(designSystemRoot, '4-components/src'),
  widgets: resolve(repoRoot, 'packages/graph-system/frameworks/solid/src'),
  tokens: resolve(designSystemRoot, '1-tokens/src'),
  models: resolve(repoRoot, 'packages/models/src'),
};

describe('extractPrimitives', () => {
  it('extracts primitives from CEM', async () => {
    const primitives = extractPrimitives(paths.cem);
    expect(primitives.length).toBeGreaterThan(0);

    const button = primitives.find((p) => p.tagName === 'we-button');
    expect(button).toBeDefined();
    expect(button!.ownProps.some((p) => p.name === 'variant')).toBe(true);
  });

  it('filters out DesignSystemProps', () => {
    const primitives = extractPrimitives(paths.cem);
    const button = primitives.find((p) => p.tagName === 'we-button')!;
    // DesignSystemProps like 'gap', 'p', 'bg' should be excluded
    expect(button.ownProps.some((p) => p.name === 'gap')).toBe(false);
    expect(button.ownProps.some((p) => p.name === 'bg')).toBe(false);
    expect(button.ownProps.some((p) => p.name === 'hoverProps')).toBe(false);
  });
});

describe('extractComponentProps', () => {
  it('extracts components', () => {
    const components = extractComponentProps(paths.components, 'components');
    expect(components.length).toBeGreaterThan(0);
    expect(components.every((c) => c.source === 'components')).toBe(true);
  });

  it('extracts widgets', () => {
    const widgets = extractComponentProps(paths.widgets, 'widgets');
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets.every((c) => c.source === 'widgets')).toBe(true);
  });
});

describe('extractTokens', () => {
  it('extracts token categories', () => {
    const tokens = extractTokens(paths.tokens);
    expect(tokens.length).toBeGreaterThan(0);

    const names = tokens.map((t) => t.name);
    expect(names).toContain('space');
    expect(names).toContain('size');
    expect(names).toContain('radius');
  });

  it('does not duplicate flat and composite tokens', () => {
    const tokens = extractTokens(paths.tokens);
    const names = tokens.map((t) => t.name);
    // font.size should exist (composite), fontSize should not (consumed)
    expect(names).toContain('font.size');
    expect(names).not.toContain('fontSize');
  });
});

describe('extractModels', () => {
  it('extracts models from source', async () => {
    const models = await extractModels(paths.models);
    expect(models.length).toBeGreaterThan(0);

    const textBlock = models.find((m) => m.name === 'TextBlock');
    expect(textBlock).toBeDefined();
    expect(textBlock!.fields.some((f) => f.name === 'text')).toBe(true);
  });

  it('extracts HasMany relations', async () => {
    const models = await extractModels(paths.models);
    const collection = models.find((m) => m.name === 'CollectionBlock');
    expect(collection).toBeDefined();
    expect(collection!.relations.some((r) => r.kind === 'HasMany' && r.name === 'children')).toBe(true);
  });
});

describe('assembleReference', () => {
  it('contains all expected sections', async () => {
    const context = {
      primitives: extractPrimitives(paths.cem),
      components: [
        ...extractComponentProps(paths.components, 'components'),
        ...extractComponentProps(paths.widgets, 'widgets'),
      ],
      models: await extractModels(paths.models),
      tokens: extractTokens(paths.tokens),
      storeEntries: [],
      fragments: {
        schemaOperators: 'schema operators content',
        designSystemProps: 'design system props content',
        routing: 'routing content',
        stores: 'stores content',
        storePatterns: 'store patterns content',
        patterns: 'patterns content',
        rules: 'rules content',
      },
    };

    const reference = assembleReference(context);

    // Section presence checks
    expect(reference).toContain('## Component Registry');
    expect(reference).toContain('## Design Tokens');
    expect(reference).toContain('## Block & Entity Models');
    expect(reference).toContain('schema operators content');
    expect(reference).toContain('design system props content');
    expect(reference).toContain('routing content');
    expect(reference).toContain('stores content');
    expect(reference).toContain('store patterns content');
    expect(reference).toContain('rules content');
  });

  it('includes specific primitives', async () => {
    const context = {
      primitives: extractPrimitives(paths.cem),
      components: [
        ...extractComponentProps(paths.components, 'components'),
        ...extractComponentProps(paths.widgets, 'widgets'),
      ],
      models: await extractModels(paths.models),
      tokens: extractTokens(paths.tokens),
      storeEntries: [],
      fragments: {
        schemaOperators: '',
        designSystemProps: '',
        routing: '',
        stores: '',
        storePatterns: '',
        patterns: '',
        rules: '',
      },
    };

    const reference = assembleReference(context);
    expect(reference).toContain('we-button');
    expect(reference).toContain('we-text');
    expect(reference).toContain('we-icon');
  });
});

/**
 * The contribution-surface guide and its router, held to the repository.
 *
 * Both are hand-authored lists of where things live, which is the kind of document that is correct
 * on the day it is written and wrong two months later — a package moves, a conventions file is
 * added, an example is renamed, and nothing says so. Every other hand-authored list in this pipeline
 * is checked against its source (`mergeStoreEntries` fails the build on a stale store member,
 * `templateSurface.test.ts` on an unclassified one), so these are too.
 *
 * What is deliberately NOT asserted is content. The guide is prose and should stay free to be
 * rewritten; what has to hold is that the paths resolve and that no authoring-rules file is
 * unreachable from it.
 */
describe('contribution surfaces', () => {
  const guidePath = resolve(repoRoot, 'docs/contributing/surfaces.md');
  const guide = readFileSync(guidePath, 'utf-8');

  it('names every CONVENTIONS.md in the repo', () => {
    /*
      A CONVENTIONS.md is a surface's authoring rules, so one the guide never mentions is a surface a
      contributor cannot route to — the whole failure the guide exists to fix, reappearing one
      package at a time. This is not hypothetical: the check found `app-shell/CONVENTIONS.md`
      unreferenced on its first run, because stores had been left off the guide entirely, and they
      are the surface with the strictest registration on it.

      Matched on the full path rather than the containing directory. A directory match passes on any
      incidental mention of the word "models" anywhere in 400 lines of prose, which is the kind of
      assertion that goes green forever and catches nothing.
    */
    const conventions = globSync('packages/**/CONVENTIONS.md', {
      cwd: repoRoot,
      exclude: (p) => p.includes('node_modules'),
    });
    expect(conventions.length).toBeGreaterThan(5);

    const unreferenced = conventions.filter((rel) => !guide.includes(rel));
    expect(unreferenced, 'link these from docs/contributing/surfaces.md by full path').toEqual([]);
  });

  it('only names paths that exist', () => {
    /*
      Every `packages/…` or `apps/…` path the guide quotes in backticks. A renamed reference example
      is the likeliest drift here and the least visible: the prose still reads correctly, and the
      contributor sent to copy it finds nothing.
    */
    const quoted = [...guide.matchAll(/`((?:packages|apps|docs)\/[A-Za-z0-9._/<>-]+)`/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(20);

    // `<name>` and `<id>` stand in for a directory the contributor is about to create.
    const missing = [...new Set(quoted)]
      .filter((p) => !p.includes('<'))
      .filter((p) => !existsSync(resolve(repoRoot, p.replace(/\/$/, ''))));
    expect(missing, 'these paths in docs/contributing/surfaces.md no longer exist').toEqual([]);
  });

  it('keeps the router and the guide agreeing about which surfaces exist', () => {
    /*
      The router in CLAUDE.md is the compressed copy, and a surface added to one and not the other is
      how the two start describing different repositories. Section headings in the guide are the
      source; the router must mention each by name.
    */
    const sections = [...guide.matchAll(/^### (.+)$/gm)]
      .map((m) => m[1].trim())
      .filter((h) => !h.startsWith('Currently'));
    expect(sections.length).toBeGreaterThan(10);

    const singular = (h: string) => h.replace(/s$/, '').toLowerCase();
    const router = contributionSurfaces.toLowerCase();
    const absent = sections.filter((h) => !router.includes(singular(h)));
    expect(absent, 'add these to packages/ai-context/src/fragments/contribution-surfaces.ts').toEqual([]);
  });

  it('is reachable from the docs index and the contributing guide', () => {
    const rel = relative(repoRoot, guidePath);
    expect(readFileSync(resolve(repoRoot, 'docs/README.md'), 'utf-8')).toContain('contributing/surfaces.md');
    expect(readFileSync(resolve(repoRoot, 'CONTRIBUTING.md'), 'utf-8')).toContain('contributing/surfaces.md');
    expect(rel).toBe('docs/contributing/surfaces.md');
  });
});
