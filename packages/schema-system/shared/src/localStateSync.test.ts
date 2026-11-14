import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localWriteMirror } from './localStateSync';

describe('localWriteMirror', () => {
  const g = globalThis as { localStorage?: unknown };
  let had: boolean;
  beforeEach(() => {
    had = 'localStorage' in g;
    if (!had) g.localStorage = {};
  });
  afterEach(() => {
    if (!had) delete g.localStorage;
  });

  it('skips the persist mirror for a value JSON cannot encode, and does not throw', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const mirror = localWriteMirror({ type: 'object', persist: 'filters' }, cyclic, {});
    expect(mirror.store).toBeUndefined();
  });

  it('persists an encodable value', () => {
    const mirror = localWriteMirror({ type: 'object', persist: 'filters' }, { a: 1 }, {});
    expect(mirror.store).toEqual({ key: 'we-local:filters', json: '{"a":1}' });
  });
});
