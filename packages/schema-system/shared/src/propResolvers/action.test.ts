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

  it('extracts callback-argument paths via $arg', () => {
    const set = vi.fn();
    const handler = resolve({ $action: 'store.set', args: ['notes', '$arg.detail'] }, { store: { set } });

    (handler as (e: unknown) => void)({ detail: false });
    expect(set).toHaveBeenCalledWith('notes', false);
  });

  it('extracts callback-argument paths via $event, the same as $arg', () => {
    // A lone `{ $action, args }` resolves once at render time, where `$event` matches no context key
    // — and an unresolved `$`-string is returned verbatim. So this used to hand the store the
    // *string* `'$event.detail'`: truthy, silent, no error. `setModuleEnabled(id, '$event.detail')`
    // is what that looked like from the outside — a toggle that could only switch a module on.
    const set = vi.fn();
    const handler = resolve({ $action: 'store.set', args: ['notes', '$event.detail'] }, { store: { set } });

    (handler as (e: unknown) => void)({ detail: false });
    expect(set).toHaveBeenCalledWith('notes', false);
  });

  it('passes the whole callback argument for a bare $event or $arg', () => {
    const set = vi.fn();
    const event = { detail: 42 };
    const viaEvent = resolve({ $action: 'store.set', args: ['$event'] }, { store: { set } });
    const viaArg = resolve({ $action: 'store.set', args: ['$arg'] }, { store: { set } });

    (viaEvent as (e: unknown) => void)(event);
    (viaArg as (e: unknown) => void)(event);
    expect(set).toHaveBeenNthCalledWith(1, event);
    expect(set).toHaveBeenNthCalledWith(2, event);
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

describe('lifecycle dispatch resolves without a reactive owner', () => {
  /**
   * `onSuccess`/`onError`/`onFinally` run from a promise callback, after the action settled, where
   * there is no reactive owner. Resolving them with the injected `memo` therefore created a
   * computation outside a root — Solid warns and never disposes it — so they resolve with `noMemo`.
   *
   * The observable half of that, and what these pin: an argument resolved through a memo arrives as
   * an *accessor*, so anything reading it before `deepUnwrap` sees a function rather than a value.
   */
  it('passes a $concat argument to a lifecycle action as a string, not an accessor', async () => {
    const navigate = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: 'abc' });
    const handler = resolve(
      {
        $action: 'myStore.create',
        onSuccess: [{ $action: 'routeStore.navigate', args: [{ $concat: ['/board/', '$result.id'] }] }],
      },
      { myStore: { create }, routeStore: { navigate } },
    );

    (handler as () => void)();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/board/abc');
  });

  it('gives a memo-passing caller the same final value, so unwrapping still covers the render path', () => {
    const save = vi.fn();
    // A render-time resolve keeps the reactive memo; `deepUnwrap` flattens it before the call.
    const handler = resolveProp(
      { $action: 'myStore.save', args: [{ $concat: ['a', 'b'] }] },
      { myStore: { save } },
      {},
      (fn) => fn(),
    );
    (handler as () => void)();
    expect(save).toHaveBeenCalledWith('ab');
  });
});
