import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assembleReference } from '../assembler.js';
import { extractPrimitives } from '../extractors/cem.js';
import { extractModels } from '../extractors/models.js';
import { extractTokens } from '../extractors/tokens.js';
import { extractComponentProps } from '../extractors/typescript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const designSystemRoot = resolve(repoRoot, 'packages/design-system');

// Resolve paths explicitly (same as generate.ts does)
const paths = {
  cem: resolve(designSystemRoot, '3-primitives/custom-elements.json'),
  components: resolve(designSystemRoot, '4-components/src'),
  widgets: resolve(designSystemRoot, '5-widgets/src'),
  tokens: resolve(designSystemRoot, '1-tokens/src'),
  models: resolve(repoRoot, 'packages/models/src'),
};

describe('extractPrimitives', () => {
  it('extracts primitives from CEM', () => {
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
  it('extracts models from source', () => {
    const models = extractModels(paths.models);
    expect(models.length).toBeGreaterThan(0);

    const textBlock = models.find((m) => m.name === 'TextBlock');
    expect(textBlock).toBeDefined();
    expect(textBlock!.fields.some((f) => f.name === 'text')).toBe(true);
  });

  it('extracts HasMany relations', () => {
    const models = extractModels(paths.models);
    const collection = models.find((m) => m.name === 'CollectionBlock');
    expect(collection).toBeDefined();
    expect(collection!.relations.some((r) => r.kind === 'HasMany' && r.name === 'children')).toBe(true);
  });
});

describe('assembleReference', () => {
  it('contains all expected sections', () => {
    const context = {
      primitives: extractPrimitives(paths.cem),
      components: [
        ...extractComponentProps(paths.components, 'components'),
        ...extractComponentProps(paths.widgets, 'widgets'),
      ],
      models: extractModels(paths.models),
      tokens: extractTokens(paths.tokens),
      storeEntries: [],
      fragments: {
        schemaOperators: 'schema operators content',
        designSystemProps: 'design system props content',
        routing: 'routing content',
        stores: 'stores content',
        storePatterns: 'store patterns content',
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

  it('includes specific primitives', () => {
    const context = {
      primitives: extractPrimitives(paths.cem),
      components: [
        ...extractComponentProps(paths.components, 'components'),
        ...extractComponentProps(paths.widgets, 'widgets'),
      ],
      models: extractModels(paths.models),
      tokens: extractTokens(paths.tokens),
      storeEntries: [],
      fragments: {
        schemaOperators: '',
        designSystemProps: '',
        routing: '',
        stores: '',
        storePatterns: '',
        rules: '',
      },
    };

    const reference = assembleReference(context);
    expect(reference).toContain('we-button');
    expect(reference).toContain('we-text');
    expect(reference).toContain('we-icon');
  });
});
