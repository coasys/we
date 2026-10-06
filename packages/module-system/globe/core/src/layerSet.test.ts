/**
 * The rules a globe keeps its layers by, on any engine: only a layer whose own options changed hears
 * about it, handlers never go stale, and everything a layer added is undone when it goes.
 */
import type { LayerConfig, LayerKind, LayerKinds, RendererContext } from '@we/globe-protocol';
import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './events';
import { LayerSet, optionsEqual } from './layerSet';

type Log = { mounts: string[]; updates: string[]; cleanups: string[] };

function fakeKind(
  id: string,
  withUpdate: boolean,
  log: Log,
  slot: 'planet' | 'background' = 'planet',
): LayerKind<unknown> {
  return {
    id,
    slot,
    description: id,
    renderers: {
      cesium: (context: RendererContext) => {
        log.mounts.push(context.id);
        context.onCleanup(() => log.cleanups.push(context.id));
        return withUpdate ? { update: () => void log.updates.push(context.id) } : undefined;
      },
    },
  };
}

function setUp(kinds: LayerKinds) {
  const set = new LayerSet({
    engine: 'cesium',
    kinds: () => kinds,
    context: (shared) => shared,
    events: new EventBus(),
  });
  return set;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a layer set', () => {
  it('mounts what is enabled and leaves the rest', async () => {
    const log: Log = { mounts: [], updates: [], cleanups: [] };
    const set = setUp({ a: fakeKind('a', true, log), b: fakeKind('b', true, log) });
    set.sync([{ factory: 'a' }, { factory: 'b', enabled: false }]);
    await settle();
    expect(log.mounts).toEqual(['a']);
  });

  it('tells only the layer whose own options changed', async () => {
    const log: Log = { mounts: [], updates: [], cleanups: [] };
    const set = setUp({ a: fakeKind('a', true, log), b: fakeKind('b', true, log) });
    set.sync([
      { factory: 'a', options: { size: 1 } },
      { factory: 'b', options: { size: 1 } },
    ]);
    await settle();
    // A new list with the same contents, as every recomputation of a template's list produces.
    set.sync([
      { factory: 'a', options: { size: 1 } },
      { factory: 'b', options: { size: 2 } },
    ]);
    await settle();
    expect(log.updates).toEqual(['b']);
  });

  it('does not count a rebuilt handler as a change, and calls the newest one', async () => {
    const seen: string[] = [];
    let captured: ((value: string) => void) | undefined;
    const kind: LayerKind<{ onSelect: (value: string) => void }> = {
      id: 'a',
      slot: 'planet',
      description: 'a',
      renderers: {
        cesium: (_context, options) => {
          captured = options.onSelect;
          return { update: () => void seen.push('update') };
        },
      },
    };
    const set = setUp({ a: kind });
    set.sync([{ factory: 'a', options: { onSelect: (v: string) => seen.push(`first:${v}`) } }]);
    await settle();
    set.sync([{ factory: 'a', options: { onSelect: (v: string) => seen.push(`second:${v}`) } }]);
    await settle();
    captured?.('x');
    expect(seen).toEqual(['second:x']);
  });

  it('remounts a layer that has no update when its options change', async () => {
    const log: Log = { mounts: [], updates: [], cleanups: [] };
    const set = setUp({ a: fakeKind('a', false, log) });
    set.sync([{ factory: 'a', options: { color: 'red' } }]);
    await settle();
    set.sync([{ factory: 'a', options: { color: 'blue' } }]);
    await settle();
    expect(log.mounts).toEqual(['a', 'a']);
    expect(log.cleanups).toEqual(['a']);
  });

  it('undoes what a layer added when it is turned off', async () => {
    const log: Log = { mounts: [], updates: [], cleanups: [] };
    const set = setUp({ a: fakeKind('a', true, log) });
    set.sync([{ factory: 'a' }]);
    await settle();
    set.sync([{ factory: 'a', enabled: false }]);
    expect(log.cleanups).toEqual(['a']);
    expect(set.keys()).toEqual([]);
  });

  it('cleans up after a renderer that finished mounting after it was turned off', async () => {
    const cleaned = vi.fn();
    let finish: () => void = () => {};
    const kind: LayerKind<unknown> = {
      id: 'slow',
      slot: 'planet',
      description: 'slow',
      renderers: {
        cesium: async (context) => {
          await new Promise<void>((resolve) => (finish = resolve));
          context.onCleanup(cleaned);
        },
      },
    };
    const set = setUp({ slow: kind });
    set.sync([{ factory: 'slow' }]);
    await settle();
    set.sync([]);
    finish();
    await settle();
    expect(cleaned).toHaveBeenCalledOnce();
  });

  it('draws one of two instances that share a key, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log: Log = { mounts: [], updates: [], cleanups: [] };
    const set = setUp({ a: fakeKind('a', true, log) });
    const configs: LayerConfig[] = [{ factory: 'a' }, { factory: 'a' }];
    set.sync(configs);
    set.sync(configs);
    await settle();
    expect(log.mounts).toEqual(['a']);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('share the key'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('skips a kind with no renderer for its engine quietly, and warns of one it does not know', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const log: Log = { mounts: [], updates: [], cleanups: [] };
    const set = setUp({ a: { id: 'a', slot: 'planet', description: 'a', renderers: {} } });
    set.sync([{ factory: 'a' }, { factory: 'missing' }]);
    set.sync([{ factory: 'a' }, { factory: 'missing' }]);
    await settle();
    expect(log.mounts).toEqual([]);
    expect(info).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    info.mockRestore();
  });
});

describe('option equality', () => {
  it('is structural, and treats any two functions as equal', () => {
    expect(optionsEqual({ a: [1, { b: 2 }], f: () => 1 }, { a: [1, { b: 2 }], f: () => 2 })).toBe(true);
    expect(optionsEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(optionsEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
