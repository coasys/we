import { describe, expect, it } from 'vitest';

import { zSchemaNode, zSchemaProp } from '../src/zodSchemas';

describe('token shape validation', () => {
  // --- expressions ---
  describe('{ $: … }', () => {
    it('accepts an expression token', () => {
      expect(() => zSchemaProp.parse({ $: 'userStore.name' })).not.toThrow();
    });

    it('rejects an empty expression', () => {
      expect(() => zSchemaProp.parse({ $: '' })).toThrow();
    });

    it('rejects a non-string expression', () => {
      expect(() => zSchemaProp.parse({ $: 123 })).toThrow();
    });

    it('rejects an expression with extra keys', () => {
      expect(() => zSchemaProp.parse({ $: 'x.y', extra: true })).toThrow();
    });
  });

  // --- $action ---
  describe('$action', () => {
    it('accepts valid $action token', () => {
      expect(() => zSchemaProp.parse({ $action: 'routeStore.navigate' })).not.toThrow();
    });

    it('accepts $action with args, including expressions', () => {
      expect(() =>
        zSchemaProp.parse({ $action: 'routeStore.navigate', args: ['/home', { $: 'event.detail' }] }),
      ).not.toThrow();
    });

    it('rejects $action with empty string', () => {
      expect(() => zSchemaProp.parse({ $action: '' })).toThrow();
    });

    it('rejects $action with extra keys', () => {
      expect(() => zSchemaProp.parse({ $action: 'x', args: [], extra: 1 })).toThrow();
    });
  });

  // --- $if (the handler conditional) ---
  describe('$if', () => {
    it('accepts a condition with a then handler', () => {
      expect(() =>
        zSchemaProp.parse({ $if: { condition: { $: 'formValid()' }, then: { $action: 'store.submit' } } }),
      ).not.toThrow();
    });

    it('accepts an else handler', () => {
      expect(() =>
        zSchemaProp.parse({
          $if: {
            condition: { $: 'local.open' },
            then: { $toggleLocal: 'open' },
            else: { $setLocal: 'open', value: true },
          },
        }),
      ).not.toThrow();
    });

    it('rejects $if missing condition', () => {
      expect(() => zSchemaProp.parse({ $if: { then: { $action: 'x.y' } } })).toThrow();
    });

    it('rejects $if with wrong shape', () => {
      expect(() => zSchemaProp.parse({ $if: true })).toThrow();
    });

    it('rejects $if with extra keys on outer object', () => {
      expect(() => zSchemaProp.parse({ $if: { condition: true, then: 'y' }, extra: 1 })).toThrow();
    });
  });

  // --- Retired value operators ---
  describe('retired value operators', () => {
    it.each(['$store', '$local', '$concat', '$eq', '$not', '$and', '$count', '$map', '$pick', '$plural', '$error'])(
      'rejects %s, which is now written as an expression',
      (key) => {
        expect(() => zSchemaProp.parse({ [key]: 'x' })).toThrow();
      },
    );
  });

  // --- Unrecognised operator warning ---
  describe('unrecognised $-key', () => {
    it('warns on unrecognised $-prefixed key in record fallback', () => {
      // Falls through to z.record() since no token schema matches, then superRefine catches it.
      // Zod will throw because superRefine adds an issue.
      expect(() => zSchemaProp.parse({ $unknown: 'something' })).toThrow();
    });

    it('allows plain objects without $-keys', () => {
      expect(() => zSchemaProp.parse({ foo: 'bar', count: 42 })).not.toThrow();
    });
  });
});

describe('node-level operator validation', () => {
  // --- $each ---
  describe('$each', () => {
    it('accepts valid $each node', () => {
      const node = {
        type: '$each',
        props: { items: { $: 'list.items' } },
        children: [{ type: 'we-text' }],
      };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('rejects $each without items prop', () => {
      const node = {
        type: '$each',
        props: {},
        children: [{ type: 'we-text' }],
      };
      expect(() => zSchemaNode.parse(node)).toThrow();
    });

    it('rejects $each without children', () => {
      const node = {
        type: '$each',
        props: { items: { $: 'list.items' } },
      };
      expect(() => zSchemaNode.parse(node)).toThrow(/\$each requires at least one child/);
    });

    it('rejects $each with empty children array', () => {
      const node = {
        type: '$each',
        props: { items: { $: 'list.items' } },
        children: [],
      };
      expect(() => zSchemaNode.parse(node)).toThrow(/\$each requires at least one child/);
    });

    it('rejects $each missing both items and children', () => {
      const node = { type: '$each' };
      const result = () => zSchemaNode.parse(node);
      expect(result).toThrow();
    });
  });

  // --- $if ---
  describe('$if', () => {
    it('accepts valid $if node', () => {
      const node = {
        type: '$if',
        props: {
          condition: { $: 'flags.visible' },
          then: { type: 'we-text' },
        },
      };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('accepts $if node with else', () => {
      const node = {
        type: '$if',
        props: {
          condition: { $: 'flags.visible' },
          then: { type: 'we-text' },
          else: { type: 'we-text', props: { content: 'hidden' } },
        },
      };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('rejects $if without condition', () => {
      const node = {
        type: '$if',
        props: { then: { type: 'we-text' } },
      };
      expect(() => zSchemaNode.parse(node)).toThrow();
    });

    it('rejects $if without then', () => {
      const node = {
        type: '$if',
        props: { condition: true },
      };
      expect(() => zSchemaNode.parse(node)).toThrow();
    });

    it('rejects $if with no props', () => {
      const node = { type: '$if' };
      expect(() => zSchemaNode.parse(node)).toThrow();
    });
  });

  // --- $routes ---
  describe('$routes', () => {
    it('accepts valid $routes node with routes', () => {
      const node = {
        type: '$routes',
        routes: [{ type: 'Page', path: '/home' }],
      };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('accepts $routes as a render slot marker (no routes)', () => {
      const node = { type: '$routes' };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('accepts $routes with empty routes array', () => {
      const node = { type: '$routes', routes: [] };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });
  });

  // --- Non-operator nodes unaffected ---
  it('does not apply operator checks to regular nodes', () => {
    const node = { type: 'we-button', props: { label: 'Click' } };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });
});
