/*
  Every walk over a template reaches every node.

  Each walk used to decide for itself what a node's children were, and they disagreed — panels,
  shared shapes and nodes held in props were each missed by one walk or another, and the failure was
  always silent: a node with no id, a component the uninstall check could not see, an edit that
  never landed. They now all take their positions from `forEachChild`. This builds one template that
  holds a node at every position there is, and checks each walk against it, so a walk that drops a
  position — or a position added without a walk learning it — fails here, by name.
*/
import { describe, expect, it } from 'vitest';

import { compactDefinitions, expandDefinitions, outlineOf } from '../src/definitions';
import {
  collectComponentTypes,
  copyWithNewIds,
  ensureNodeIds,
  findNodeById,
  forEachNode,
  stripNodeIds,
} from '../src/indexer';
import { deriveNodeIds } from '../src/nodeIdentity';
import { findNodeChain } from '../src/scope';
import {
  CHILD_POSITIONS,
  type ChildPositionKind,
  childrenOf,
  forEachChild,
  mapChildren,
  RENDERED_POSITIONS,
  replaceNodeInTree,
} from '../src/treeUtils';
import type { SchemaNode } from '../src/types';

/** A leaf whose type names the position it sits at, so a missing one is reported by where it was. */
const leaf = (type: string): SchemaNode => ({ type, children: [`text of ${type}`] });

/** A template holding a node at every child position, and things at each that are not nodes. */
function everyPosition(): SchemaNode {
  return {
    type: 'Column',
    meta: {
      name: 'Every position',
      panels: [
        { id: 'p1', title: 'Panel', node: { type: 'Column', children: [leaf('InPanel')] } },
        // A panel a module supplies carries no node, and is configuration only.
        { id: 'p2', module: 'transcribe' },
      ],
    },
    $defs: { d1: { type: 'Row', children: [leaf('InDef')] } },
    children: [
      'plain text',
      { $: 'an.expression' },
      leaf('InChildren'),
      {
        type: '$each',
        props: { items: { $: 'local.rows' }, as: 'row' },
        children: [{ type: 'Card', children: [leaf('InEachBody')] }],
      },
      {
        type: '$if',
        props: {
          condition: { $: 'local.open' },
          then: { type: 'Column', children: [leaf('InThen')] },
          else: leaf('InElse'),
          // A transition is a prop value with a `type`, and not a node.
          enterTransition: { type: 'fade', duration: 200 },
        },
      },
      {
        type: 'FlipCard',
        props: {
          front: leaf('InPropFront'),
          // A list of nodes in a prop, beside data that is not one.
          items: [leaf('InPropList'), { label: 'an option', value: 'a' }],
          hoverProps: { bg: 'surface' },
          onClick: { $invoke: 'x.y', args: [{ type: 'NotANodeInHandlerArgs' }] },
        },
      },
      { type: 'Tabs', slots: { header: { type: 'Row', children: [leaf('InSlot')] } } },
      { type: '$ref', props: { def: 'd1' } },
      { type: '$routes' },
    ],
    routes: [
      { path: '/', type: 'Column', children: [leaf('InRoute')] },
      {
        path: '/nested',
        type: 'Column',
        routes: [{ path: 'deeper', type: 'Column', children: [leaf('InNestedRoute')] }],
      },
    ],
  } as unknown as SchemaNode;
}

/** The nodes every walk must reach: each node, found by an independent, deliberately plain walk. */
const ALL_TYPES = [
  'Column',
  'InChildren',
  '$each',
  'Card',
  'InEachBody',
  '$if',
  'InThen',
  'InElse',
  'FlipCard',
  'InPropFront',
  'InPropList',
  'Tabs',
  'Row',
  'InSlot',
  '$ref',
  '$routes',
  'InRoute',
  'InNestedRoute',
  'InPanel',
  'InDef',
];
const NOT_NODES = ['fade', 'NotANodeInHandlerArgs'];
/** Reached only through `$defs`: a walk of the tree as rendered meets them at the `$ref` instead. */
const ONLY_IN_DEFS = ['InDef'];

const typesOf = (nodes: SchemaNode[]): string[] => nodes.map((n) => n.type ?? '');
const everyNode = (schema: SchemaNode): SchemaNode[] => {
  const out: SchemaNode[] = [];
  forEachNode(schema, (n) => out.push(n));
  return out;
};

const forEachNodeIn = (root: SchemaNode): Set<SchemaNode> => new Set(everyNode(root));

describe('the fixture holds a node at every position', () => {
  it('uses every kind in CHILD_POSITIONS, so a new position has to be added here too', () => {
    const seen = new Set<ChildPositionKind>();
    const visit = (n: SchemaNode) =>
      forEachChild(n, (child, at) => {
        seen.add(at.in);
        visit(child);
      });
    visit(everyPosition());
    expect([...seen].sort()).toEqual([...CHILD_POSITIONS].sort());
  });

  it('reaches every node and nothing that is not one', () => {
    const types = typesOf(everyNode(everyPosition()));
    for (const type of ALL_TYPES) expect(types, type).toContain(type);
    for (const type of NOT_NODES) expect(types, type).not.toContain(type);
    // The panel entry, the expression token and the option list never count.
    expect(types).not.toContain('');
  });
});

