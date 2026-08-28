import { describe, expect, it, vi } from 'vitest';

import { createRegistry } from '../src/shared/registries/createRegistry';

describe('createRegistry', () => {
  it('replaces by id and orders by order then id, never by registration', () => {
    const registry = createRegistry<{ id: string; order?: number; value: string }>();
    registry.register({ id: 'b', value: 'first' });
    registry.register({ id: 'a', value: 'second' });
    registry.register({ id: 'c', order: -1, value: 'third' });
    registry.register({ id: 'b', value: 'replaced' });

    expect(registry.ordered().map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(registry.get('b')?.value).toBe('replaced');
    expect(registry.all()).toHaveLength(3);
  });

  it('announces on register, remove and clear, and stays quiet when nothing changed', () => {
    const registry = createRegistry<{ id: string }>();
    const listener = vi.fn();
    const stop = registry.subscribe(listener);

    registry.register({ id: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.remove('never')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.remove('x')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    registry.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    registry.register({ id: 'y' });
    registry.clear();
    expect(listener).toHaveBeenCalledTimes(4);

    stop();
    registry.register({ id: 'z' });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('lets a side table announce through the same channel', () => {
    const registry = createRegistry<{ id: string }>();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.announce();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('takes a comparator', () => {
    const registry = createRegistry<{ id: string; rank: number }>({ compare: (a, b) => b.rank - a.rank });
    registry.register({ id: 'low', rank: 1 });
    registry.register({ id: 'high', rank: 9 });
    expect(registry.ordered().map((entry) => entry.id)).toEqual(['high', 'low']);
  });
});
