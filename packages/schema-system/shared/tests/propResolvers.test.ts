import { describe, expect, it, vi } from 'vitest';

import { REACTIVE_ACCESSOR, resolveProp, resolveProps, splitProps } from '../src/propResolvers';
import type { LocalFieldMeta } from '../src/propResolvers/local';
import {
  extractFromPath,
  resolveErrorProp,
  resolveFormValidProp,
  resolveLocalProp,
  resolveResetLocalProp,
  resolveSetLocalProp,
  resolveTouchedProp,
  resolveTouchProp,
  resolveValidProp,
} from '../src/propResolvers/local';
import { markReactive } from '../src/propResolvers/reactive';

describe('propResolvers (combined)', () => {
  it('resolves $store single and nested paths', () => {
    const stores = { userStore: { name: 'Sam', profile: { name: 'Sam', email: 's@example.com' } } };
    expect(resolveProp({ $store: 'userStore.name' }, stores, {})).toBe('Sam');
    expect(resolveProp({ $store: 'userStore.profile.name' }, stores, {})).toBe('Sam');
  });

  it('resolves $item.* context references', () => {
    const ctx = { user: { name: 'Zed' } };
    expect(resolveProp('$user.name', {}, ctx)).toBe('Zed');
    // non-existent context key returns string as-is
    expect(resolveProp('$missing.key', {}, ctx)).toBe('$missing.key');
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
    const val = resolveProp({ $if: { condition: '$val', then: 'A', else: 'B' } }, stores, ctx);
    expect(val).toBe('B');
  });

  it('resolveIfProp standard path does not eagerly invoke $action handler', () => {
    const handler = vi.fn();
    const stores = { myStore: { submit: handler } };
    const ctx = { isValid: true };
    const schema = {
      $if: {
        condition: '$isValid',
        then: { $action: 'myStore.submit', args: ['data'] },
      },
    };
    // Resolving the $if should NOT call the action — it should return the handler function
    const result = resolveProp(schema, stores, ctx);
    expect(handler).not.toHaveBeenCalled();
    // The result should be a reactive accessor wrapping the handler function
    expect(typeof result).toBe('function');
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
    const props = { a: 1, b: { $store: 's.v' }, c: { $concat: ['hello', ' ', 'world'] } };
    const out = resolveProps(props, stores, {});
    expect(out.a).toBe(1);
    expect(out.b).toBe(1);
    expect(out.c).toBe('hello world');
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
    const action = { $action: 'store.callback', args: ['$arg.id', 'static-value', 42] };

    const fn = resolveProp(action, stores, { ignored: true }) as (arg: unknown) => void;
    fn({ id: 'test-id', name: 'Test' });

    expect(callback).toHaveBeenCalledWith('test-id', 'static-value', 42);
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
    expect(resolveProp({ $and: [false, 'should-not-matter'] }, {}, {})).toBe(false);
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
    expect(resolveProp({ $or: [true, 'should-not-matter'] }, {}, {})).toBe(true);
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

  // --- $concat ---

  it('$concat joins string parts', () => {
    const result = resolveProp({ $concat: ['/space/', 'abc123'] }, {}, {});
    expect(result).toBe('/space/abc123');
  });

  it('$concat resolves context references in parts', () => {
    const ctx = { space: { uuid: 'xyz' } };
    const result = resolveProp({ $concat: ['/space/', '$space.uuid'] }, {}, ctx);
    expect(result).toBe('/space/xyz');
  });

  it('$concat treats null/undefined parts as empty strings', () => {
    const result = resolveProp({ $concat: ['hello', null, 'world'] }, {}, {});
    expect(result).toBe('helloworld');
  });

  // --- Context reference strings ---

  it('resolves $contextKey.path strings from context', () => {
    const ctx = { item: { name: 'Test', meta: { icon: 'star' } } };
    expect(resolveProp('$item.name', {}, ctx)).toBe('Test');
    expect(resolveProp('$item.meta.icon', {}, ctx)).toBe('star');
  });

  it('resolves $contextKey without dot path to whole value', () => {
    const ctx = { item: 'hello' };
    expect(resolveProp('$item', {}, ctx)).toBe('hello');
  });

  it('returns string as-is when context key not found', () => {
    expect(resolveProp('$unknown.key', {}, {})).toBe('$unknown.key');
  });

  it('returns undefined for missing nested path in context', () => {
    const ctx = { item: { name: 'Test' } };
    expect(resolveProp('$item.nonexistent.deep', {}, ctx)).toBeUndefined();
  });
});

// --- $local / $setLocal ---

describe('$local resolver', () => {
  it('returns a reactive accessor for a declared field', () => {
    const accessor = () => 'hello';
    const context = { $local: { name: accessor } };
    const result = resolveLocalProp({ $local: 'name' }, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe('hello');
    expect(REACTIVE_ACCESSOR in (result as object)).toBe(true);
  });

  it('returns undefined and warns when no $local in context', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveLocalProp({ $local: 'name' }, {});
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no $localState'));
    spy.mockRestore();
  });

  it('returns undefined and warns for undeclared field', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { $local: { name: () => '' } };
    const result = resolveLocalProp({ $local: 'missing' }, context);
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not declared'));
    spy.mockRestore();
  });
});

describe('$setLocal resolver', () => {
  it('creates an event handler that calls the setter with extracted value', () => {
    const setter = vi.fn();
    const context = { $localSetters: { name: setter } };
    const handler = resolveSetLocalProp({ $setLocal: 'name', from: '$event.target.value' }, context);
    expect(typeof handler).toBe('function');
    handler({ target: { value: 'hello' } });
    expect(setter).toHaveBeenCalledWith('hello');
  });

  it('returns noop and warns when no $localSetters in context', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = resolveSetLocalProp({ $setLocal: 'name', from: '$event' }, {});
    expect(typeof handler).toBe('function');
    handler('anything'); // should not throw
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no $localState'));
    spy.mockRestore();
  });

  it('returns noop and warns for undeclared setter', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { $localSetters: { name: vi.fn() } };
    const handler = resolveSetLocalProp({ $setLocal: 'missing', from: '$event' }, context);
    handler('anything');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not declared'));
    spy.mockRestore();
  });
});

