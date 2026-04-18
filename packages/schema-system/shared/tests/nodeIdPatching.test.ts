import { describe, expect, it } from 'vitest';

import { ensureNodeIds, findNodeById, insertChild, mergeNode, removeChild } from '../src/indexer';
import type { SchemaNode } from '../src/types';

// ── ensureNodeIds ──────────────────────────────────────────────────

describe('ensureNodeIds', () => {
  it('assigns IDs to all nodes in a tree with no existing IDs', () => {
    const schema: SchemaNode = {
      type: 'Column',
      children: [
        { type: 'we-text', props: { text: 'Hello' } },
        { type: 'we-button', props: { text: 'Click' } },
      ],
    };

    ensureNodeIds(schema);

    expect(schema.id).toBe('n1');
    expect((schema.children![0] as SchemaNode).id).toBe('n2');
    expect((schema.children![1] as SchemaNode).id).toBe('n3');
  });

  it('preserves existing IDs and fills gaps', () => {
    const schema: SchemaNode = {
      type: 'Column',
      id: 'n5',
      children: [
        { type: 'we-text', props: { text: 'Hello' } },
        { type: 'we-button', id: 'n10', props: { text: 'Click' } },
      ],
    };

    ensureNodeIds(schema);

    expect(schema.id).toBe('n5');
    expect((schema.children![0] as SchemaNode).id).toBe('n11'); // counter starts after max (10)
    expect((schema.children![1] as SchemaNode).id).toBe('n10');
  });

  it('deduplicates: second node with same ID gets reassigned', () => {
    const schema: SchemaNode = {
      type: 'Column',
      id: 'n1',
      children: [
        { type: 'we-text', id: 'n1' }, // duplicate!
        { type: 'we-button', id: 'n2' },
      ],
    };

    ensureNodeIds(schema);

    expect(schema.id).toBe('n1');
    // The duplicate gets reassigned
    expect((schema.children![0] as SchemaNode).id).not.toBe('n1');
    expect((schema.children![0] as SchemaNode).id).toMatch(/^n\d+$/);
    expect((schema.children![1] as SchemaNode).id).toBe('n2');
  });

  it('walks children, routes, and slots', () => {
    const schema: SchemaNode = {
      type: 'Column',
      children: [{ type: 'we-text' }],
      routes: [{ path: '/', type: 'Column', children: [{ type: 'we-text' }] }],
      slots: { header: { type: 'Row' } },
    };

    ensureNodeIds(schema);

    expect(schema.id).toBeTruthy();
    expect((schema.children![0] as SchemaNode).id).toBeTruthy();
    expect(schema.routes![0].id).toBeTruthy();
    expect((schema.routes![0].children![0] as SchemaNode).id).toBeTruthy();
    expect(schema.slots!.header.id).toBeTruthy();

    // All IDs should be unique
    const ids = [
      schema.id,
      (schema.children![0] as SchemaNode).id,
      schema.routes![0].id,
      (schema.routes![0].children![0] as SchemaNode).id,
      schema.slots!.header.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── findNodeById ───────────────────────────────────────────────────

describe('findNodeById', () => {
  const schema: SchemaNode = {
    type: 'Column',
    id: 'root',
    children: [
      { type: 'we-text', id: 'child1' },
      {
        type: 'Row',
        id: 'child2',
        children: [{ type: 'we-button', id: 'grandchild1' }],
      },
    ],
    routes: [{ path: '/', type: 'Column', id: 'route1' }],
    slots: { header: { type: 'Row', id: 'slot1' } },
  };

  it('finds a node in children', () => {
    const result = findNodeById(schema, 'child1');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('child1');
    expect(result!.parent!.id).toBe('root');
    expect(result!.key).toBe('children');
    expect(result!.index).toBe(0);
  });

  it('finds a node in deeply nested children', () => {
    const result = findNodeById(schema, 'grandchild1');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('grandchild1');
    expect(result!.parent!.id).toBe('child2');
    expect(result!.key).toBe('children');
    expect(result!.index).toBe(0);
  });

  it('finds a node in routes', () => {
    const result = findNodeById(schema, 'route1');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('route1');
    expect(result!.parent!.id).toBe('root');
    expect(result!.key).toBe('routes');
    expect(result!.index).toBe(0);
  });

  it('finds a node in slots', () => {
    const result = findNodeById(schema, 'slot1');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('slot1');
    expect(result!.parent!.id).toBe('root');
    expect(result!.key).toBe('slots.header');
    expect(result!.index).toBe(0);
  });

  it('returns null for unknown ID', () => {
    expect(findNodeById(schema, 'nonexistent')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(findNodeById(schema, '')).toBeNull();
  });

  it('finds the root node itself', () => {
    const result = findNodeById(schema, 'root');
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe('root');
    expect(result!.parent).toBeNull();
  });
});

// ── mergeNode ──────────────────────────────────────────────────────

describe('mergeNode', () => {
  it('preserves absent keys from existing', () => {
    const existing: SchemaNode = {
      id: 'n1',
      type: 'Column',
      props: { gap: 'md', color: 'primary' },
      children: [{ type: 'we-text' }],
    };

    const result = mergeNode(existing, { props: { gap: 'lg' } });

    expect(result.type).toBe('Column');
    expect(result.children).toHaveLength(1);
    expect(result.props!.gap).toBe('lg');
    expect(result.props!.color).toBe('primary');
  });

  it('overrides present keys', () => {
    const existing: SchemaNode = { id: 'n1', type: 'Column', props: { gap: 'md' } };
    const result = mergeNode(existing, { type: 'Row' });
    expect(result.type).toBe('Row');
  });

  it('deletes keys set to null', () => {
    const existing: SchemaNode = { id: 'n1', type: 'Column', props: { gap: 'md', color: 'primary' } };
    const result = mergeNode(existing, { props: { color: null } });
    expect(result.props!.gap).toBe('md');
    expect(result.props!.color).toBeUndefined();
    expect('color' in result.props!).toBe(false);
  });

  it('shallow-merges nested objects (props)', () => {
    const existing: SchemaNode = {
      id: 'n1',
      type: 'Column',
      props: { gap: 'md', color: 'primary', variant: 'outline' },
    };
    const result = mergeNode(existing, { props: { gap: 'lg' } });
    expect(result.props).toEqual({ gap: 'lg', color: 'primary', variant: 'outline' });
  });

  it('replaces arrays entirely (children)', () => {
    const existing: SchemaNode = {
      id: 'n1',
      type: 'Column',
      children: [{ type: 'we-text' }, { type: 'we-button' }],
    };
    const newChildren = [{ type: 'we-icon' }];
    const result = mergeNode(existing, { children: newChildren });
    expect(result.children).toHaveLength(1);
    expect((result.children![0] as SchemaNode).type).toBe('we-icon');
  });

  it('always preserves id from existing node', () => {
    const existing: SchemaNode = { id: 'n1', type: 'Column' };
    const result = mergeNode(existing, { id: 'n999', type: 'Row' });
    expect(result.id).toBe('n1');
    expect(result.type).toBe('Row');
  });

  it('deletes a top-level key when set to null', () => {
    const existing: SchemaNode = { id: 'n1', type: 'Column', props: { gap: 'md' }, theme: { primaryHue: 200 } };
    const result = mergeNode(existing, { theme: null });
    expect(result.theme).toBeUndefined();
    expect('theme' in result).toBe(false);
  });
});

// ── insertChild ────────────────────────────────────────────────────

describe('insertChild', () => {
  function makeSchema(): SchemaNode {
    return {
      type: 'Column',
      id: 'root',
      children: [
        { type: 'we-text', id: 'c1' },
        { type: 'we-button', id: 'c2' },
      ],
      routes: [{ path: '/', type: 'Column', id: 'r1' }],
    };
  }

  it('appends when no position given', () => {
    const schema = makeSchema();
    const err = insertChild(schema, 'root', 'children', { type: 'we-icon', id: 'new1' });
    expect(err).toBeUndefined();
    expect(schema.children).toHaveLength(3);
    expect((schema.children![2] as SchemaNode).id).toBe('new1');
  });

  it('inserts after a sibling', () => {
    const schema = makeSchema();
    const err = insertChild(schema, 'root', 'children', { type: 'we-icon', id: 'new1' }, { after: 'c1' });
    expect(err).toBeUndefined();
    expect(schema.children).toHaveLength(3);
    expect((schema.children![0] as SchemaNode).id).toBe('c1');
    expect((schema.children![1] as SchemaNode).id).toBe('new1');
    expect((schema.children![2] as SchemaNode).id).toBe('c2');
  });

  it('inserts before a sibling', () => {
    const schema = makeSchema();
    const err = insertChild(schema, 'root', 'children', { type: 'we-icon', id: 'new1' }, { before: 'c2' });
    expect(err).toBeUndefined();
    expect(schema.children).toHaveLength(3);
    expect((schema.children![0] as SchemaNode).id).toBe('c1');
    expect((schema.children![1] as SchemaNode).id).toBe('new1');
    expect((schema.children![2] as SchemaNode).id).toBe('c2');
  });

  it('returns error on unknown sibling ID', () => {
    const schema = makeSchema();
    const err = insertChild(schema, 'root', 'children', { type: 'we-icon' }, { after: 'nonexistent' });
    expect(err).toBeDefined();
    expect(err!.error).toContain('nonexistent');
  });

  it('returns error on unknown parent ID', () => {
    const schema = makeSchema();
    const err = insertChild(schema, 'nonexistent', 'children', { type: 'we-icon' });
    expect(err).toBeDefined();
    expect(err!.error).toContain('nonexistent');
  });

  it('works with "" (root) as parent', () => {
    const schema = makeSchema();
    const err = insertChild(schema, '', 'children', { type: 'we-icon', id: 'new1' });
    expect(err).toBeUndefined();
    expect(schema.children).toHaveLength(3);
  });

  it('inserts a route', () => {
    const schema = makeSchema();
    const err = insertChild(schema, 'root', 'routes', { type: 'Column', path: '/about', id: 'r2' } as SchemaNode);
    expect(err).toBeUndefined();
    expect(schema.routes).toHaveLength(2);
  });
});

// ── removeChild ────────────────────────────────────────────────────

describe('removeChild', () => {
  function makeSchema(): SchemaNode {
    return {
      type: 'Column',
      id: 'root',
      children: [
        { type: 'we-text', id: 'c1' },
        { type: 'we-button', id: 'c2' },
        { type: 'we-icon', id: 'c3' },
      ],
      routes: [
        { path: '/', type: 'Column', id: 'r1' },
        { path: '/about', type: 'Column', id: 'r2' },
      ],
    };
  }

  it('removes a child by ID', () => {
    const schema = makeSchema();
    const err = removeChild(schema, 'root', 'children', 'c2');
    expect(err).toBeUndefined();
    expect(schema.children).toHaveLength(2);
    expect((schema.children![0] as SchemaNode).id).toBe('c1');
    expect((schema.children![1] as SchemaNode).id).toBe('c3');
  });

  it('removes a route by ID', () => {
    const schema = makeSchema();
    const err = removeChild(schema, 'root', 'routes', 'r1');
    expect(err).toBeUndefined();
    expect(schema.routes).toHaveLength(1);
    expect(schema.routes![0].id).toBe('r2');
  });

  it('returns error on unknown child ID', () => {
    const schema = makeSchema();
    const err = removeChild(schema, 'root', 'children', 'nonexistent');
    expect(err).toBeDefined();
    expect(err!.error).toContain('nonexistent');
  });

  it('returns error on unknown parent ID', () => {
    const schema = makeSchema();
    const err = removeChild(schema, 'nonexistent', 'children', 'c1');
    expect(err).toBeDefined();
    expect(err!.error).toContain('nonexistent');
  });

  it('works with "" (root) as parent', () => {
    const schema = makeSchema();
    const err = removeChild(schema, '', 'children', 'c1');
    expect(err).toBeUndefined();
    expect(schema.children).toHaveLength(2);
  });
});
