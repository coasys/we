import { describe, expect, it, vi } from 'vitest';

import { resolveProp } from './dispatcher';
import type { Props } from './types';

function resolve(token: unknown, stores: Props) {
  return resolveProp(token, stores, {});
}

describe('$action path resolution', () => {
  it('resolves the classic store.method form', () => {
    const save = vi.fn();
    const handler = resolve({ $action: 'myStore.save' }, { myStore: { save } });

    expect(typeof handler).toBe('function');
    (handler as () => void)();
    expect(save).toHaveBeenCalled();
  });

  it('resolves a namespaced store.sub.method form', () => {
    // Two segments used to be assumed, so `modules.notes.toggle` resolved `stores.modules.notes` —
    // an object rather than a function — and the handler was silently dropped. The button rendered,
    // clicked, and did nothing, with no error anywhere.
    const toggle = vi.fn();
    const handler = resolve({ $action: 'modules.notes.toggle' }, { modules: { notes: { toggle } } });

    expect(typeof handler).toBe('function');
    (handler as () => void)();
    expect(toggle).toHaveBeenCalled();
  });

  it('resolves arbitrary depth, matching what $store has always allowed', () => {
    const deep = vi.fn();
    const handler = resolve({ $action: 'a.b.c.d.run' }, { a: { b: { c: { d: { run: deep } } } } });

    (handler as () => void)();
    expect(deep).toHaveBeenCalled();
  });

  it('passes resolved args through', () => {
    const add = vi.fn();
    const handler = resolve(
      { $action: 'modules.notes.add', args: ['hello', { $store: 'cfg.tag' }] },
      { modules: { notes: { add } }, cfg: { tag: 'urgent' } },
    );

    (handler as () => void)();
    expect(add).toHaveBeenCalledWith('hello', 'urgent');
  });

  it('warns naming the full path when the owner is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolve({ $action: 'modules.absent.toggle' }, { modules: {} });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('modules.absent'));
    warn.mockRestore();
  });

  it('warns naming the method when the owner exists but the method does not', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolve({ $action: 'modules.notes.nope' }, { modules: { notes: {} } });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
    warn.mockRestore();
  });

  it('does not invoke accessors while walking to the method', () => {
    // Unlike `$store`'s walkPath, which calls signal accessors at each step to unwrap values, the
    // path to a method must not be invoked — a store namespace is a plain object, and calling a
    // signal on the way through would be wrong.
    const signal = vi.fn(() => 'value');
    const run = vi.fn();
    const handler = resolve({ $action: 'modules.notes.run' }, { modules: { notes: { run, open: signal } } });

    (handler as () => void)();
    expect(run).toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  });
});
