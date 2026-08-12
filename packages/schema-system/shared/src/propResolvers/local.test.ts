import { describe, expect, it } from 'vitest';

import type { Props } from '../types';
import { resolveSetLocalProp } from './local';

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
