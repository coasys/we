import { describe, expect, it } from 'vitest';

import { copyWithNewIds, ensureNodeIds } from '../src/indexer';
import { derivedNodeId, deriveNodeIds, isNodeId, newNodeId } from '../src/nodeIdentity';
import type { SchemaNode } from '../src/types';

const allIds = (node: SchemaNode, out: string[] = []): string[] => {
  if (node.id) out.push(node.id);
  for (const c of node.children ?? []) if (typeof c === 'object' && 'type' in c) allIds(c as SchemaNode, out);
  for (const r of node.routes ?? []) allIds(r as SchemaNode, out);
  for (const s of Object.values(node.slots ?? {})) allIds(s, out);
  for (const d of Object.values(node.$defs ?? {})) allIds(d, out);
  return out;
};

describe('the id format', () => {
  it('is ten characters, a letter then letters or digits', () => {
    for (let i = 0; i < 200; i++) expect(newNodeId()).toMatch(/^[a-z][a-z0-9]{9}$/);
  });

  it('tells a permanent id from an alias and from a template id', () => {
    expect(isNodeId(newNodeId())).toBe(true);
    expect(isNodeId('n12')).toBe(false);
    expect(isNodeId('workshop')).toBe(false);
    expect(isNodeId('Abcdefghij')).toBe(false);
    expect(isNodeId(undefined)).toBe(false);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 5000 }, newNodeId));
    expect(ids.size).toBe(5000);
  });

  it('derives the same id from the same source, and a different one from another', () => {
    expect(derivedNodeId('workshop|/c/Row0')).toBe(derivedNodeId('workshop|/c/Row0'));
    expect(derivedNodeId('workshop|/c/Row0')).not.toBe(derivedNodeId('workshop|/c/Row1'));
    expect(isNodeId(derivedNodeId('anything'))).toBe(true);
  });
});

describe('deriveNodeIds', () => {
  const build = (): SchemaNode => ({
    id: 'workshop',
    type: 'Column',
    children: [
      { type: 'we-text', children: ['Title'] },
      { type: 'Row', children: [{ type: 'we-button' }, { type: 'we-button' }] },
      { type: 'we-text', children: ['Footer'] },
    ],
    routes: [{ path: '/', type: 'Column', children: [{ type: 'we-text' }] }],
    slots: { header: { type: 'Row' } },
    $defs: { d1: { type: 'Card', children: [{ type: 'we-text' }] } },
  });

  it('gives every node an id and leaves the root alone', () => {
    const schema = deriveNodeIds(build(), 'workshop');
    const ids = allIds(schema);
    expect(schema.id).toBe('workshop');
    expect(ids.slice(1).every(isNodeId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives the same build the same ids', () => {
    expect(allIds(deriveNodeIds(build(), 'workshop'))).toEqual(allIds(deriveNodeIds(build(), 'workshop')));
  });

  it('gives two templates different ids for the same shape', () => {
    const a = allIds(deriveNodeIds(build(), 'workshop')).slice(1);
    const b = allIds(deriveNodeIds(build(), 'kanban')).slice(1);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('renumbers only nodes of the same kind when one is added in front', () => {
    const before = deriveNodeIds(build(), 'workshop');
    const after = build();
    after.children!.unshift({ type: 'we-image' });
    deriveNodeIds(after, 'workshop');
    // The Row is still the first Row, so its id and every id inside it hold.
    const rowBefore = before.children![1] as SchemaNode;
    const rowAfter = after.children![2] as SchemaNode;
    expect(allIds(rowAfter)).toEqual(allIds(rowBefore));
    // The texts are still the first and second we-text.
    expect((after.children![1] as SchemaNode).id).toBe((before.children![0] as SchemaNode).id);
  });

  it('follows a keyed node through a reorder', () => {
    const make = (names: string[]): SchemaNode => ({
      id: 'form',
      type: 'Column',
      children: names.map((name) => ({ type: 'we-form-field', key: name, children: [{ type: 'we-input' }] })),
    });
    const before = deriveNodeIds(make(['title', 'body']), 'form');
    const after = deriveNodeIds(make(['body', 'title']), 'form');
    expect(allIds(after.children![1] as SchemaNode)).toEqual(allIds(before.children![0] as SchemaNode));
  });

  it('keeps an id a node already has', () => {
    const schema = build();
    (schema.children![0] as SchemaNode).id = 'k3j9x0q2pd';
    deriveNodeIds(schema, 'workshop');
    expect((schema.children![0] as SchemaNode).id).toBe('k3j9x0q2pd');
  });
});

describe('copyWithNewIds', () => {
  it('keeps the shape and none of the ids', () => {
    const source = ensureNodeIds({ type: 'Card', children: [{ type: 'we-text', children: ['Hi'] }] });
    const copy = copyWithNewIds(source);
    expect(copy.type).toBe('Card');
    expect((copy.children![0] as SchemaNode).children).toEqual(['Hi']);
    const sourceIds = allIds(source);
    expect(allIds(copy).some((id) => sourceIds.includes(id))).toBe(false);
    expect(allIds(copy).every(isNodeId)).toBe(true);
  });
});
