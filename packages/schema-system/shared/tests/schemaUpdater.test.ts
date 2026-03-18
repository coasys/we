import { describe, expect, it, vi } from 'vitest';

import { updateSchema } from '../../solid/src/schemaUpdater';

const meta = { name: 'T', description: 'd', icon: 'i' };

describe('schemaUpdater.updateSchema', () => {
  it('applies small mutation via setSchema calls', () => {
    const oldNode = { meta, children: [{ type: 'c', props: { x: 1 } }] };
    const newNode = { meta, children: [{ type: 'c', props: { x: 2 } }] };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).toHaveBeenCalled();
    const lastCall = setSchema.mock.calls[setSchema.mock.calls.length - 1];
    expect(lastCall[lastCall.length - 1]).toBe(2);
  });

  it('does not call setSchema when schema is invalid', () => {
    const oldNode = { meta };
    const newNode = { invalid: true };

    const setSchema = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('uses produce branch for >10 mutations', () => {
    const oldNode = { meta, children: [] };
    const newChildren = Array.from({ length: 11 }, (_, i) => ({ type: 'c', props: { x: i } }));
    const newNode = { meta, children: newChildren };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).toHaveBeenCalled();
    const producedArg = setSchema.mock.calls[0][0];
    expect(typeof producedArg).toBe('function');

    const result = producedArg(oldNode);
    expect(result.children.length).toBe(11);
    expect(result.children[10].props.x).toBe(10);
  });

  it('does nothing when old and new are identical (no mutations)', () => {
    const node = { meta, type: 'Row', props: { gap: 100 } };
    const setSchema = vi.fn();
    updateSchema(node, { ...node }, setSchema);
    expect(setSchema).not.toHaveBeenCalled();
  });

  it('applies nested path mutation (children[0].props.text)', () => {
    const oldNode = { meta, children: [{ type: 'we-text', props: { text: 'old' } }] };
    const newNode = { meta, children: [{ type: 'we-text', props: { text: 'new' } }] };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).toHaveBeenCalled();
    const lastCall = setSchema.mock.calls[setSchema.mock.calls.length - 1];
    expect(lastCall[lastCall.length - 1]).toBe('new');
  });

  it('handles adding new children', () => {
    const oldNode = { meta, children: [{ type: 'a' }] };
    const newNode = { meta, children: [{ type: 'a' }, { type: 'b' }] };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);
    expect(setSchema).toHaveBeenCalled();
  });

  it('cleans null/undefined children before applying mutations', () => {
    const oldNode = { meta, children: [{ type: 'a' }] };
    const newNode = { meta, children: [null, { type: 'b' }, undefined] };

    const setSchema = vi.fn();
    updateSchema(oldNode as any, newNode as any, setSchema);

    // Should still work — nulls should be filtered out by cleanSchemaNode
    expect(setSchema).toHaveBeenCalled();
  });

  it('handles schema with routes changing', () => {
    const oldNode = { meta, routes: [{ type: 'Home', path: '/home' }] };
    const newNode = { meta, routes: [{ type: 'Home', path: '/dashboard' }] };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);
    expect(setSchema).toHaveBeenCalled();
  });

  it('handles schema with slots changing', () => {
    const oldNode = { meta, slots: { header: { type: 'we-text', props: { text: 'old' } } } };
    const newNode = { meta, slots: { header: { type: 'we-text', props: { text: 'new' } } } };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);
    expect(setSchema).toHaveBeenCalled();
  });

  it('uses batch branch for exactly 10 mutations', () => {
    const oldNode = { meta, children: [] };
    const newChildren = Array.from({ length: 10 }, (_, i) => ({ type: 'c', props: { x: i } }));
    const newNode = { meta, children: newChildren };

    const setSchema = vi.fn();
    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).toHaveBeenCalled();
    // batch branch calls setSchema multiple times (not a single produce function)
    // At least one call should have the final path arg be a value, not a function
    const firstArg = setSchema.mock.calls[0][0];
    // batch branch passes path segments, not a function
    expect(typeof firstArg).not.toBe('function');
  });
});
