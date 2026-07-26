import { describe, expect, it } from 'vitest';

import type { ModelEntry, StoreEntry } from './contextTypes';
import { findNodeChain, findScopeRef, getScopeAtNode, scopeRefToToken } from './scope';
import type { SchemaNode } from './types';

const storeEntries: StoreEntry[] = [
  {
    name: 'adamStore',
    state: {
      isWeSpace: { type: 'boolean' },
      me: { type: 'object', properties: ['did', 'handle'] },
      personalSpaces: { type: 'array', properties: ['uuid', 'name'] },
    },
    actions: ['navigate'],
  },
];

const models: ModelEntry[] = [
  {
    name: 'Space',
    className: 'Space',
    fields: [
      { name: 'name', type: 'string', predicate: 'we://name', required: true },
      { name: 'description', type: 'string', predicate: 'we://description', required: false },
    ],
    relations: [{ name: 'location', kind: 'HasOne', predicate: 'we://location' }],
  },
];

function groupLabels(node: SchemaNode, id: string) {
  return getScopeAtNode(node, id, { storeEntries, models }).map((g) => g.label);
}

describe('findNodeChain', () => {
  const tree: SchemaNode = {
    id: 'root',
    type: 'Column',
    children: [
      {
        id: 'if',
        type: '$if',
        props: {
          condition: { $local: 'open' },
          then: { id: 'target', type: 'we-text' },
        },
      },
    ],
  };

  it('walks into SchemaNodes embedded in props', () => {
    expect(findNodeChain(tree, 'target')?.map((n) => n.id)).toEqual(['root', 'if', 'target']);
  });

  it('returns null for an unknown id', () => {
    expect(findNodeChain(tree, 'nope')).toBeNull();
  });
});

