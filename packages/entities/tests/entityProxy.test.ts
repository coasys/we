/**
 * The proxy is the seam every entity call passes through, so its behaviour is pinned here rather
 * than discovered in a browser: forwarding, instance passthrough, late registration, and — most
 * importantly — what happens when nothing is registered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defineEntity } from '../src/entityProxy';
import { type EntityClass, registerEntity, unregisterEntity } from '../src/entityRegistry';

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
  unregisterEntity('Space');
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
    registerEntity('GlobalCheck', Impl as unknown as EntityClass);

    const globals = globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>;
    const shared = globals[Symbol.for('we.models.registry')];
    expect(shared, 'registry must be reachable via Symbol.for, independent of module instance').toBeDefined();
    expect(shared!.GlobalCheck).toBe(Impl);

    unregisterEntity('GlobalCheck');
  });
});

describe('defineEntity', () => {
  it('forwards statics to whichever implementation is registered', async () => {
    registerEntity('Space', FakeSpace as unknown as EntityClass);

    expect(await Space.findAll()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(FakeSpace.findAll).toHaveBeenCalledOnce();
    expect(Space.tag).toBe('ad4m');
  });

  it('returns the implementation’s own instances, methods intact', async () => {
    registerEntity('Space', FakeSpace as unknown as EntityClass);

    const created = await Space.create(null, { name: 'Test' });
    expect(created).toEqual({ id: 'new', name: 'Test' });

    // `new` forwards too, and the instance is the implementation's — not a proxy of one.
    const instance = new Space();
    expect(instance).toBeInstanceOf(FakeSpace);
    await instance.save();
    expect(instance.saved).toBe(true);
  });

  it('resolves per call, so a later registration wins (a backend connecting after import)', async () => {
    registerEntity('Space', FakeSpace as unknown as EntityClass);
    expect(Space.tag).toBe('ad4m');

    class OtherBackendSpace {
      static tag = 'other';
      static findAll = vi.fn(async () => []);
    }
    registerEntity('Space', OtherBackendSpace as unknown as EntityClass);

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

/**
 * What `this` is inside a static reached through the stand-in — and why it must not be consulted.
 *
 * The proxy's own docblock says it: operations forward, identity does not. `Reflect.get` is given the
 * *receiver*, so a static invoked as `CollectionBlock.setRelation(…)` runs with `this` bound to the
 * stand-in rather than to the implementation class. Anything keyed off the class object — a
 * `WeakMap`, memoised SHACL, AD4M's decorator metadata — therefore misses.
 *
 * This is not hypothetical. The AD4M relation writes were written to check `getModelMetadata()`
 * before writing, and shipped refusing every board write: `CollectionBlock` reported that it declared
 * `comments, signals, participants, calls, mentions` — `WeNode`'s relations, every one — because the
 * lookup missed the stand-in, walked up, and answered for the base class. Nothing in the types said
 * so, both backends' own unit tests passed, and it took a real drag on a real board to see it.
 *
 * So the property is pinned here, at the seam, where it is one assertion instead of a debugging
 * session in whichever backend next reaches for class-level metadata.
 */
describe('what a static sees as `this`', () => {
  it('binds `this` to the stand-in, not to the registered class', async () => {
    const seen: unknown[] = [];
    class Impl {
      static marker = 'impl';
      static probe(this: unknown) {
        seen.push(this);
      }
    }
    registerEntity('Space', Impl as unknown as EntityClass);

    (Space as unknown as { probe: () => void }).probe();

    // The call works — operations forward — but what arrived is the proxy.
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(Impl);
  });

  it('misses class-keyed metadata, which is why a backend must read the record instead', async () => {
    // A registry keyed by the class object — the shape of every metadata store this trap applies to.
    const metadata = new WeakMap<object, string[]>();
    class Impl {
      static relationsOf(this: object): string[] {
        return metadata.get(this) ?? [];
      }
      static accessorsOn() {
        return ['setChildren', 'setArranges'];
      }
    }
    metadata.set(Impl, ['children', 'arranges']);
    registerEntity('Space', Impl as unknown as EntityClass);

    // Asked through the stand-in, the class does not know its own relations.
    expect((Space as unknown as { relationsOf: () => string[] }).relationsOf()).toEqual([]);
    // Asked directly, it does — so the answer depends on how it was reached, which is the trap.
    expect(Impl.relationsOf()).toEqual(['children', 'arranges']);
    // Anything that does not key off the class object is unaffected, which is the way out.
    expect((Space as unknown as { accessorsOn: () => string[] }).accessorsOn()).toEqual(['setChildren', 'setArranges']);
  });
});