describe('extractFromPath', () => {
  it('returns raw event for "$event"', () => {
    const event = { target: { value: 'x' } };
    expect(extractFromPath(event, '$event')).toBe(event);
  });

  it('extracts nested path from event', () => {
    const event = { target: { value: 'hello' } };
    expect(extractFromPath(event, '$event.target.value')).toBe('hello');
  });

  it('extracts single-level path', () => {
    const event = { detail: 42 };
    expect(extractFromPath(event, '$event.detail')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(extractFromPath({}, '$event.missing.deep')).toBeUndefined();
  });
});

describe('$local/$setLocal via dispatcher', () => {
  it('resolveProp dispatches $local tokens', () => {
    const accessor = () => 'test';
    const context = { $local: { field: accessor } };
    const result = resolveProp({ $local: 'field' }, {}, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe('test');
  });

  it('resolveProp dispatches $setLocal tokens', () => {
    const setter = vi.fn();
    const context = { $localSetters: { field: setter } };
    const handler = resolveProp({ $setLocal: 'field', from: '$event.detail' }, {}, context) as (e: unknown) => void;
    handler({ detail: 'value' });
    expect(setter).toHaveBeenCalledWith('value');
  });
});

describe('$action arg unwrapping', () => {
  it('unwraps REACTIVE_ACCESSOR args at execution time', () => {
    const method = vi.fn();
    const stores = { myStore: { method } };

    // Simulate a $local accessor (marked reactive)
    let value = 'initial';
    const accessor = markReactive(() => value);

    const context = { $local: { name: accessor } };
    const action = { $action: 'myStore.method', args: [{ $local: 'name' }] };
    const fn = resolveProp(action, stores, context) as () => void;

    // Change the value before calling — unwrap should read current value
    value = 'updated';
    fn();
    expect(method).toHaveBeenCalledWith('updated');
  });

  it('leaves non-reactive function args untouched', () => {
    const method = vi.fn();
    const stores = { myStore: { method } };
    const action = { $action: 'myStore.method', args: [42, 'static'] };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    expect(method).toHaveBeenCalledWith(42, 'static');
  });
});

// --- Validation token resolver tests ---

function createMockMeta(overrides: Partial<LocalFieldMeta> = {}): LocalFieldMeta {
  return {
    initial: '',
    rules: [],
    touched: () => false,
    setTouched: vi.fn(),
    errors: () => [],
    reset: vi.fn(),
    ...overrides,
  };
}

describe('$error resolver', () => {
  it('returns empty string when not touched', () => {
    const meta = createMockMeta({ errors: () => ['Required'], touched: () => false });
    const context = { $localMeta: { name: meta } };
    const result = resolveErrorProp({ $error: 'name' }, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe('');
  });

  it('returns first error when touched', () => {
    const meta = createMockMeta({ errors: () => ['Required', 'Too short'], touched: () => true });
    const context = { $localMeta: { name: meta } };
    const result = resolveErrorProp({ $error: 'name' }, context);
    expect((result as () => unknown)()).toBe('Required');
  });

  it('returns empty string when touched but no errors', () => {
    const meta = createMockMeta({ errors: () => [], touched: () => true });
    const context = { $localMeta: { name: meta } };
    const result = resolveErrorProp({ $error: 'name' }, context);
    expect((result as () => unknown)()).toBe('');
  });

  it('returns empty string and warns for unknown field', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { $localMeta: {} };
    const result = resolveErrorProp({ $error: 'missing' }, context);
    expect(result).toBe('');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    spy.mockRestore();
  });
});

describe('$valid resolver', () => {
  it('returns true when no errors', () => {
    const meta = createMockMeta({ errors: () => [] });
    const context = { $localMeta: { name: meta } };
    const result = resolveValidProp({ $valid: 'name' }, context);
    expect((result as () => unknown)()).toBe(true);
  });

  it('returns false when there are errors (ignores touched)', () => {
    const meta = createMockMeta({ errors: () => ['Required'], touched: () => false });
    const context = { $localMeta: { name: meta } };
    const result = resolveValidProp({ $valid: 'name' }, context);
    expect((result as () => unknown)()).toBe(false);
  });

  it('returns true and warns for unknown field', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveValidProp({ $valid: 'missing' }, { $localMeta: {} });
    expect(result).toBe(true);
    spy.mockRestore();
  });
});

describe('$touched resolver', () => {
  it('returns false when not touched', () => {
    const meta = createMockMeta({ touched: () => false });
    const context = { $localMeta: { name: meta } };
    const result = resolveTouchedProp({ $touched: 'name' }, context);
    expect((result as () => unknown)()).toBe(false);
  });

  it('returns true when touched', () => {
    const meta = createMockMeta({ touched: () => true });
    const context = { $localMeta: { name: meta } };
    const result = resolveTouchedProp({ $touched: 'name' }, context);
    expect((result as () => unknown)()).toBe(true);
  });
});

describe('$formValid resolver', () => {
  it('returns true when all scoped fields are valid', () => {
    const meta1 = createMockMeta({ errors: () => [] });
    const meta2 = createMockMeta({ errors: () => [] });
    const context = {
      $localMeta: { name: meta1, email: meta2 },
      $localScopeFields: ['name', 'email'],
    };
    const result = resolveFormValidProp(context);
    expect((result as () => unknown)()).toBe(true);
  });

  it('returns false when any scoped field has errors', () => {
    const meta1 = createMockMeta({ errors: () => [] });
    const meta2 = createMockMeta({ errors: () => ['Required'] });
    const context = {
      $localMeta: { name: meta1, email: meta2 },
      $localScopeFields: ['name', 'email'],
    };
    const result = resolveFormValidProp(context);
    expect((result as () => unknown)()).toBe(false);
  });

  it('ignores fields not in scope', () => {
    const meta1 = createMockMeta({ errors: () => [] });
    const meta2 = createMockMeta({ errors: () => ['Required'] });
    const context = {
      $localMeta: { name: meta1, email: meta2 },
      $localScopeFields: ['name'], // email not in scope
    };
    const result = resolveFormValidProp(context);
    expect((result as () => unknown)()).toBe(true);
  });
});

describe('$touch resolver', () => {
  it('creates a handler that marks a single field as touched', () => {
    const setTouched = vi.fn();
    const meta = createMockMeta({ setTouched });
    const context = { $localMeta: { name: meta }, $localScopeFields: ['name'] };
    const handler = resolveTouchProp({ $touch: 'name' }, context);
    handler();
    expect(setTouched).toHaveBeenCalledWith(true);
  });

  it('creates a handler that touches all scoped fields', () => {
    const setTouched1 = vi.fn();
    const setTouched2 = vi.fn();
    const meta1 = createMockMeta({ setTouched: setTouched1 });
    const meta2 = createMockMeta({ setTouched: setTouched2 });
    const context = {
      $localMeta: { name: meta1, email: meta2 },
      $localScopeFields: ['name', 'email'],
    };
    const handler = resolveTouchProp({ $touch: '$all' }, context);
    handler();
    expect(setTouched1).toHaveBeenCalledWith(true);
    expect(setTouched2).toHaveBeenCalledWith(true);
  });

  it('$all only touches scoped fields, not inherited', () => {
    const parentTouch = vi.fn();
    const childTouch = vi.fn();
    const parentMeta = createMockMeta({ setTouched: parentTouch });
    const childMeta = createMockMeta({ setTouched: childTouch });
    const context = {
      $localMeta: { parentField: parentMeta, childField: childMeta },
      $localScopeFields: ['childField'], // only child in scope
    };
    const handler = resolveTouchProp({ $touch: '$all' }, context);
    handler();
    expect(childTouch).toHaveBeenCalledWith(true);
    expect(parentTouch).not.toHaveBeenCalled();
  });
});

describe('$resetLocal resolver', () => {
  it('creates a handler that resets all scoped fields', () => {
    const reset1 = vi.fn();
    const reset2 = vi.fn();
    const meta1 = createMockMeta({ reset: reset1 });
    const meta2 = createMockMeta({ reset: reset2 });
    const context = {
      $localMeta: { name: meta1, email: meta2 },
      $localScopeFields: ['name', 'email'],
    };
    const handler = resolveResetLocalProp(context);
    handler();
    expect(reset1).toHaveBeenCalled();
    expect(reset2).toHaveBeenCalled();
  });

  it('only resets scoped fields, not inherited', () => {
    const parentReset = vi.fn();
    const childReset = vi.fn();
    const parentMeta = createMockMeta({ reset: parentReset });
    const childMeta = createMockMeta({ reset: childReset });
    const context = {
      $localMeta: { parentField: parentMeta, childField: childMeta },
      $localScopeFields: ['childField'],
    };
    const handler = resolveResetLocalProp(context);
    handler();
    expect(childReset).toHaveBeenCalled();
    expect(parentReset).not.toHaveBeenCalled();
  });
});

describe('dispatcher integration — validation tokens', () => {
  it('resolves $error through dispatcher', () => {
    const meta = createMockMeta({ errors: () => ['Required'], touched: () => true });
    const context = { $localMeta: { name: meta } };
    const result = resolveProp({ $error: 'name' }, {}, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe('Required');
  });

  it('resolves $valid through dispatcher', () => {
    const meta = createMockMeta({ errors: () => [] });
    const context = { $localMeta: { name: meta } };
    const result = resolveProp({ $valid: 'name' }, {}, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe(true);
  });

  it('resolves $touched through dispatcher', () => {
    const meta = createMockMeta({ touched: () => true });
    const context = { $localMeta: { name: meta } };
    const result = resolveProp({ $touched: 'name' }, {}, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe(true);
  });

  it('resolves $formValid through dispatcher', () => {
    const meta = createMockMeta({ errors: () => [] });
    const context = { $localMeta: { name: meta }, $localScopeFields: ['name'] };
    const result = resolveProp({ $formValid: '$scope' }, {}, context);
    expect(typeof result).toBe('function');
    expect((result as () => unknown)()).toBe(true);
  });

  it('resolves $touch through dispatcher', () => {
    const setTouched = vi.fn();
    const meta = createMockMeta({ setTouched });
    const context = { $localMeta: { name: meta }, $localScopeFields: ['name'] };
    const handler = resolveProp({ $touch: 'name' }, {}, context) as () => void;
    handler();
    expect(setTouched).toHaveBeenCalledWith(true);
  });

  it('resolves $resetLocal through dispatcher', () => {
    const reset = vi.fn();
    const meta = createMockMeta({ reset });
    const context = { $localMeta: { name: meta }, $localScopeFields: ['name'] };
    const handler = resolveProp({ $resetLocal: '$scope' }, {}, context) as () => void;
    handler();
    expect(reset).toHaveBeenCalled();
  });
});
