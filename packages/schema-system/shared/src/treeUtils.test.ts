import { describe, expect, it } from 'vitest';

import { deepUnwrap, REACTIVE_ACCESSOR } from './propResolvers';
import { isPropsSchemaNode, isSchemaChild, replaceNodeInTree } from './treeUtils';
import type { SchemaNode } from './types';

function reactive<T>(value: T): () => T {
  const fn = () => value;
  (fn as unknown as Record<symbol, boolean>)[REACTIVE_ACCESSOR] = true;
  return fn;
}

describe('isSchemaChild', () => {
  it('accepts nodes with type or id, even alongside $-prefixed keys', () => {
    expect(isSchemaChild({ type: 'we-text' })).toBe(true);
    expect(isSchemaChild({ id: 'n1', $localState: {} })).toBe(true);
  });

  it('rejects strings, null, operator tokens, and arrays', () => {
    expect(isSchemaChild('hello')).toBe(false);
    expect(isSchemaChild(null)).toBe(false);
    expect(isSchemaChild({ $store: 'a.b' })).toBe(false);
    // The indexer's private copy accepted arrays (array keys don't start with $),
    // so index traversal and scope traversal disagreed about the tree. Pinned.
    expect(isSchemaChild([{ type: 'we-text' }])).toBe(false);
  });
});

describe('isPropsSchemaNode', () => {
  it('accepts component-shaped types only', () => {
    expect(isPropsSchemaNode({ type: 'Column' })).toBe(true);
    expect(isPropsSchemaNode({ type: 'we-button' })).toBe(true);
    expect(isPropsSchemaNode({ type: '$if' })).toBe(true);
  });

  it('rejects transition configs, arrays, and typeless objects', () => {
    expect(isPropsSchemaNode({ type: 'fade' })).toBe(false); // TransitionConfig
    expect(isPropsSchemaNode([{ type: 'Column' }])).toBe(false);
    expect(isPropsSchemaNode({ props: {} })).toBe(false);
  });
});

describe('replaceNodeInTree', () => {
  it('replaces by identity through children, routes, slots, and props', () => {
    const target: SchemaNode = { type: 'we-text', children: ['old'] };
    const replacement: SchemaNode = { type: 'we-text', children: ['new'] };
    const root: SchemaNode = {
      type: 'Column',
      children: [target, 'plain text'],
      routes: [{ path: '/', type: 'Row', children: [target] } as SchemaNode & { path: string }],
      slots: { side: target },
      props: { then: target, list: [target, { notANode: true }] },
    };

    const result = replaceNodeInTree(root, target, replacement);
    expect(result.children?.[0]).toBe(replacement);
    expect(result.children?.[1]).toBe('plain text');
    expect((result.routes?.[0] as SchemaNode).children?.[0]).toBe(replacement);
    expect(result.slots?.side).toBe(replacement);
    expect(result.props?.then).toBe(replacement);
    expect((result.props?.list as unknown[])[0]).toBe(replacement);
    expect((result.props?.list as unknown[])[1]).toEqual({ notANode: true });
  });

  it('returns a new tree and leaves the original intact', () => {
    const target: SchemaNode = { type: 'we-text' };
    const untouched: SchemaNode = { type: 'we-badge' };
    const root: SchemaNode = { type: 'Column', children: [untouched, target] };
    const result = replaceNodeInTree(root, target, { type: 'we-tag' });
    expect(result).not.toBe(root);
    expect(result.children?.[0]).toEqual(untouched);
    expect(result.children?.[1]).toEqual({ type: 'we-tag' });
    expect(root.children?.[1]).toBe(target);
  });
});

describe('deepUnwrap', () => {
  it('unwraps reactive accessors nested in plain objects and arrays', () => {
    const value = { a: reactive(1), list: [reactive('x'), 'y'], plain: 2 };
    expect(deepUnwrap(value)).toEqual({ a: 1, list: ['x', 'y'], plain: 2 });
  });

  it('passes plain functions (event handlers) through untouched', () => {
    const handler = () => 'clicked';
    expect(deepUnwrap({ onClick: handler })).toEqual({ onClick: handler });
  });

  it('does not deconstruct non-plain objects', () => {
    const date = new Date(0);
    const unwrapped = deepUnwrap({ when: date }) as { when: unknown };
    expect(unwrapped.when).toBe(date);
  });

  it('recurses into Object.create(null) objects', () => {
    // The two pre-unification copies disagreed here: the action-path copy passed
    // these through untouched, leaking accessors into store methods. Pinned.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.value = reactive(7);
    expect(deepUnwrap({ bare })).toEqual({ bare: { value: 7 } });
  });

  it('survives cyclic structures via the depth guard', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    // The action-path copy had no depth guard — this recursed forever.
    expect(() => deepUnwrap(cyclic)).not.toThrow();
  });
});
