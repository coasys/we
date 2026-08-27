import { describe, expect, it } from 'vitest';

import type { ModelEntry, StoreEntry } from './contextTypes';
import { findNodeChain, findScopeRef, getScopeAtNode, inferRefKind, scopeRefToToken } from './scope';
import type { SchemaNode } from './types';

const storeEntries: StoreEntry[] = [
  {
    name: 'sessionStore',
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
    expect(item?.refs.map((r) => r.path)).toContain('space.name');
    expect(item?.refs.map((r) => r.path)).toContain('space.location');
  });

  it('infers $each item fields from a store array source', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $: 'sessionStore.personalSpaces' } },
      children: [{ id: 'card', type: 'Column' }],
    };
    const item = getScopeAtNode(tree, 'card', { storeEntries, models }).find((g) => g.kind === 'item');
    expect(item?.refs.map((r) => r.path)).toEqual(['item', 'item.uuid', 'item.name']);
  });

  it('passes the item shape through a filter and reads a map projection', () => {
    const filtered: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $: "sessionStore.personalSpaces.filter(s, s.name != '')" } },
      children: [{ id: 'card', type: 'Column' }],
    };
    const item = getScopeAtNode(filtered, 'card', { storeEntries, models }).find((g) => g.kind === 'item');
    expect(item?.refs.map((r) => r.path)).toEqual(['item', 'item.uuid', 'item.name']);

    const mapped: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $: 'sessionStore.personalSpaces.map(s, { label: s.name, value: s.uuid })' } },
      children: [{ id: 'card', type: 'Column' }],
    };
    const projected = getScopeAtNode(mapped, 'card', { storeEntries, models }).find((g) => g.kind === 'item');
    expect(projected?.refs.map((r) => r.path)).toEqual(['item', 'item.label', 'item.value']);
  });

  it('infers $each item fields from a literal array', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: [{ title: 'a', author: 'b' }], as: 'post' },
      children: [{ id: 'card', type: 'Column' }],
    };
    const item = getScopeAtNode(tree, 'card', { storeEntries }).find((g) => g.kind === 'item');
    expect(item?.refs.map((r) => r.path)).toEqual(['post', 'post.title', 'post.author']);
  });

  it('shadows an outer $each that reuses the same `as` name', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: { $: 'sessionStore.personalSpaces' } },
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
    expect(itemGroups[0].refs.map((r) => r.path)).toEqual(['item', 'item.label']);
  });

  it('lists one group per store, plus context, ordered nearest-scope-first', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: '$each',
      props: { items: [{ a: 1 }] },
      $localState: { open: { type: 'boolean', initial: false } },
      children: [{ id: 'leaf', type: 'we-text' }],
    };
    expect(groupLabels(tree, 'leaf')).toEqual(['item — literal list', 'Page state', 'sessionStore', 'Context']);
  });

  it('drills into object-typed store members but not array members', () => {
    const tree: SchemaNode = { id: 'root', type: 'Column' };
    const store = getScopeAtNode(tree, 'root', { storeEntries }).find((g) => g.label === 'sessionStore');
    const paths = store?.refs.map((r) => r.path);
    expect(paths).toContain('sessionStore.me.did');
    expect(paths).not.toContain('sessionStore.personalSpaces.uuid');
  });

  it('returns stores and context even when the node id is unknown', () => {
    expect(groupLabels({ id: 'root', type: 'Column' }, 'missing')).toEqual(['sessionStore', 'Context']);
  });
});