describe('getScopeAtNode', () => {
  it('exposes $localState declared on an ancestor', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: 'Column',
      $localState: { showComments: { type: 'boolean', initial: false } },
      children: [{ id: 'child', type: 'we-text' }],
    };
    const local = getScopeAtNode(tree, 'child', { storeEntries }).find((g) => g.kind === 'local');
    expect(local?.refs).toEqual([
      { id: 'local:showComments', kind: 'local', path: 'showComments', label: 'showComments', valueType: 'boolean' },
    ]);
  });

  it("exposes a node's own $localState — the renderer resolves its props against it", () => {
    const tree: SchemaNode = {
      id: 'root',
      type: 'Column',
      $localState: { draft: { type: 'string', initial: '' } },
    };
    const local = getScopeAtNode(tree, 'root', { storeEntries }).find((g) => g.kind === 'local');
    expect(local?.refs.map((r) => r.path)).toEqual(['draft']);
  });

  it('does not leak $localState from a sibling branch', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: 'Column',
      children: [
        { id: 'a', type: 'Column', $localState: { hidden: { type: 'boolean', initial: false } } },
        { id: 'b', type: 'we-text' },
      ],
    };
    expect(getScopeAtNode(tree, 'b', { storeEntries }).some((g) => g.kind === 'local')).toBe(false);
  });

  it('exposes $queries results with the entity’s fields', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: 'Column',
      $queries: { spaces: { entity: 'Space' } },
      children: [{ id: 'child', type: 'we-text' }],
    };
    const local = getScopeAtNode(tree, 'child', { storeEntries, models }).find((g) => g.kind === 'local');
    expect(local?.refs[0]).toMatchObject({ path: 'spaces', valueType: 'array' });
    expect(local?.refs[0].properties).toContain('name');
  });

  it('infers $each item fields from a $query source', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $query: { entity: 'Space' } }, as: 'space' },
      children: [{ id: 'card', type: 'Column' }],
    };
    const item = getScopeAtNode(tree, 'card', { storeEntries, models }).find((g) => g.kind === 'item');
    expect(item?.refs.map((r) => r.path)).toContain('$space.name');
    expect(item?.refs.map((r) => r.path)).toContain('$space.location');
  });

  it('infers $each item fields from a store array source', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $store: 'adamStore.personalSpaces' } },
      children: [{ id: 'card', type: 'Column' }],
    };
    const item = getScopeAtNode(tree, 'card', { storeEntries, models }).find((g) => g.kind === 'item');
    expect(item?.refs.map((r) => r.path)).toEqual(['$item', '$item.uuid', '$item.name']);
  });

  it('infers $each item fields from a literal array', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: [{ title: 'a', author: 'b' }], as: 'post' },
      children: [{ id: 'card', type: 'Column' }],
    };
    const item = getScopeAtNode(tree, 'card', { storeEntries }).find((g) => g.kind === 'item');
    expect(item?.refs.map((r) => r.path)).toEqual(['$post', '$post.title', '$post.author']);
  });

  it('shadows an outer $each that reuses the same `as` name', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $store: 'adamStore.personalSpaces' } },
      children: [
        {
          id: 'inner',
          type: '$each',
          props: { items: [{ label: 'x' }] },
          children: [{ id: 'leaf', type: 'we-text' }],
        },
      ],
    };
    const itemGroups = getScopeAtNode(tree, 'leaf', { storeEntries }).filter((g) => g.kind === 'item');
    expect(itemGroups).toHaveLength(1);
    expect(itemGroups[0].refs.map((r) => r.path)).toEqual(['$item', '$item.label']);
  });

  it('lists one group per store, plus context, ordered nearest-scope-first', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: [{ a: 1 }] },
      $localState: { open: { type: 'boolean', initial: false } },
      children: [{ id: 'leaf', type: 'we-text' }],
    };
    expect(groupLabels(tree, 'leaf')).toEqual(['item — literal list', 'Page state', 'adamStore', 'Context']);
  });

  it('drills into object-typed store members but not array members', () => {
    const tree: SchemaNode = { id: 'root', type: 'Column' };
    const store = getScopeAtNode(tree, 'root', { storeEntries }).find((g) => g.label === 'adamStore');
    const paths = store?.refs.map((r) => r.path);
    expect(paths).toContain('adamStore.me.did');
    expect(paths).not.toContain('adamStore.personalSpaces.uuid');
  });

  it('returns stores and context even when the node id is unknown', () => {
    expect(groupLabels({ id: 'root', type: 'Column' }, 'missing')).toEqual(['adamStore', 'Context']);
  });
});

describe('token conversion', () => {
  it('builds the right token per ref kind', () => {
    expect(scopeRefToToken({ kind: 'store', path: 'a.b' })).toEqual({ $store: 'a.b' });
    expect(scopeRefToToken({ kind: 'local', path: 'draft' })).toEqual({ $local: 'draft' });
    expect(scopeRefToToken({ kind: 'item', path: '$post.name' })).toBe('$post.name');
    expect(scopeRefToToken({ kind: 'context', path: '$me.did' })).toBe('$me.did');
  });

  it('matches a token back to its scope ref', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: 'Column',
      $localState: { open: { type: 'boolean', initial: false } },
    };
    const groups = getScopeAtNode(tree, 'root', { storeEntries });
    expect(findScopeRef(groups, { $local: 'open' })?.id).toBe('local:open');
    expect(findScopeRef(groups, { $store: 'adamStore.isWeSpace' })?.id).toBe('store:adamStore.isWeSpace');
    expect(findScopeRef(groups, '$me.did')?.id).toBe('context:$me.did');
  });

  it('returns null for tokens that are not plain references', () => {
    const groups = getScopeAtNode({ id: 'root', type: 'Column' }, 'root', { storeEntries });
    expect(findScopeRef(groups, { $concat: ['a'] })).toBeNull();
    expect(findScopeRef(groups, 'plain text')).toBeNull();
    expect(findScopeRef(groups, { $store: 'unknownStore.x' })).toBeNull();
  });
});