describe('every walk reaches every node', () => {
  it('ensureNodeIds numbers every node', () => {
    const schema = ensureNodeIds(everyPosition());
    const missing = everyNode(schema).filter((n) => !n.id);
    expect(typesOf(missing)).toEqual([]);
    // …and nothing that is not a node.
    const json = JSON.stringify(schema);
    expect(json).not.toMatch(/"type":"fade","duration":200,"id"/);
    expect(json).not.toMatch(/"label":"an option","value":"a","id"/);
  });

  it('deriveNodeIds numbers every node but the root', () => {
    const schema = deriveNodeIds(everyPosition(), 'seed');
    const missing = everyNode(schema).filter((n) => !n.id && n !== schema);
    expect(typesOf(missing)).toEqual([]);
  });

  it('findNodeById finds every node again', () => {
    const schema = ensureNodeIds(everyPosition());
    const lost = everyNode(schema).filter((n) => findNodeById(schema, n.id!)?.node !== n);
    expect(typesOf(lost)).toEqual([]);
  });

  it('findNodeById reports the position each was found at', () => {
    const schema = ensureNodeIds(everyPosition());
    const keyOf = (type: string) => {
      const node = everyNode(schema).find((n) => n.type === type)!;
      return findNodeById(schema, node.id!)?.key;
    };
    expect(keyOf('InChildren')).toBe('children');
    expect(keyOf('InPropFront')).toBe('props.front');
    expect(keyOf('InSlot')).toBe('children');
    expect(keyOf('Tabs')).toBe('children');
    expect(keyOf('InRoute')).toBe('children');
  });

  it('stripNodeIds and copyWithNewIds reach every node', () => {
    const schema = ensureNodeIds(everyPosition());
    const before = new Set(everyNode(schema).map((n) => n.id));
    const copy = copyWithNewIds(schema);
    const kept = everyNode(copy).filter((n) => before.has(n.id));
    expect(typesOf(kept)).toEqual([]);
    expect(everyNode(stripNodeIds(schema)).filter((n) => n.id)).toEqual([]);
  });

  it('collectComponentTypes names every component, wherever it is mounted', () => {
    const found = collectComponentTypes(everyPosition());
    const expected = ALL_TYPES.filter((t) => !t.startsWith('$'));
    expect(expected.filter((t) => !found.has(t))).toEqual([]);
  });

  it('replaceNodeInTree replaces a node at every position', () => {
    const schema = everyPosition();
    const failed: string[] = [];
    for (const target of everyNode(schema)) {
      if (target === schema) continue;
      const replaced = replaceNodeInTree(schema, target, { type: 'Replacement' });
      if (!everyNode(replaced).some((n) => n.type === 'Replacement')) failed.push(target.type ?? '');
    }
    expect(failed).toEqual([]);
    // The original is left as it was.
    expect(typesOf(everyNode(schema))).not.toContain('Replacement');
  });

  it('mapChildren rebuilds every position and leaves what is not a child alone', () => {
    const schema = everyPosition();
    const marked = mapChildren(schema, (child) => ({ ...child, key: 'mapped' }));
    const direct = childrenOf(marked);
    expect(direct.length).toBe(childrenOf(schema).length);
    expect(direct.every((c) => c.key === 'mapped')).toBe(true);
    const children = marked.children!;
    expect(children[0]).toBe('plain text');
    expect(children[1]).toEqual({ $: 'an.expression' });
    const panels = (marked as unknown as { meta: { panels: Record<string, unknown>[] } }).meta.panels;
    expect(panels[0]).toMatchObject({ id: 'p1', title: 'Panel' });
    expect(panels[1]).toEqual({ id: 'p2', module: 'transcribe' });
  });

  it('findNodeChain reaches every node as rendered — not inside $defs, which has no one chain', () => {
    const schema = ensureNodeIds(everyPosition());
    const inDefs = new Set<SchemaNode>();
    forEachNode(schema.$defs!.d1, (n) => inDefs.add(n));
    const unreached = everyNode(schema).filter((n) => !inDefs.has(n) && !findNodeChain(schema, n.id!));
    expect(typesOf(unreached)).toEqual([]);
    expect([...inDefs].filter((n) => findNodeChain(schema, n.id!))).toEqual([]);
  });

  it('outlineOf lists every node as rendered', () => {
    const schema = ensureNodeIds(everyPosition());
    const listed = outlineOf(schema, 1000).entries.map((e) => e.type);
    const expected = ALL_TYPES.filter((t) => !ONLY_IN_DEFS.includes(t));
    expect(expected.filter((t) => !listed.includes(t))).toEqual([]);
  });

  it('compaction round-trips every position', () => {
    // Each subtree twice over, so every one is worth sharing — and the template's own `d1` kept.
    const twice = (): SchemaNode => {
      const one = everyPosition();
      return { ...one, children: [...one.children!, ...structuredClone(one.children!)] };
    };
    const schema = ensureNodeIds(twice());
    const { schema: compacted, hoisted, uses } = compactDefinitions(schema, { minChars: 20 });
    expect(hoisted).toBeGreaterThan(0);
    const back = expandDefinitions(compacted, { uses });
    // The template's own `d1` comes back expanded, like every other shape, and nothing is lost.
    const expected = stripNodeIds(structuredClone(expandDefinitions(schema)));
    expect(stripNodeIds(structuredClone(back))).toEqual(expected);
    // Every node keeps its id, but a `$ref` (which expands away) and the nodes of a shape the
    // template already shared (which take the use's).
    const ids = new Set(everyNode(back).map((n) => n.id));
    const lost = everyNode(schema).filter(
      (n) => n.id && n.type !== '$ref' && !ids.has(n.id) && !forEachNodeIn(schema.$defs!.d1).has(n),
    );
    expect(typesOf(lost)).toEqual([]);
  });

  it('RENDERED_POSITIONS is every position but $defs', () => {
    expect([...RENDERED_POSITIONS]).toEqual(CHILD_POSITIONS.filter((k) => k !== '$defs'));
  });
});
