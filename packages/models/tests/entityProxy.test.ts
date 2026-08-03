/**
 * The proxy is the seam every entity call passes through, so its behaviour is pinned here rather
 * than discovered in a browser: forwarding, instance passthrough, late registration, and — most
 * importantly — what happens when nothing is registered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineEntity } from '../src/entityProxy';
import { type ModelClass, registerModel, unregisterModel } from '../src/modelRegistry';

class FakeSpace {
  static findAll = vi.fn(async () => [{ id: 'a' }, { id: 'b' }]);
  static create = vi.fn(async (_dataset: unknown, data: Record<string, unknown>) => ({ id: 'new', ...data }));
  static tag = 'ad4m';

  saved = false;
  async save() {
    this.saved = true;
  }
}

const Space = defineEntity('Space') as unknown as typeof FakeSpace;

beforeEach(() => {
  unregisterModel('Space');
  FakeSpace.findAll.mockClear();
  FakeSpace.create.mockClear();
});

describe('registry ownership (the bundling trap)', () => {
  it('keys state globally, so duplicate module instances still share one registry', async () => {
    // This package ships two entries: the root (stand-ins, which read) and /classes (the
    // implementations, which a backend registers). A bundler that gives each its own module scope
    // silently splits the registry in two — everything registers, every lookup fails, and the
    // symptom looks like missing data rather than a build setting. Source-level tests import one
    // copy and cannot see that, so this asserts the property that makes it impossible: the state
    // hangs off a well-known global, not module scope.
    class Impl {
      static tag = 'impl';
    }
    registerModel('GlobalCheck', Impl as unknown as ModelClass);

    const globals = globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>;
    const shared = globals[Symbol.for('we.models.registry')];
    expect(shared, 'registry must be reachable via Symbol.for, independent of module instance').toBeDefined();
    expect(shared!.GlobalCheck).toBe(Impl);

    unregisterModel('GlobalCheck');
  });
});

describe('defineEntity', () => {
  it('forwards statics to whichever implementation is registered', async () => {
    registerModel('Space', FakeSpace as unknown as ModelClass);

    expect(await Space.findAll()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(FakeSpace.findAll).toHaveBeenCalledOnce();
    expect(Space.tag).toBe('ad4m');
  });

  it('returns the implementation’s own instances, methods intact', async () => {
    registerModel('Space', FakeSpace as unknown as ModelClass);

    const created = await Space.create(null, { name: 'Test' });
    expect(created).toEqual({ id: 'new', name: 'Test' });

    // `new` forwards too, and the instance is the implementation's — not a proxy of one.
    const instance = new Space();
    expect(instance).toBeInstanceOf(FakeSpace);
    await instance.save();
    expect(instance.saved).toBe(true);
  });

  it('resolves per call, so a later registration wins (a backend connecting after import)', async () => {
    registerModel('Space', FakeSpace as unknown as ModelClass);
    expect(Space.tag).toBe('ad4m');

    class OtherBackendSpace {
      static tag = 'other';
      static findAll = vi.fn(async () => []);
    }
    registerModel('Space', OtherBackendSpace as unknown as ModelClass);

    expect(Space.tag).toBe('other');
    expect(await Space.findAll()).toEqual([]);
    expect(FakeSpace.findAll).not.toHaveBeenCalled();
  });

  it('throws a message that names the entity and the likely cause when nothing is registered', () => {
    // Silence here would be the failure mode this whole contract exists to prevent: a seam that
    // resolves to nothing and breaks somewhere unrelated.
    expect(() => Space.findAll()).toThrowError(/Entity "Space" has no implementation registered/);
    expect(() => Space.findAll()).toThrowError(/BackendConnector\.initialize/);
  });
});
