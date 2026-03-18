import { describe, expect, it, vi } from 'vitest';

import { resolveProp, resolveProps, splitProps } from '../src/propResolvers';

describe('propResolvers (combined)', () => {
  it('resolves $store single and nested paths', () => {
    const stores = { userStore: { name: 'Sam', profile: { name: 'Sam', email: 's@example.com' } } };
    expect(resolveProp({ $store: 'userStore.name' }, stores, {})).toBe('Sam');
    expect(resolveProp({ $store: 'userStore.profile.name' }, stores, {})).toBe('Sam');
  });

  it('evaluates $expr expressions', () => {
    const ctx = { user: { name: 'Zed' } };
    expect(resolveProp({ $expr: 'user.name + "!"' }, {}, ctx)).toBe('Zed!');
    // invalid expression should return undefined
    expect(resolveProp({ $expr: 'not.a.valid..' }, {}, ctx)).toBe(undefined);
  });

  it('maps arrays with $map and $item selectors', () => {
    const stores = {};
    const ctx = {};
    const map = {
      $map: {
        items: [{ meta: { name: 'one' } }, { meta: { name: 'two' } }],
        select: { title: '$item.meta.name' },
      },
    };

    const result = resolveProp(map, stores, ctx) as Array<{ title: string }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual({ title: 'one' });
  });

  it('picks props with $pick', () => {
    const stores = { userStore: { profile: { name: 'Alice', email: 'a@e.com' } } };
    const pick = { $pick: { from: { $store: 'userStore.profile' }, props: ['name'] } };
    const result = resolveProp(pick, stores, {}, undefined);
    expect(result).toEqual({ name: 'Alice' });
  });

  it('resolves equality $eq and $ne', () => {
    const stores = {};
    expect(resolveProp({ $eq: [1, 1] }, stores, {})).toBe(true);
    expect(resolveProp({ $ne: [1, 2] }, stores, {})).toBe(true);
    const a = () => 5;
    const b = () => 5;
    expect(resolveProp({ $eq: [a, b] }, stores, {})).toBe(true);
  });

  it('splitProps separates primitive and complex props', () => {
    const all = { a: 1, b: { x: 2 }, c: null, d: () => {} };
    const { safeProps, complexProps } = splitProps(all);
    expect(safeProps).toHaveProperty('a');
    expect(safeProps).toHaveProperty('c');
    expect(complexProps).toHaveProperty('b');
  });

  it('throws when $store references entire store', () => {
    const stores = { userStore: { name: 'X' } };
    expect(() => resolveProp({ $store: 'userStore' }, stores, {})).toThrow();
  });

  it('resolveActionProp handles ../ relative route navigation', () => {
    const navigate = vi.fn();
    const stores = { routeStore: { navigate } };
    const context = { $nav: { baseDepth: 2 } };

    window.history.pushState({}, '', '/a/b/c');

    const action = { $action: 'routeStore.navigate', args: ['../foo'] };
    const fn = resolveProp(action, stores, context) as () => void;
    expect(typeof fn).toBe('function');
    fn();
    expect(navigate).toHaveBeenCalled();
    const callArgs = navigate.mock.calls[0];
    expect(callArgs[0]).toBe('/a/foo');
  });

  it('resolveProp with custom memo returns accessor for nested $store', () => {
    const stores = { s: { nested: { val: () => 5 } } };
    const memo = (fn: () => number) => () => fn();
    const res = resolveProp({ $store: 's.nested.val' }, stores, {}, memo as <T>(fn: () => T) => T) as () => number;
    expect(typeof res).toBe('function');
    expect(res()).toBe(5);
  });

  it('resolveStoreProp returns undefined if path missing', () => {
    const stores = { s: { nested: {} } };
    const res = resolveProp({ $store: 's.nested.missing' }, stores, {});
    expect(res).toBeUndefined();
  });

  it('resolveProp calls store method for non-route action', () => {
    const doer = vi.fn();
    const stores = { fooStore: { do: doer } };
    const action = { $action: 'fooStore.do', args: [42] };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    expect(doer).toHaveBeenCalledWith(42);
  });

  it('resolveIfProp chooses else branch when false', () => {
    const stores = {};
    const ctx = { val: false };
    const val = resolveProp({ $if: { condition: { $expr: 'val' }, then: 'A', else: 'B' } }, stores, ctx);
    expect(val).toBe('B');
  });

  it('routeStore.navigate with absolute path does not normalize', () => {
    const navigate = vi.fn();
    const stores = { routeStore: { navigate } };
    const ctx = { $nav: { baseDepth: 2 } };
    const action = { $action: 'routeStore.navigate', args: ['/home'] };
    const fn = resolveProp(action, stores, ctx) as () => void;
    fn();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('routeStore.navigate handles "." and "./" relative paths (basic assertions)', () => {
    const navigate = vi.fn();
    const stores = { routeStore: { navigate } };
    const ctx = { $nav: { baseDepth: 2 } };
    window.history.pushState({}, '', '/a/b/c/d');

    const dot = { $action: 'routeStore.navigate', args: ['.'] };
    const fnDot = resolveProp(dot, stores, ctx) as () => void;
    fnDot();
    expect(navigate).toHaveBeenCalled();
    expect(typeof navigate.mock.calls[0][0]).toBe('string');

    const dotSlash = { $action: 'routeStore.navigate', args: ['./z'] };
    const fnDotSlash = resolveProp(dotSlash, stores, ctx) as () => void;
    fnDotSlash();
    expect(navigate).toHaveBeenCalled();
    expect(typeof navigate.mock.calls[1][0]).toBe('string');
  });

  it('resolveMapProp handles accessor items and constant selects', () => {
    const stores = {};
    const ctx = {};
    const map = {
      $map: {
        items: () => [{ meta: { name: 'one' } }],
        select: { title: '$item.meta.name' },
      },
    };
    const result = resolveProp(map, stores, ctx) as Array<{ title: string }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual({ title: 'one' });

    const map2 = {
      $map: {
        items: [{ meta: { name: 'one' } }],
        select: { title: '$item.meta.name', constant: 123 },
      },
    };
    const result2 = resolveProp(map2, stores, ctx) as Array<{ title: string; constant: number }>;
    expect(result2[0].constant).toBe(123);
  });

  it('action with missing method should return undefined', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = resolveProp({ $action: 'noStore.noMethod', args: [] }, {}, {});
    expect(missing).toBeUndefined();
    spy.mockRestore();
  });

  it('resolvePickProp returns empty object when source is primitive', () => {
    const stores = { userStore: { profile: 'not-object' } };
    const pick = { $pick: { from: { $store: 'userStore.profile' }, props: ['name'] } };
    const res = resolveProp(pick, stores, {}, undefined);
    expect(res).toEqual({});
  });

  it('resolveProps resolves mixed props', () => {
    const stores = { s: { v: 1 } };
    const props = { a: 1, b: { $store: 's.v' }, c: { $expr: '1+2' } };
    const out = resolveProps(props, stores, {});
    expect(out.a).toBe(1);
    expect(out.b).toBe(1);
    expect(out.c).toBe(3);
  });

  it('$map transforms single objects (not just arrays)', () => {
    const stores = {};
    const ctx = {};
    const map = {
      $map: {
        items: { id: 'template-1', meta: { name: 'My Template', icon: 'star' } },
        select: { id: '$item.id', name: '$item.meta.name', icon: '$item.meta.icon' },
      },
    };

    const result = resolveProp(map, stores, ctx) as { id: string; name: string; icon: string };
    expect(result).toEqual({ id: 'template-1', name: 'My Template', icon: 'star' });
  });

  it('$map transforms single object from store accessor', () => {
    const stores = {
      templateStore: {
        currentTemplate: () => ({ id: 'default', meta: { name: 'Default', icon: 'home' } }),
      },
    };
    const map = {
      $map: {
        items: { $store: 'templateStore.currentTemplate' },
        select: { id: '$item.id', name: '$item.meta.name', icon: '$item.meta.icon' },
      },
    };

    const result = resolveProp(map, stores, {}) as { id: string; name: string; icon: string };
    expect(result).toEqual({ id: 'default', name: 'Default', icon: 'home' });
  });

  it('$map still works with arrays', () => {
    const stores = {};
    const map = {
      $map: {
        items: [
          { id: '1', meta: { name: 'One', icon: 'a' } },
          { id: '2', meta: { name: 'Two', icon: 'b' } },
        ],
        select: { id: '$item.id', name: '$item.meta.name' },
      },
    };

    const result = resolveProp(map, stores, {}) as Array<{ id: string; name: string }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: '1', name: 'One' });
    expect(result[1]).toEqual({ id: '2', name: 'Two' });
  });

  it('$arg.property extracts nested property from callback argument', () => {
    const doSomething = vi.fn();
    const stores = { myStore: { doSomething } };
    const action = { $action: 'myStore.doSomething', args: ['$arg.id'] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    expect(typeof fn).toBe('function');

    // Call with object that has nested id property
    fn({ id: 'abc123', name: 'Test', meta: { icon: 'star' } });

    // Should have called the method with just the extracted id
    expect(doSomething).toHaveBeenCalledWith('abc123');
  });

  it('$arg.deep.path extracts deeply nested property', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: ['$arg.user.profile.email'] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    fn({ user: { profile: { email: 'test@example.com', name: 'Test' } } });

    expect(callback).toHaveBeenCalledWith('test@example.com');
  });

  it('$arg without property passes entire first argument', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: ['$arg'] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    const testObj = { id: '123', name: 'Test' };
    fn(testObj);

    expect(callback).toHaveBeenCalledWith(testObj);
  });

  it('$arg works with DOM events (can access event properties)', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: ['$arg.target.value'] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;

    // Simulate an input event
    const mockEvent = {
      target: { value: 'extracted-value' },
      key: 'Enter',
    } as unknown as Event;

    // When event is passed, $arg can now access any event property
    fn(mockEvent);

    // Should extract the target.value from the event
    expect(callback).toHaveBeenCalledWith('extracted-value');
  });

  it('$arg can access keyboard event properties', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: ['$arg.key'] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;

    // Simulate a keyboard event
    const mockEvent = {
      key: 'Enter',
      target: { value: 'test' },
    } as unknown as KeyboardEvent;

    fn(mockEvent);

    // Should extract the key property from the event
    expect(callback).toHaveBeenCalledWith('Enter');
  });

  it('$arg with multiple args processes only $arg tokens', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: ['$arg.id', 'static-value', { $expr: '1+1' }] };

    const fn = resolveProp(action, stores, { ignored: true }) as (arg: unknown) => void;
    fn({ id: 'test-id', name: 'Test' });

    expect(callback).toHaveBeenCalledWith('test-id', 'static-value', 2);
  });

  // --- $and / $or operators ---

  it('$and returns true when all operands are truthy', () => {
    expect(resolveProp({ $and: [true, 1, 'yes'] }, {}, {})).toBe(true);
  });

  it('$and returns false when any operand is falsy', () => {
    expect(resolveProp({ $and: [true, false, true] }, {}, {})).toBe(false);
    expect(resolveProp({ $and: [1, 0] }, {}, {})).toBe(false);
  });

  it('$and short-circuits on first falsy value', () => {
    // The $expr should never be evaluated because the first operand is false
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveProp({ $and: [false, { $expr: 'this.would.break..' }] }, {}, {})).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('$and works with $store operands', () => {
    const stores = { s: { a: () => true, b: () => false } };
    expect(resolveProp({ $and: [{ $store: 's.a' }, { $store: 's.b' }] }, stores, {})).toBe(false);
    const stores2 = { s: { a: () => true, b: () => true } };
    expect(resolveProp({ $and: [{ $store: 's.a' }, { $store: 's.b' }] }, stores2, {})).toBe(true);
  });

  it('$or returns true when any operand is truthy', () => {
    expect(resolveProp({ $or: [false, 0, 'yes'] }, {}, {})).toBe(true);
    expect(resolveProp({ $or: [false, true] }, {}, {})).toBe(true);
  });

  it('$or returns false when all operands are falsy', () => {
    expect(resolveProp({ $or: [false, 0, '', null] }, {}, {})).toBe(false);
  });

  it('$or short-circuits on first truthy value', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveProp({ $or: [true, { $expr: 'this.would.break..' }] }, {}, {})).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('$and/$or compose with $not and $store', () => {
    const stores = { s: { isAdmin: () => true, isLocked: () => false } };
    // { $and: [{ $store: 's.isAdmin' }, { $not: { $store: 's.isLocked' } }] }
    const result = resolveProp({ $and: [{ $store: 's.isAdmin' }, { $not: { $store: 's.isLocked' } }] }, stores, {});
    expect(result).toBe(true);
  });

  // --- $action error handling ---

  it('$action warns on missing store', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveProp({ $action: 'noStore.noMethod', args: [] }, {}, {});
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('noStore'));
    spy.mockRestore();
  });

  it('$action warns on missing method', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stores = { myStore: { exists: () => {} } };
    const result = resolveProp({ $action: 'myStore.missing', args: [] }, stores, {});
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('missing'));
    spy.mockRestore();
  });
});
