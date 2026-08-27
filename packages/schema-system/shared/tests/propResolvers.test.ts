import { describe, expect, it, vi } from 'vitest';

import { noMemo, REACTIVE_ACCESSOR, resolveProp, resolveProps, splitProps } from '../src/propResolvers';
import type { LocalFieldMeta } from '../src/propResolvers/local';
import { resolveResetLocalProp, resolveSetLocalProp, resolveTouchProp } from '../src/propResolvers/local';
import { markReactive } from '../src/propResolvers/reactive';

const unwrap = (value: unknown): unknown =>
  typeof value === 'function' && REACTIVE_ACCESSOR in value ? (value as unknown as () => unknown)() : value;

const read = (source: string, stores: Record<string, unknown> = {}, context: Record<string, unknown> = {}) =>
  unwrap(resolveProp({ $: source }, stores, context, noMemo));

describe('propResolvers (combined)', () => {
  it('reads store paths through an expression', () => {
    const stores = { userStore: { name: 'Sam', profile: { name: 'Sam', email: 's@example.com' } } };
    expect(read('userStore.name', stores)).toBe('Sam');
    expect(read('userStore.profile.name', stores)).toBe('Sam');
  });

  it('reads context names through an expression', () => {
    const ctx = { user: { name: 'Zed' } };
    expect(read('user.name', {}, ctx)).toBe('Zed');
    expect(read('missing.key', {}, ctx)).toBeUndefined();
  });

  it('leaves strings as text', () => {
    expect(resolveProp('$user.name', {}, { user: { name: 'Zed' } })).toBe('$user.name');
    expect(resolveProp('plain', {}, {})).toBe('plain');
  });

  it('projects lists with a map comprehension', () => {
    const ctx = { rows: [{ meta: { name: 'one' } }, { meta: { name: 'two' } }] };
    expect(read('rows.map(r, { title: r.meta.name })', {}, ctx)).toEqual([{ title: 'one' }, { title: 'two' }]);
  });

  it('picks props with pick()', () => {
    const stores = { userStore: { profile: { name: 'Alice', email: 'a@e.com' } } };
    expect(read("pick(userStore.profile, ['name'])", stores)).toEqual({ name: 'Alice' });
    expect(read("pick(userStore.missing, ['name'])", stores)).toEqual({});
  });

  it('compares with == and !=', () => {
    expect(read('1 == 1')).toBe(true);
    expect(read('1 != 2')).toBe(true);
    expect(read("'a' == 'b'")).toBe(false);
  });

  it('splitProps separates primitive and complex props', () => {
    const all = { a: 1, b: { x: 2 }, c: null, d: () => {} };
    const { safeProps, complexProps } = splitProps(all);
    expect(safeProps).toHaveProperty('a');
    expect(safeProps).toHaveProperty('c');
    expect(complexProps).toHaveProperty('b');
  });

  it('reads nothing for a whole store', () => {
    const stores = { userStore: { name: 'X' } };
    expect(read('userStore', stores)).toBeUndefined();
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

  it('resolveProp with a memo returns a reactive accessor for a store read', () => {
    // Tagged, because that is what a store bag contains: the host marks state accessors when it
    // builds a template's bag, and an expression calls only those.
    const stores = { s: { nested: { val: markReactive(() => 5) } } };
    const memo = (fn: () => number) => () => fn();
    const res = resolveProp({ $: 's.nested.val' }, stores, {}, memo as <T>(fn: () => T) => T) as () => number;
    expect(typeof res).toBe('function');
    expect(res()).toBe(5);
  });

  it('never calls an untagged function while reading a store path', () => {
    /*
      A store read must not be an execution channel: a template naming a zero-argument store method
      must not have it called during paint, with no click and no user intent. An action in the bag
      is a function the resolver walks past without touching, and the path resolves to nothing
      rather than to a side effect.
    */
    let called = false;
    const stores = { sessionStore: { logout: () => (called = true) } };

    expect(read('sessionStore.logout', stores)).toBeUndefined();
    expect(called).toBe(false);
  });

  it('does not hand a bare function to a prop either', () => {
    // Returning the function itself would put the channel straight back: a component receiving it
    // could call it, and a template has no legitimate way to have produced a callable.
    const stores = { s: { action: () => 'boom' } };
    expect(read('s.action', stores)).toBeUndefined();
  });

  it('reads undefined for a missing path', () => {
    const stores = { s: { nested: {} } };
    expect(read('s.nested.missing', stores)).toBeUndefined();
  });

  it('resolveProp calls store method for non-route action', () => {
    const doer = vi.fn();
    const stores = { fooStore: { do: doer } };
    const action = { $action: 'fooStore.do', args: [42] };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    expect(doer).toHaveBeenCalledWith(42);
  });

  it('a ternary chooses the else branch when false', () => {
    expect(read("val ? 'A' : 'B'", {}, { val: false })).toBe('B');
  });

  it('a handler $if does not eagerly invoke its $action', () => {
    const handler = vi.fn();
    const stores = { myStore: { submit: handler } };
    const ctx = { isValid: true };
    const schema = {
      $if: {
        condition: { $: 'isValid' },
        then: { $action: 'myStore.submit', args: ['data'] },
      },
    };
    const result = resolveProp(schema, stores, ctx);
    expect(handler).not.toHaveBeenCalled();
    expect(typeof result).toBe('function');
    (result as () => void)();
    expect(handler).toHaveBeenCalledWith('data');
  });

  it('handler array dispatches all actions when $if.then is an array', () => {
    const save = vi.fn();
    const stores = { spaceStore: { save } };
    const localCtx = {
      isDirty: true,
      $localSetters: { saving: vi.fn() },
    };
    const schema = {
      onClick: [
        {
          $if: {
            condition: { $: 'isDirty' },
            then: [
              { $setLocal: 'saving', value: true },
              { $action: 'spaceStore.save', args: [] },
            ],
          },
        },
      ],
    };
    const resolved = resolveProp(schema, stores, localCtx) as { onClick: () => void };
    resolved.onClick();
    expect(save).toHaveBeenCalled();
    expect(localCtx.$localSetters.saving).toHaveBeenCalledWith(true);
  });

  it('handler array $if.then array: only dispatches when condition is true', () => {
    const actionA = vi.fn();
    const actionB = vi.fn();
    const stores = { s: { a: actionA, b: actionB } };
    const schema = {
      onClick: [
        {
          $if: {
            condition: { $: 'flag' },
            then: [
              { $action: 's.a', args: [] },
              { $action: 's.b', args: [] },
            ],
          },
        },
      ],
    };
    const resolvedFalse = resolveProp(schema, stores, { flag: false }) as { onClick: () => void };
    resolvedFalse.onClick();
    expect(actionA).not.toHaveBeenCalled();
    expect(actionB).not.toHaveBeenCalled();

    const resolvedTrue = resolveProp(schema, stores, { flag: true }) as { onClick: () => void };
    resolvedTrue.onClick();
    expect(actionA).toHaveBeenCalled();
    expect(actionB).toHaveBeenCalled();
  });

  it('a handler $if reads the event in its condition', () => {
    const onEnter = vi.fn();
    const stores = { s: { onEnter } };
    const schema = {
      onKeyDown: [{ $if: { condition: { $: "event.key == 'Enter'" }, then: { $action: 's.onEnter' } } }],
    };
    const resolved = resolveProp(schema, stores, {}) as { onKeyDown: (e: unknown) => void };
    resolved.onKeyDown({ key: 'Escape' });
    expect(onEnter).not.toHaveBeenCalled();
    resolved.onKeyDown({ key: 'Enter' });
    expect(onEnter).toHaveBeenCalled();
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

  it('action with missing method should return undefined', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = resolveProp({ $action: 'noStore.noMethod', args: [] }, {}, {});
    expect(missing).toBeUndefined();
    spy.mockRestore();
  });

  it('resolveProps resolves mixed props', () => {
    const stores = { s: { v: 1 } };
    const props = { a: 1, b: { $: 's.v' }, c: { $: "'hello' + ' ' + 'world'" } };
    const out = resolveProps(props, stores, {});
    expect(out.a).toBe(1);
    expect(unwrap(out.b)).toBe(1);
    expect(unwrap(out.c)).toBe('hello world');
  });

  it('projects a single object from a store accessor', () => {
    const stores = {
      templateStore: {
        currentTemplate: markReactive(() => ({ id: 'default', meta: { name: 'Default', icon: 'home' } })),
      },
    };
    const source =
      '{ id: templateStore.currentTemplate.id, name: templateStore.currentTemplate.meta.name, icon: templateStore.currentTemplate.meta.icon }';
    expect(read(source, stores)).toEqual({ id: 'default', name: 'Default', icon: 'home' });
  });

  it('an expression on arg extracts a nested property from the callback argument', () => {
    const doSomething = vi.fn();
    const stores = { myStore: { doSomething } };
    const action = { $action: 'myStore.doSomething', args: [{ $: 'arg.id' }] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    expect(typeof fn).toBe('function');
    fn({ id: 'abc123', name: 'Test', meta: { icon: 'star' } });
    expect(doSomething).toHaveBeenCalledWith('abc123');
  });

  it('arg reads deeply nested properties', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: [{ $: 'arg.user.profile.email' }] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    fn({ user: { profile: { email: 'test@example.com', name: 'Test' } } });
    expect(callback).toHaveBeenCalledWith('test@example.com');
  });

  it('a bare arg passes the entire first argument', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: [{ $: 'arg' }] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    const testObj = { id: '123', name: 'Test' };
    fn(testObj);
    expect(callback).toHaveBeenCalledWith(testObj);
  });

  it('arg works with DOM events (can access event properties)', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: [{ $: 'arg.target.value' }] };

    const fn = resolveProp(action, stores, {}) as (arg: unknown) => void;
    const mockEvent = { target: { value: 'extracted-value' }, key: 'Enter' } as unknown as Event;
    fn(mockEvent);
    expect(callback).toHaveBeenCalledWith('extracted-value');
  });

  it('arg expressions sit among static args', () => {
    const callback = vi.fn();
    const stores = { store: { callback } };
    const action = { $action: 'store.callback', args: [{ $: 'arg.id' }, 'static-value', 42] };

    const fn = resolveProp(action, stores, { ignored: true }) as (arg: unknown) => void;
    fn({ id: 'test-id', name: 'Test' });
    expect(callback).toHaveBeenCalledWith('test-id', 'static-value', 42);
  });

  // --- boolean logic ---

  it('&& and || answer with booleans', () => {
    expect(read("true && 1 && 'yes'")).toBe(true);
    expect(read('true && false')).toBe(false);
    expect(read("false || 0 || 'yes'")).toBe(true);
    expect(read("false || 0 || '' || null")).toBe(false);
  });

  it('boolean logic reads store accessors', () => {
    const stores = { s: { isAdmin: markReactive(() => true), isLocked: markReactive(() => false) } };
    expect(read('s.isAdmin && !s.isLocked', stores)).toBe(true);
    expect(read('s.isAdmin && s.isLocked', stores)).toBe(false);
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

  // --- $action lifecycle callbacks ---

  it('onSuccess fires after async action resolves, with result in scope', async () => {
    const successValue = { uuid: 'space-123' };
    const onSuccessSpy = vi.fn();
    const stores = { myStore: { create: () => Promise.resolve(successValue), notify: onSuccessSpy } };
    const action = {
      $action: 'myStore.create',
      args: [],
      onSuccess: [{ $action: 'myStore.notify', args: [{ $: 'result.uuid' }] }],
    };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(onSuccessSpy).toHaveBeenCalledWith('space-123');
  });

  it('onError fires when async action rejects', async () => {
    const errorSpy = vi.fn();
    const stores = { myStore: { fail: () => Promise.reject(new Error('oops')), handleError: errorSpy } };
    const action = {
      $action: 'myStore.fail',
      args: [],
      onError: [{ $action: 'myStore.handleError', args: [{ $: 'result.message' }] }],
    };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(errorSpy).toHaveBeenCalledWith('oops');
  });

  it('onFinally fires regardless of success or failure', async () => {
    const finallySpy = vi.fn();
    const stores = { myStore: { succeed: () => Promise.resolve('ok'), cleanup: finallySpy } };
    const action = {
      $action: 'myStore.succeed',
      onFinally: [{ $action: 'myStore.cleanup', args: [] }],
    };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(finallySpy).toHaveBeenCalled();
  });

  it('onFinally fires after rejection too', async () => {
    const finallySpy = vi.fn();
    const errorSpy = vi.fn();
    const stores = { myStore: { fail: () => Promise.reject(new Error('boom')), cleanup: finallySpy, onErr: errorSpy } };
    const action = {
      $action: 'myStore.fail',
      onError: [{ $action: 'myStore.onErr', args: [] }],
      onFinally: [{ $action: 'myStore.cleanup', args: [] }],
    };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(finallySpy).toHaveBeenCalled();
  });

  it('onSuccess can set local state via $setLocal', async () => {
    let storedValue: unknown;
    const mockContext = {
      $localSetters: {
        modalOpen: (v: unknown) => {
          storedValue = v;
        },
      },
    };
    const stores = { myStore: { create: () => Promise.resolve('done') } };
    const action = {
      $action: 'myStore.create',
      onSuccess: [{ $setLocal: 'modalOpen', value: false }],
    };
    const fn = resolveProp(action, stores, mockContext) as () => void;
    fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(storedValue).toBe(false);
  });

  it('logs error to console when async action rejects and no onError is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stores = { myStore: { fail: () => Promise.reject(new Error('unhandled')) } };
    const action = { $action: 'myStore.fail', args: [] };
    const fn = resolveProp(action, stores, {}) as () => void;
    fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('myStore.fail'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('does not attach lifecycle handlers for synchronous (non-promise) actions', () => {
    const successSpy = vi.fn();
    const stores = { myStore: { sync: () => 42, notify: successSpy } };
    const action = {
      $action: 'myStore.sync',
      onSuccess: [{ $action: 'myStore.notify', args: [] }],
    };
    const fn = resolveProp(action, stores, {}) as () => unknown;
    fn();
    expect(successSpy).not.toHaveBeenCalled();
  });

  // --- interpolation ---

  it('interpolation joins string parts', () => {
    expect(read("`/space/${'abc123'}`")).toBe('/space/abc123');
  });

  it('interpolation reads context', () => {
    expect(read('`/space/${space.uuid}`', {}, { space: { uuid: 'xyz' } })).toBe('/space/xyz');
  });

  it('interpolation writes nothing for a missing value', () => {
    expect(read('`hello${missing}world`')).toBe('helloworld');
  });
});

// --- locals ---

describe('local reads', () => {
  it('returns a reactive accessor for a declared field', () => {
    const context = { $local: { name: markReactive(() => 'hello') } };
    const result = resolveProp({ $: 'local.name' }, {}, context, (fn) => fn);
    expect(typeof result).toBe('function');
    expect(unwrap(result)).toBe('hello');
    expect(REACTIVE_ACCESSOR in (result as object)).toBe(true);
  });

  it('reads nothing for an undeclared field', () => {
    const context = { $local: { name: markReactive(() => '') } };
    expect(read('local.missing', {}, context)).toBeUndefined();
    expect(read('local.missing', {}, {})).toBeUndefined();
  });

  it('reads into an object-typed field', () => {
    const context = { $local: { location: markReactive(() => ({ city: 'Lisbon' })) } };
    expect(read('local.location.city', {}, context)).toBe('Lisbon');
  });
});

describe('$setLocal resolver', () => {
  it('creates an event handler that sets what the expression computes when it fires', () => {
    const setter = vi.fn();
    const context = { $localSetters: { name: setter } };
    const handler = resolveSetLocalProp(
      { $setLocal: 'name', value: { $: 'event.target.value' } },
      context,
      {},
      resolveProp,
    );
    expect(typeof handler).toBe('function');
    handler({ target: { value: 'hello' } });
    expect(setter).toHaveBeenCalledWith('hello');
  });

  it('sets a literal value', () => {
    const setter = vi.fn();
    const handler = resolveSetLocalProp({ $setLocal: 'name', value: 'fixed' }, { $localSetters: { name: setter } });
    handler({ target: { value: 'ignored' } });
    expect(setter).toHaveBeenCalledWith('fixed');
  });

  it('merges fields into an object-typed field', () => {
    const setter = vi.fn();
    const context = {
      $local: { location: markReactive(() => ({ city: 'Lisbon', country: 'PT' })) },
      $localSetters: { location: setter },
    };
    const handler = resolveSetLocalProp(
      { $setLocal: 'location', merge: { city: { $: 'event.detail' } } },
      context,
      {},
      resolveProp,
    );
    handler({ detail: 'Porto' });
    expect(setter).toHaveBeenCalledWith({ city: 'Porto', country: 'PT' });
  });

  it('returns noop and warns when no $localSetters in context', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = resolveSetLocalProp({ $setLocal: 'name', value: { $: 'event' } }, {});
    expect(typeof handler).toBe('function');
    handler('anything'); // should not throw
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no $localState'));
    spy.mockRestore();
  });

  it('returns noop and warns for undeclared setter', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { $localSetters: { name: vi.fn() } };
    const handler = resolveSetLocalProp({ $setLocal: 'missing', value: { $: 'event' } }, context);
    handler('anything');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not declared'));
    spy.mockRestore();
  });
});

describe('locals via dispatcher', () => {
  it('resolveProp reads a local', () => {
    const context = { $local: { field: markReactive(() => 'test') } };
    expect(read('local.field', {}, context)).toBe('test');
  });

  it('resolveProp dispatches $setLocal tokens', () => {
    const setter = vi.fn();
    const context = { $localSetters: { field: setter } };
    const handler = resolveProp({ $setLocal: 'field', value: { $: 'event.detail' } }, {}, context) as (
      e: unknown,
    ) => void;
    handler({ detail: 'value' });
    expect(setter).toHaveBeenCalledWith('value');
  });

  it('resolveProp dispatches $toggleLocal tokens', () => {
    const setter = vi.fn();
    const context = { $local: { open: markReactive(() => false) }, $localSetters: { open: setter } };
    const handler = resolveProp({ $toggleLocal: 'open' }, {}, context) as () => void;
    handler();
    expect(setter).toHaveBeenCalledWith(true);
  });
});

describe('$action arg unwrapping', () => {
  it('unwraps REACTIVE_ACCESSOR args at execution time', () => {
    const method = vi.fn();
    const stores = { myStore: { method } };

    let value = 'initial';
    const accessor = markReactive(() => value);

    const context = { $local: { name: accessor } };
    const action = { $action: 'myStore.method', args: [{ $: 'local.name' }] };
    // A render-time memo hands the handler an accessor, read when the handler fires.
    const fn = resolveProp(action, stores, context, ((fn: () => unknown) => fn) as <T>(fn: () => T) => T) as () => void;

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

// --- Validation state ---

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

describe('error()', () => {
  it('returns empty string when not touched', () => {
    const meta = createMockMeta({ errors: () => ['Required'], touched: () => false });
    expect(read("error('name')", {}, { $localMeta: { name: meta } })).toBe('');
  });

  it('returns first error when touched', () => {
    const meta = createMockMeta({ errors: () => ['Required', 'Too short'], touched: () => true });
    expect(read("error('name')", {}, { $localMeta: { name: meta } })).toBe('Required');
  });

  it('returns empty string when touched but no errors', () => {
    const meta = createMockMeta({ errors: () => [], touched: () => true });
    expect(read("error('name')", {}, { $localMeta: { name: meta } })).toBe('');
  });

  it('returns empty string for an unknown field', () => {
    expect(read("error('missing')", {}, { $localMeta: {} })).toBe('');
  });
});

describe('valid()', () => {
  it('returns true when no errors', () => {
    const meta = createMockMeta({ errors: () => [] });
    expect(read("valid('name')", {}, { $localMeta: { name: meta } })).toBe(true);
  });

  it('returns false when there are errors (ignores touched)', () => {
    const meta = createMockMeta({ errors: () => ['Required'], touched: () => false });
    expect(read("valid('name')", {}, { $localMeta: { name: meta } })).toBe(false);
  });

  it('returns true for an unknown field', () => {
    expect(read("valid('missing')", {}, { $localMeta: {} })).toBe(true);
  });
});

describe('touched()', () => {
  it('reads the touched flag', () => {
    expect(read("touched('name')", {}, { $localMeta: { name: createMockMeta({ touched: () => false }) } })).toBe(false);
    expect(read("touched('name')", {}, { $localMeta: { name: createMockMeta({ touched: () => true }) } })).toBe(true);
  });
});

describe('formValid()', () => {
  it('returns true when all scoped fields are valid', () => {
    const context = {
      $localMeta: { name: createMockMeta(), email: createMockMeta() },
      $localScopeFields: ['name', 'email'],
    };
    expect(read('formValid()', {}, context)).toBe(true);
  });

  it('returns false when any scoped field has errors', () => {
    const context = {
      $localMeta: { name: createMockMeta(), email: createMockMeta({ errors: () => ['Required'] }) },
      $localScopeFields: ['name', 'email'],
    };
    expect(read('formValid()', {}, context)).toBe(false);
  });

  it('ignores fields not in scope', () => {
    const context = {
      $localMeta: { name: createMockMeta(), email: createMockMeta({ errors: () => ['Required'] }) },
      $localScopeFields: ['name'], // email not in scope
    };
    expect(read('formValid()', {}, context)).toBe(true);
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
    const context = {
      $localMeta: {
        name: createMockMeta({ setTouched: setTouched1 }),
        email: createMockMeta({ setTouched: setTouched2 }),
      },
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
    const context = {
      $localMeta: {
        parentField: createMockMeta({ setTouched: parentTouch }),
        childField: createMockMeta({ setTouched: childTouch }),
      },
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
    const context = {
      $localMeta: { name: createMockMeta({ reset: reset1 }), email: createMockMeta({ reset: reset2 }) },
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
    const context = {
      $localMeta: {
        parentField: createMockMeta({ reset: parentReset }),
        childField: createMockMeta({ reset: childReset }),
      },
      $localScopeFields: ['childField'],
    };
    const handler = resolveResetLocalProp(context);
    handler();
    expect(childReset).toHaveBeenCalled();
    expect(parentReset).not.toHaveBeenCalled();
  });
});

describe('dispatcher integration — validation tokens', () => {
  it('resolves $touch through dispatcher', () => {
    const setTouched = vi.fn();
    const context = { $localMeta: { name: createMockMeta({ setTouched }) }, $localScopeFields: ['name'] };
    const handler = resolveProp({ $touch: 'name' }, {}, context) as () => void;
    handler();
    expect(setTouched).toHaveBeenCalledWith(true);
  });

  it('resolves $resetLocal through dispatcher', () => {
    const reset = vi.fn();
    const context = { $localMeta: { name: createMockMeta({ reset }) }, $localScopeFields: ['name'] };
    const handler = resolveProp({ $resetLocal: '$scope' }, {}, context) as () => void;
    handler();
    expect(reset).toHaveBeenCalled();
  });

  it('a submit guard composes touch, formValid() and the action', () => {
    const setTouched = vi.fn();
    const submit = vi.fn();
    const context = {
      $localMeta: { name: createMockMeta({ setTouched, errors: () => ['Required'] }) },
      $localScopeFields: ['name'],
    };
    const handler = resolveProp(
      { onClick: [{ $touch: '$all' }, { $if: { condition: { $: 'formValid()' }, then: { $action: 's.submit' } } }] },
      { s: { submit } },
      context,
    ) as { onClick: () => void };
    handler.onClick();
    expect(setTouched).toHaveBeenCalledWith(true);
    expect(submit).not.toHaveBeenCalled();
  });
});
