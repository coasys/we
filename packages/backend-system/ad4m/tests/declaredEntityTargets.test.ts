/**
 * A module entity that extends the core vocabulary keeps the target of what it inherits.
 *
 * `WeNode` carries one typed relation — `signals`, pointing at `Signal` — and a module's manifest
 * holds only its own entities, so that target names a class the manifest cannot see. The compiler
 * resolves such a name through `resolveExternal`, and `declare` used not to pass one: the thunk
 * answered `undefined`, shacl-gen caught the throw and warned, and the emitted shape lost both
 * `sh:class` and `ad4m:targetClassName`.
 *
 * That is not cosmetic and it is not visible either. SHACL is memoised per class, so the shape is
 * permanently short of its target, and the executor — which reads the target class name off the
 * stored shape — then refuses `include: { signals: true }` on that entity, failing the *whole*
 * query rather than the one relation. The polls module's `Poll` shipped straight into it.
 *
 * Tested through the port rather than through `compileManifest`, because the compiler was never
 * the broken half: passing a resolver was always its caller's job, and a unit test that passes one
 * would have gone on succeeding throughout.
 */
import type { SHACLShape } from '@coasys/ad4m';
import type { EntityManifest } from '@we/backend-shared';
import { type EntityClass, registerEntity, unregisterEntity } from '@we/entities';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAd4mSchemaPort } from '../src/backendPortsAdapter';
import { Signal, SignalType } from '../src/entities';

const MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Poll: {
      extends: 'WeNode',
      properties: { question: { type: 'string', required: true, default: '' } },
      relations: {},
    },
  },
};

type Shaped = { generateSHACL: () => { shape: SHACLShape | null } };

describe('a module entity extending WeNode', () => {
  beforeEach(() => {
    // What createBackendPorts does at boot, before any module compiles: the native classes are in
    // the global registry, which is where an inherited relation's target is found.
    registerEntity('Signal', Signal as unknown as EntityClass);
  });

  afterEach(() => {
    unregisterEntity('Poll');
    unregisterEntity('Signal');
  });

  it('resolves the target class of the relation it inherits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const classes = createAd4mSchemaPort({}).declare(MANIFEST, { moduleId: 'polls' });

    const shape = (classes.Poll as Shaped).generateSHACL().shape!;
    const signals = shape.properties.find((p) => p.name === 'signals')!;
    expect(signals.targetClassName).toBe('Signal');
    expect(signals.class).toBe((Signal as unknown as Shaped).generateSHACL().shape!.nodeShapeUri);

    // The warning is the only thing that reported this, so it is worth holding: shacl-gen catches
    // the failed resolution, so nothing else about the compile looks wrong.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('Failed to resolve target class');
    warn.mockRestore();
  });

  it('lets a caller’s own resolver answer first, and falls back to the registry', () => {
    // A resolver that names something else wins — the port adds a fallback, it does not take the
    // decision over. SignalType stands in only because it is a different class with its own name.
    const redirected = createAd4mSchemaPort({}).declare(MANIFEST, {
      moduleId: 'polls',
      resolveExternal: (name) => (name === 'Signal' ? SignalType : undefined),
    });
    const redirectedShape = (redirected.Poll as Shaped).generateSHACL().shape!;
    expect(redirectedShape.properties.find((p) => p.name === 'signals')?.targetClassName).toBe('SignalType');
    unregisterEntity('Poll');

    // One that answers nothing falls through to the registry rather than dropping the target.
    const fellBack = createAd4mSchemaPort({}).declare(MANIFEST, {
      moduleId: 'polls',
      resolveExternal: () => undefined,
    });
    const fallbackShape = (fellBack.Poll as Shaped).generateSHACL().shape!;
    expect(fallbackShape.properties.find((p) => p.name === 'signals')?.targetClassName).toBe('Signal');
  });
});