describe('store members that hold model instances', () => {
  const entries: StoreEntry[] = [
    { name: 'spaceStore', state: { currentSpace: { type: 'object', model: 'Space' } }, actions: [] },
  ];

  it('takes properties from the model registry rather than a hand-written list', () => {
    const groups = getScopeAtNode({ id: 'n', type: 'Column' }, 'n', { storeEntries: entries, models });
    const paths = groups.find((g) => g.label === 'spaceStore')?.refs.map((r) => r.path);
    // `description` is a declared Space field; a hand-maintained list had omitted fields
    // like this, so the picker could not offer them at all.
    expect(paths).toContain('spaceStore.currentSpace.description');
    expect(paths).toContain('spaceStore.currentSpace.location');
  });

  it('includes the base fields every model instance carries', () => {
    const groups = getScopeAtNode({ id: 'n', type: 'Column' }, 'n', { storeEntries: entries, models });
    const paths = groups.find((g) => g.label === 'spaceStore')?.refs.map((r) => r.path);
    for (const base of ['id', 'author', 'createdAt', 'updatedAt']) {
      expect(paths).toContain(`spaceStore.currentSpace.${base}`);
    }
  });

  it('unions model fields with explicitly declared ones', () => {
    const withComputed: StoreEntry[] = [
      {
        name: 'spaceStore',
        state: { currentSpace: { type: 'object', model: 'Space', properties: ['$memberCount'] } },
        actions: [],
      },
    ];
    const groups = getScopeAtNode({ id: 'n', type: 'Column' }, 'n', { storeEntries: withComputed, models });
    const paths = groups.find((g) => g.label === 'spaceStore')?.refs.map((r) => r.path);
    expect(paths).toContain('spaceStore.currentSpace.name');
    expect(paths).toContain('spaceStore.currentSpace.$memberCount');
  });

  it('falls back to declared properties when the model is unknown', () => {
    const unknown: StoreEntry[] = [
      { name: 'spaceStore', state: { thing: { type: 'object', model: 'Nope', properties: ['a'] } }, actions: [] },
    ];
    const groups = getScopeAtNode({ id: 'n', type: 'Column' }, 'n', { storeEntries: unknown, models });
    const paths = groups.find((g) => g.label === 'spaceStore')?.refs.map((r) => r.path);
    expect(paths).toContain('spaceStore.thing.a');
  });
});

describe('inferRefKind', () => {
  const tree: SchemaNode = {
    id: 'root',
    type: '$each',
    props: { items: [{ title: 'a' }], as: 'post' },
    $localState: { draft: { type: 'string', initial: '' } },
    children: [{ id: 'leaf', type: 'we-text' }],
  };
  const groups = getScopeAtNode(tree, 'leaf', { storeEntries });

  it('resolves paths the listed scope does not contain', () => {
    // The whole point: a store member whose metadata is incomplete is still reachable.
    expect(inferRefKind('sessionStore.somethingUndocumented.deep', groups)).toBe('store');
    expect(inferRefKind('draft.nested', groups)).toBe('local');
    expect(inferRefKind('local.draft', groups)).toBe('local');
    expect(inferRefKind('post.title', groups)).toBe('item');
    expect(inferRefKind('me.did', groups)).toBe('context');
  });

  it('refuses paths whose first segment matches nothing known', () => {
    expect(inferRefKind('mysteryStore.value', groups)).toBeNull();
    expect(inferRefKind('notAField', groups)).toBeNull();
    expect(inferRefKind('   ', groups)).toBeNull();
  });
});

describe('token conversion', () => {
  it('builds the expression per ref kind', () => {
    expect(scopeRefToToken({ kind: 'store', path: 'a.b' })).toEqual({ $: 'a.b' });
    expect(scopeRefToToken({ kind: 'local', path: 'draft' })).toEqual({ $: 'local.draft' });
    expect(scopeRefToToken({ kind: 'item', path: 'post.name' })).toEqual({ $: 'post.name' });
    expect(scopeRefToToken({ kind: 'context', path: 'me.did' })).toEqual({ $: 'me.did' });
  });

  it('matches a token back to its scope ref', () => {
    const tree: SchemaNode = {
      id: 'root',
      type: 'Column',
      $localState: { open: { type: 'boolean', initial: false } },
    };
    const groups = getScopeAtNode(tree, 'root', { storeEntries });
    expect(findScopeRef(groups, { $: 'local.open' })?.id).toBe('local:open');
    expect(findScopeRef(groups, { $: 'sessionStore.isWeSpace' })?.id).toBe('store:sessionStore.isWeSpace');
    expect(findScopeRef(groups, { $: 'me.did' })?.id).toBe('context:me.did');
  });

  it('returns null for tokens that are not plain references', () => {
    const groups = getScopeAtNode({ id: 'root', type: 'Column' }, 'root', { storeEntries });
    expect(findScopeRef(groups, { $: '`${a}`' })).toBeNull();
    expect(findScopeRef(groups, 'plain text')).toBeNull();
    expect(findScopeRef(groups, { $: 'unknownStore.x' })).toBeNull();
  });
});
