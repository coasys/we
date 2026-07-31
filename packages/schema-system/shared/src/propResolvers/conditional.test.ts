import { describe, expect, it } from 'vitest';

import { resolveProp } from './dispatcher';
import { REACTIVE_ACCESSOR } from './reactive';
import type { Memo } from './types';

/**
 * A non-caching stand-in for the framework's memo: it hands back the thunk itself, so a
 * test can invoke it repeatedly and observe what the resolver re-reads on each pass.
 * Solid's createMemo would cache, hiding exactly the staleness these tests are about.
 */
const rerunMemo = ((fn: () => unknown) => fn) as unknown as Memo;

function accessor(resolved: unknown): () => unknown {
  expect(typeof resolved).toBe('function');
  expect(REACTIVE_ACCESSOR in (resolved as object)).toBe(true);
  return resolved as () => unknown;
}

describe('$if prop resolution — re-reads the schema', () => {
  // The visual editor renders from a reactive store, so an edit to a $if mutates the
  // token in place. Anything the resolver destructures once is invisible to that edit:
  // the branch kept rendering its old value until the subtree remounted.
  it('picks up an edited `then` branch', () => {
    const token = { $if: { condition: true, then: 'Shared', else: 'Personal' } };
    const read = accessor(resolveProp(token, {}, {}, rerunMemo));
    expect(read()).toBe('Shared');

    token.$if.then = 'Public';
    expect(read()).toBe('Public');
  });

  it('picks up an edited `else` branch', () => {
    const token = { $if: { condition: false, then: 'Shared', else: 'Personal' } };
    const read = accessor(resolveProp(token, {}, {}, rerunMemo));
    expect(read()).toBe('Personal');

    token.$if.else = 'Private';
    expect(read()).toBe('Private');
  });

  it('picks up an edited condition', () => {
    const token: { $if: { condition: unknown; then: string; else: string } } = {
      $if: { condition: false, then: 'Shared', else: 'Personal' },
    };
    const read = accessor(resolveProp(token, {}, {}, rerunMemo));
    expect(read()).toBe('Personal');

    token.$if.condition = true;
    expect(read()).toBe('Shared');
  });

  it('picks up a condition swapped for a different operator shape', () => {
    const stores = { spaceStore: { access: 'shared' } };
    const token: { $if: { condition: unknown; then: string; else: string } } = {
      $if: { condition: { $eq: [{ $store: 'spaceStore.access' }, 'shared'] }, then: 'Shared', else: 'Personal' },
    };
    const read = accessor(resolveProp(token, stores, {}, rerunMemo));
    expect(read()).toBe('Shared');

    token.$if.condition = { $eq: [{ $store: 'spaceStore.access' }, 'personal'] };
    expect(read()).toBe('Personal');
  });

  it('still resolves store-backed conditions', () => {
    const stores = { spaceStore: { access: 'personal' } };
    const token = {
      $if: { condition: { $eq: [{ $store: 'spaceStore.access' }, 'shared'] }, then: 'Shared', else: 'Personal' },
    };
    expect(accessor(resolveProp(token, stores, {}, rerunMemo))()).toBe('Personal');
  });

  it('resolves branches that are themselves tokens', () => {
    const stores = { spaceStore: { name: 'Home' } };
    const token = { $if: { condition: true, then: { $store: 'spaceStore.name' }, else: 'none' } };
    expect(accessor(resolveProp(token, stores, {}, rerunMemo))()).toBe('Home');
  });
});

describe('$if with $arg — evaluated per call', () => {
  it('reads the branch at call time', () => {
    const calls: string[] = [];
    const stores = { s: { hit: (v: string) => calls.push(v) } };
    const token = {
      $if: {
        condition: { $eq: ['$arg.kind', 'a'] },
        then: { $action: 's.hit', args: ['then-branch'] },
        else: { $action: 's.hit', args: ['else-branch'] },
      },
    };
    const handler = resolveProp(token, stores, {}, rerunMemo) as (arg: unknown) => void;

    handler({ kind: 'a' });
    expect(calls).toEqual(['then-branch']);

    // Editing the branch must affect the next invocation, not just the next mount.
    token.$if.then = { $action: 's.hit', args: ['edited'] };
    handler({ kind: 'a' });
    expect(calls).toEqual(['then-branch', 'edited']);

    handler({ kind: 'b' });
    expect(calls).toEqual(['then-branch', 'edited', 'else-branch']);
  });
});
