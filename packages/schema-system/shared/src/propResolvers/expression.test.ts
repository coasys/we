import { describe, expect, it } from 'vitest';

import { resolveProp } from './dispatcher';
import { isDeferredArg } from './expression';
import { markReactive, REACTIVE_ACCESSOR } from './reactive';
import { noMemo } from './types';

const unwrap = (value: unknown): unknown =>
  typeof value === 'function' && REACTIVE_ACCESSOR in value ? (value as unknown as () => unknown)() : value;

const stores = {
  spaceStore: {
    members: markReactive(() => [
      { did: 'a', role: 'admin' },
      { did: 'b', role: 'member' },
    ]),
    currentSpace: markReactive(() => ({ name: 'Garden' })),
    logout: () => 'CALLED',
  },
  modules: { notes: { open: markReactive(() => true) } },
  $me: () => ({ did: 'me' }),
  $sources: { double: (options: unknown) => (options as { n: number }).n * 2 },
};

const context = {
  item: { role: 'admin', did: 'a' },
  $local: { search: markReactive(() => 'gar'), page: markReactive(() => 2) },
};

const run = (source: string, ctx: Record<string, unknown> = context) =>
  unwrap(resolveProp({ $: source }, stores, ctx, noMemo));

describe('{ $: … } through the dispatcher', () => {
  it('reads stores by the tagging rule, locals, context, globals and modules', () => {
    expect(run("filter(spaceStore.members, { role: 'admin' }).count()")).toBe(1);
    expect(run('spaceStore.currentSpace.name')).toBe('Garden');
    expect(run('spaceStore.logout')).toBeUndefined();
    expect(run('spaceStore')).toBeUndefined();
    expect(run('contains(spaceStore.currentSpace.name, local.search)')).toBe(true);
    expect(run('local.page + 1')).toBe(3);
    expect(run("item.did == me.did ? 'mine' : 'theirs'")).toBe('theirs');
    expect(run('modules.notes.open')).toBe(true);
    expect(run('modules.missing.open')).toBeUndefined();
  });

  it('calls host sources after the built-ins', () => {
    expect(run('double({ n: 4 })')).toBe(8);
    expect(run('nonexistent(1)')).toBeUndefined();
  });

  it('defers an expression about the callback argument until it fires', () => {
    const deferred = resolveProp({ $: 'event.detail.value' }, stores, context, noMemo);
    expect(isDeferredArg(deferred)).toBe(true);
    expect((deferred as (arg: unknown) => unknown)({ detail: { value: 'x' } })).toBe('x');
  });

  it('evaluates the same expression at once when the event is already in context', () => {
    expect(run('event.detail.value', { ...context, event: { detail: { value: 'y' } } })).toBe('y');
    expect(run("arg.detail.value == 'y'", { ...context, event: { detail: { value: 'y' } } })).toBe(true);
  });

  it('feeds a deferred argument to an $action with the callback argument', () => {
    const calls: unknown[][] = [];
    const bag = { ...stores, routeStore: { navigate: (...args: unknown[]) => calls.push(args) } };
    const handler = resolveProp(
      { $action: 'routeStore.navigate', args: [{ $: '`/space/${event.detail.uuid}`' }] },
      bag,
      context,
      noMemo,
    ) as (event: unknown) => void;
    handler({ detail: { uuid: 'abc' } });
    expect(calls).toEqual([['/space/abc']]);
  });

  it('sets a local from an expression evaluated when the handler fires', () => {
    let written: unknown;
    const ctx = { ...context, $localSetters: { page: (value: unknown) => (written = value) } };
    const handler = resolveProp(
      { $setLocal: 'page', value: { $: 'local.page + event.step' } },
      stores,
      ctx,
      noMemo,
    ) as (event: unknown) => void;
    handler({ step: 5 });
    expect(written).toBe(7);
  });

  it('resolves a parse error to nothing rather than throwing', () => {
    expect(run('local.page +')).toBeUndefined();
  });
});

describe('functions a callback hands over', () => {
  it("lets a callback argument's function through, bound to its object, so a function-typed local can hold it", () => {
    let written: unknown;
    const ctx = { ...context, $localSetters: { savePost: (value: unknown) => (written = value) } };
    const handler = resolveProp({ $setLocal: 'savePost', value: { $: 'event.save' } }, stores, ctx, noMemo) as (
      event: unknown,
    ) => void;
    const api = {
      count: 0,
      save() {
        this.count += 1;
        return 'saved';
      },
    };
    handler(api);
    expect(typeof written).toBe('function');
    expect((written as () => unknown)()).toBe('saved');
    expect(api.count).toBe(1);
  });

  it('still hands the whole argument on, and reads its data as before', () => {
    const handler = resolveProp({ $: 'arg' }, stores, context, noMemo) as (arg: unknown) => unknown;
    const event = { detail: { value: 'x' }, save: () => 1 };
    expect(handler(event)).toBe(event);
    const detail = resolveProp({ $: 'arg.detail.value' }, stores, context, noMemo) as (a: unknown) => unknown;
    expect(detail(event)).toBe('x');
  });

  it('keeps refusing functions found anywhere else', () => {
    expect(run('spaceStore.logout')).toBeUndefined();
    expect(run('item.fn', { ...context, item: { fn: () => 1 } })).toBeUndefined();
  });
});
