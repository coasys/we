import { describe, expect, it, vi } from 'vitest';

import { updateSchema } from '../src/frameworks/solid/schemaUpdater';

describe('schemaUpdater.updateSchema (combined)', () => {
  it('applies small mutation via setSchema calls', () => {
    const oldNode = {
      meta: { name: 'T', description: 'd', icon: 'i' },
      children: [{ type: 'c', props: { x: 1 } }],
    };
    const newNode = {
      meta: { name: 'T', description: 'd', icon: 'i' },
      children: [{ type: 'c', props: { x: 2 } }],
    };

    const setSchema = vi.fn();

    updateSchema(oldNode, newNode, setSchema);

    // Expect setSchema to be called with path args ending in the new value
    expect(setSchema).toHaveBeenCalled();
    const lastCall = setSchema.mock.calls[setSchema.mock.calls.length - 1];
    expect(lastCall[lastCall.length - 1]).toBe(2);
  });

  it('does not call setSchema when schema is invalid', () => {
    const oldNode = { meta: { name: 'T', description: 'd', icon: 'i' } };
    // newNode missing meta required fields to make it invalid for zTemplateSchema
    const newNode = { invalid: true };

    const setSchema = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it('uses produce branch for >10 mutations', () => {
    const oldNode = { meta: { name: 'T', description: 'd', icon: 'i' }, children: [] };

    // create 11 new children to force many mutations
    const newChildren = Array.from({ length: 11 }, (_, i) => ({ type: 'c', props: { x: i } }));
    const newNode = { meta: { name: 'T', description: 'd', icon: 'i' }, children: newChildren };

    const setSchema = vi.fn();

    updateSchema(oldNode, newNode, setSchema);

    expect(setSchema).toHaveBeenCalled();
    // The produce branch passes a single function argument to setSchema
    const producedArg = setSchema.mock.calls[0][0];
    expect(typeof producedArg).toBe('function');

    // Apply the produced function to the original node to simulate store update
    const result = producedArg(oldNode);
    expect(result.children.length).toBe(11);
    expect(result.children[10].props.x).toBe(10);
  });
});
