import { describe, expect, it } from 'vitest';

import { findMutations } from '../src/mutations';
import type { SchemaNode } from '../src/types';

describe('mutations.findMutations (combined)', () => {
  it('detects primitive change', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['x'], value: 2 }]);
  });

  it('detects nested object changes', () => {
    const a = { user: { name: 'A', age: 10 } };
    const b = { user: { name: 'B', age: 10 } };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['user', 'name'], value: 'B' }]);
  });

  it('detects array additions', () => {
    const a = { list: [1, 2] };
    const b = { list: [1, 2, 3] };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['list', 2], value: 3 }]);
  });

  it('detects array removal (emits length mutation)', () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [1, 2] };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['list', 'length'], value: 2 }]);
  });

  it('detects nested array element change', () => {
    const a = { list: [[1], [2]] };
    const b = { list: [[1], [3]] };
    const muts = findMutations(a, b);
    expect(muts).toEqual([{ path: ['list', 1, 0], value: 3 }]);
  });

  it('detects object deletion and addition', () => {
    const a = { a: 1, b: 2 };
    const b = { a: 1, c: 3 };
    // @ts-expect-error test
    const muts = findMutations(a, b);
    expect(muts).toEqual(
      expect.arrayContaining([
        { path: ['b'], value: undefined },
        { path: ['c'], value: 3 },
      ]),
    );
  });

  it('replaces mismatched array/object', () => {
    const a = { v: [1, 2] };
    const b = { v: { a: 1 } };
    const muts = findMutations(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
    expect(muts).toEqual([{ path: ['v'], value: { a: 1 } }]);
  });

  it('handles array/object mismatch and primitive replace', () => {
    const a1 = [1];
    const b1 = { a: 1 };
    const muts1 = findMutations(a1 as unknown as Record<string, unknown>, b1 as unknown as Record<string, unknown>);
    expect(muts1).toEqual([{ path: [], value: b1 }]);

    const a2 = 1;
    const b2 = 2;
    const muts2 = findMutations(a2 as unknown as Record<string, unknown>, b2 as unknown as Record<string, unknown>);
    expect(muts2).toEqual([{ path: [], value: 2 }]);
  });

  it('detects function replacement inside arrays', () => {
    const a = { arr: [() => 1] };
    const b = { arr: [() => 2] };
    const muts = findMutations(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
    expect(muts.length).toBe(1);
    expect(muts[0].path).toEqual(['arr', 0]);
    expect(typeof muts[0].value).toBe('function');
  });

  it('replaces entire node when type changes (schema node swap)', () => {
    const oldNode: SchemaNode = {
      type: 'Column',
      id: 'n1',
      children: [
        { type: 'Text', id: 'n2', props: { variant: 'heading-lg', content: 'Hello' } },
        { type: 'we-button', id: 'n3', props: { text: 'Click' } },
      ],
    };
    const newNode: SchemaNode = {
      type: 'Column',
      id: 'n1',
      children: [
        { type: 'Row', id: 'n2', props: { gap: '400', ay: 'center' }, children: [] },
        { type: 'we-button', id: 'n3', props: { text: 'Click' } },
      ],
    };
    const muts = findMutations(oldNode, newNode);
    // The child at index 0 should be a single whole-node replacement (type changed)
    const childMut = muts.find((m) => m.path[0] === 'children' && m.path[1] === 0);
    expect(childMut).toBeDefined();
    expect(childMut!.path).toEqual(['children', 0]);
    expect(childMut!.value).toEqual(newNode.children![0]);
    // No individual property mutations for children[0]
    const deepChildMuts = muts.filter((m) => m.path[0] === 'children' && m.path[1] === 0 && m.path.length > 2);
    expect(deepChildMuts).toHaveLength(0);
  });
});

/*
  A renderer sets a node's scope up once, when it mounts, so the diff decides which component draws
  which node. These pin that a different node is never written into the component of another, and
  that a node which only moved keeps its own. The rendered consequences are in schema-solid's
  liveUpdate tests.
*/
describe('mutations.findMutations — which component draws which node', () => {
  const node = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'Box', id, ...extra });

  it('matches a list of nodes by id, keeping the objects of the ones that moved', () => {
    const a = { children: [node('b'), node('c')] };
    const b = { children: [node('a'), node('b'), node('c')] };
    const muts = findMutations(a, b);

    expect(muts).toHaveLength(1);
    expect(muts[0].path).toEqual(['children']);
    const list = muts[0].value as unknown[];
    expect(list[0]).toEqual(node('a'));
    expect(list[1]).toBe(a.children[0]);
    expect(list[2]).toBe(a.children[1]);
  });

  it('diffs a node that moved against its new version, at its new position', () => {
    const a = { children: [node('b', { props: { gap: '100' } })] };
    const b = { children: [node('a'), node('b', { props: { gap: '300' } })] };
    const muts = findMutations(a, b);

    expect(muts.slice(1)).toEqual([{ path: ['children', 1, 'props', 'gap'], value: '300' }]);
  });

  it('keeps diffing by index when the ids are in the same order', () => {
    const a = { children: [node('a', { props: { gap: '100' } }), node('b')] };
    const b = { children: [node('a', { props: { gap: '300' } }), node('b')] };

    expect(findMutations(a, b)).toEqual([{ path: ['children', 0, 'props', 'gap'], value: '300' }]);
  });

  it('replaces, rather than rewrites, a different node at the same position', () => {
    const a = { props: { then: node('old', { props: { gap: '100' } }) } };
    const b = { props: { then: node('new', { props: { gap: '100' } }) } };

    expect(findMutations(a, b)).toEqual([{ path: ['props', 'then'], value: b.props.then }]);
  });

  it.each([
    [
      '$localState',
      { $localState: { open: { type: 'boolean', initial: false } } },
      { $localState: { open: { type: 'boolean', initial: true } } },
    ],
    [
      '$queries',
      { $queries: { rows: { entity: 'Post', limit: 10 } } },
      { $queries: { rows: { entity: 'Post', limit: 20 } } },
    ],
  ])('replaces a node whose %s changed, since it is set up at mount', (_, before, after) => {
    const a = { children: [node('a', before)] };
    const b = { children: [node('a', after)] };

    expect(findMutations(a, b)).toEqual([{ path: ['children', 0], value: b.children[0] }]);
  });

  it('replaces an $each whose query changed, and diffs one whose items are an expression', () => {
    const each = (items: unknown) => ({ type: '$each', id: 'e', props: { items, as: 'row' } });

    const queried = findMutations(
      { x: each({ $query: { entity: 'Post' } }) },
      { x: each({ $query: { entity: 'Task' } }) },
    );
    expect(queried).toEqual([{ path: ['x'], value: each({ $query: { entity: 'Task' } }) }]);

    const expressed = findMutations({ x: each({ $: 'local.a' }) }, { x: each({ $: 'local.b' }) });
    expect(expressed).toEqual([{ path: ['x', 'props', 'items', '$'], value: 'local.b' }]);
  });
});
