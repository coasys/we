import { describe, expect, it } from 'vitest';

import { resolveProp } from './dispatcher';
import { resolveSetLocalProp, resolveToggleLocalInProp } from './local';
import type { Props } from './types';

/** A `$localState` scope holding one field, with the accessor/setter pair the resolver reads. */
function scope(field: string, initial: unknown): { context: Props; read: () => unknown } {
  let current = initial;
  const context = {
    $local: { [field]: () => current },
    $localSetters: { [field]: (v: unknown) => (current = v) },
  } as unknown as Props;
  return { context, read: () => current };
}

describe('resolveSetLocalProp — the `by` form', () => {
  it('adds to the current value', () => {
    const { context, read } = scope('pageSize', 30);
    resolveSetLocalProp({ $setLocal: 'pageSize', by: 30 }, context)(undefined);
    expect(read()).toBe(60);
  });

  it('accumulates across presses, so a list can page past its second page', () => {
    const { context, read } = scope('pageSize', 20);
    const bump = resolveSetLocalProp({ $setLocal: 'pageSize', by: 20 }, context);
    bump(undefined);
    bump(undefined);
    bump(undefined);
    expect(read()).toBe(80);
  });

  it('subtracts on a negative step', () => {
    const { context, read } = scope('count', 10);
    resolveSetLocalProp({ $setLocal: 'count', by: -3 }, context)(undefined);
    expect(read()).toBe(7);
  });

  it('treats a non-numeric current value as 0 rather than producing NaN', () => {
    // NaN would flow into a query `limit` and empty the list, with nothing to point at.
    const { context, read } = scope('pageSize', undefined);
    resolveSetLocalProp({ $setLocal: 'pageSize', by: 25 }, context)(undefined);
    expect(read()).toBe(25);
  });

  it('does not disturb the other forms', () => {
    const { context, read } = scope('name', '');
    resolveSetLocalProp({ $setLocal: 'name', value: 'literal' }, context)(undefined);
    expect(read()).toBe('literal');
    resolveSetLocalProp({ $setLocal: 'name', from: '$event.detail' }, context)({ detail: 'from-event' });
    expect(read()).toBe('from-event');
  });
});

describe('resolveToggleLocalInProp', () => {
  const toggle = (field: string, value: unknown, context: Props) =>
    resolveToggleLocalInProp({ $toggleLocalIn: field, value }, {} as Props, context, resolveProp);

  it('adds a value that is not there and removes one that is', () => {
    const { context, read } = scope('collapsed', []);
    toggle('collapsed', 'spaces', context)();
    expect(read()).toEqual(['spaces']);
    toggle('collapsed', 'apps', context)();
    expect(read()).toEqual(['spaces', 'apps']);
    toggle('collapsed', 'spaces', context)();
    expect(read()).toEqual(['apps']);
  });

  it('resolves the value through the prop pipeline, so a context ref names the current row', () => {
    const { context, read } = scope('collapsed', []);
    // What a $each row does: the id is only knowable per iteration, which is the whole reason
    // this token exists rather than a boolean per group.
    const rowContext = { ...context, group: { id: 'group-7' } } as unknown as Props;
    toggle('collapsed', '$group.id', rowContext)();
    expect(read()).toEqual(['group-7']);
  });

  it('starts a fresh set when the field is empty rather than throwing', () => {
    const { context, read } = scope('collapsed', undefined);
    toggle('collapsed', 'a', context)();
    expect(read()).toEqual(['a']);
  });

  it('refuses to overwrite a field holding something that is not a set', () => {
    // Silently replacing it would leave every `$local` read of it answering a different question.
    const { context, read } = scope('collapsed', true);
    toggle('collapsed', 'a', context)();
    expect(read()).toBe(true);
  });

  it('no-ops on an undeclared field instead of throwing', () => {
    const { context, read } = scope('collapsed', []);
    toggle('somethingElse', 'a', context)();
    expect(read()).toEqual([]);
  });
});
