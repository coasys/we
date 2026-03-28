import { describe, expect, it } from 'vitest';

import { zSchemaNode, zSchemaProp } from '../src/zodSchemas';

describe('token shape validation', () => {
  // --- $store ---
  describe('$store', () => {
    it('accepts valid $store token', () => {
      expect(() => zSchemaProp.parse({ $store: 'userStore.name' })).not.toThrow();
    });

    it('rejects $store with empty string', () => {
      expect(() => zSchemaProp.parse({ $store: '' })).toThrow();
    });

    it('rejects $store with non-string value', () => {
      expect(() => zSchemaProp.parse({ $store: 123 })).toThrow();
    });

    it('rejects $store with extra keys', () => {
      expect(() => zSchemaProp.parse({ $store: 'x.y', extra: true })).toThrow();
    });
  });

  // --- $concat ---
  describe('$concat', () => {
    it('accepts valid $concat token', () => {
      expect(() => zSchemaProp.parse({ $concat: ['hello', ' ', 'world'] })).not.toThrow();
    });

    it('accepts $concat with nested tokens', () => {
      expect(() => zSchemaProp.parse({ $concat: ['Hello ', { $store: 'user.name' }] })).not.toThrow();
    });

    it('rejects $concat with non-array value', () => {
      expect(() => zSchemaProp.parse({ $concat: 'hello' })).toThrow();
    });

    it('rejects $concat with extra keys', () => {
      expect(() => zSchemaProp.parse({ $concat: ['a'], extra: true })).toThrow();
    });
  });

  // --- $action ---
  describe('$action', () => {
    it('accepts valid $action token', () => {
      expect(() => zSchemaProp.parse({ $action: 'routeStore.navigate' })).not.toThrow();
    });

    it('accepts $action with args', () => {
      expect(() => zSchemaProp.parse({ $action: 'routeStore.navigate', args: ['/home'] })).not.toThrow();
    });

    it('rejects $action with empty string', () => {
      expect(() => zSchemaProp.parse({ $action: '' })).toThrow();
    });

    it('rejects $action with extra keys', () => {
      expect(() => zSchemaProp.parse({ $action: 'x', args: [], extra: 1 })).toThrow();
    });
  });

  // --- $if ---
  describe('$if', () => {
    it('accepts valid $if token with condition and then', () => {
      expect(() => zSchemaProp.parse({ $if: { condition: true, then: 'yes' } })).not.toThrow();
    });

    it('accepts $if with else', () => {
      expect(() => zSchemaProp.parse({ $if: { condition: true, then: 'yes', else: 'no' } })).not.toThrow();
    });

    it('rejects $if missing condition', () => {
      expect(() => zSchemaProp.parse({ $if: { then: 'yes' } })).toThrow();
    });

    it('rejects $if missing then', () => {
      expect(() => zSchemaProp.parse({ $if: { condition: true } })).toThrow();
    });

    it('rejects $if with wrong shape', () => {
      expect(() => zSchemaProp.parse({ $if: true })).toThrow();
    });

    it('rejects $if with extra keys on outer object', () => {
      expect(() => zSchemaProp.parse({ $if: { condition: true, then: 'y' }, extra: 1 })).toThrow();
    });
  });

  // --- $map ---
  describe('$map', () => {
    it('accepts valid $map token', () => {
      expect(() =>
        zSchemaProp.parse({
          $map: { items: { $store: 'list.items' }, select: { label: { $store: 'item.name' } } },
        }),
      ).not.toThrow();
    });

    it('rejects $map missing items', () => {
      expect(() => zSchemaProp.parse({ $map: { select: { a: 1 } } })).toThrow();
    });

    it('rejects $map missing select', () => {
      expect(() => zSchemaProp.parse({ $map: { items: [] } })).toThrow();
    });
  });

  // --- $pick ---
  describe('$pick', () => {
    it('accepts valid $pick token', () => {
      expect(() => zSchemaProp.parse({ $pick: { from: { $store: 'user' }, props: ['name', 'email'] } })).not.toThrow();
    });

    it('rejects $pick with non-array props', () => {
      expect(() => zSchemaProp.parse({ $pick: { from: {}, props: 'name' } })).toThrow();
    });

    it('rejects $pick missing from', () => {
      expect(() => zSchemaProp.parse({ $pick: { props: ['name'] } })).toThrow();
    });
  });

  // --- Comparison tokens ---
  describe('$eq', () => {
    it('accepts valid $eq tuple', () => {
      expect(() => zSchemaProp.parse({ $eq: [1, 2] })).not.toThrow();
    });

    it('rejects $eq with wrong arity', () => {
      expect(() => zSchemaProp.parse({ $eq: [1] })).toThrow();
      expect(() => zSchemaProp.parse({ $eq: [1, 2, 3] })).toThrow();
    });
  });

  describe('$ne', () => {
    it('accepts valid $ne tuple', () => {
      expect(() => zSchemaProp.parse({ $ne: ['a', 'b'] })).not.toThrow();
    });

    it('rejects $ne with wrong arity', () => {
      expect(() => zSchemaProp.parse({ $ne: [1] })).toThrow();
    });
  });

  describe('$not', () => {
    it('accepts valid $not token', () => {
      expect(() => zSchemaProp.parse({ $not: true })).not.toThrow();
      expect(() => zSchemaProp.parse({ $not: { $store: 'flags.hidden' } })).not.toThrow();
    });
  });

  describe('$and', () => {
    it('accepts valid $and token', () => {
      expect(() => zSchemaProp.parse({ $and: [true, false, true] })).not.toThrow();
    });

    it('rejects $and with non-array', () => {
      expect(() => zSchemaProp.parse({ $and: true })).toThrow();
    });
  });

  describe('$or', () => {
    it('accepts valid $or token', () => {
      expect(() => zSchemaProp.parse({ $or: [false, true] })).not.toThrow();
    });

    it('rejects $or with non-array', () => {
      expect(() => zSchemaProp.parse({ $or: 'yes' })).toThrow();
    });
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
        props: { items: { $store: 'list.items' } },
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
        props: { items: { $store: 'list.items' } },
      };
      expect(() => zSchemaNode.parse(node)).toThrow(/\$each requires at least one child/);
    });

    it('rejects $each with empty children array', () => {
      const node = {
        type: '$each',
        props: { items: { $store: 'list.items' } },
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
          condition: { $store: 'flags.visible' },
          then: { type: 'we-text' },
        },
      };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('accepts $if node with else', () => {
      const node = {
        type: '$if',
        props: {
          condition: { $store: 'flags.visible' },
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
    it('accepts valid $routes node', () => {
      const node = {
        type: '$routes',
        routes: [{ type: 'Page', path: '/home' }],
      };
      expect(() => zSchemaNode.parse(node)).not.toThrow();
    });

    it('rejects $routes without routes array', () => {
      const node = { type: '$routes' };
      expect(() => zSchemaNode.parse(node)).toThrow();
    });

    it('rejects $routes with empty routes array', () => {
      const node = { type: '$routes', routes: [] };
      expect(() => zSchemaNode.parse(node)).toThrow();
    });
  });

  // --- Non-operator nodes unaffected ---
  it('does not apply operator checks to regular nodes', () => {
    const node = { type: 'we-button', props: { label: 'Click' } };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });
});
