/**
 * Registration is one `registerShapes` call per model set.
 *
 * The executor compares each shape with the one it stores and writes only a changed one, so WE does
 * not read the stored shapes first, does not wait after the write, and does not write hints again
 * after it. The one read left is the tuned-hints marker: a space with no marked shape costs one link
 * query and the call.
 */
import { SHACLShape } from '@coasys/ad4m';
import {
  classNameOf,
  installModuleSdna,
  installSpaceSdna,
  isEntityRegistered,
  refreshSpaceSdna,
  SPACE_MODELS,
} from '@we/backend-ad4m';
import { describe, expect, it } from 'vitest';

import { Space, TaskBlock } from '../src/entities';
import { fakeShapeRegistry } from './fakeShapeRegistry';

/** The class names WE's space models register under. A built-in class is the executor's to register. */
const spaceNames = () =>
  SPACE_MODELS.filter((model) => !Object.prototype.hasOwnProperty.call(model, 'builtinUri')).map((model) => {
    const { shape } = model.generateSHACL() as { shape: SHACLShape };
    return classNameOf(shape.targetClass!);
  });

describe('installing a space', () => {
  it("registers WE's models in one call", async () => {
    const r = fakeShapeRegistry();

    await installSpaceSdna(r.proxy);

    expect(r.calls.registerShapes).toEqual([spaceNames()]);
  });

  it('does not read the stored shapes when no shape is marked tuned', async () => {
    const r = fakeShapeRegistry();

    await installSpaceSdna(r.proxy);
    await refreshSpaceSdna(r.proxy);

    expect(r.calls.shapes).toEqual([]);
  });

  it("registers module models in a call of their own, after WE's", async () => {
    // `registerShapes` refuses a whole call that names one class twice. A module that declares a
    // class WE has must not stop WE's own models from registering.
    const r = fakeShapeRegistry();

    await installSpaceSdna(r.proxy, [TaskBlock]);

    expect(r.calls.registerShapes).toHaveLength(2);
    expect(r.calls.registerShapes[1]).toEqual(['TaskBlock']);
  });

  it('makes no call for an empty module list', async () => {
    const r = fakeShapeRegistry();

    await installModuleSdna(r.proxy, []);

    expect(r.calls.registerShapes).toEqual([]);
  });
});

describe('refreshing a space', () => {
  it('writes nothing when every shape is current', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy);

    expect(await refreshSpaceSdna(r.proxy)).toEqual([]);
  });

  it('writes, and names, only the class this build changed', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy);
    // The stored Space shape from an older build: one property fewer.
    const older = r.registry.get('Space')!;
    older.properties = older.properties.slice(1);

    expect(await refreshSpaceSdna(r.proxy)).toEqual(['Space']);
    expect(await refreshSpaceSdna(r.proxy)).toEqual([]);
  });
});

describe('isEntityRegistered', () => {
  it('is false before the class is registered, and true after', async () => {
    const r = fakeShapeRegistry();

    expect(await isEntityRegistered(r.proxy, Space)).toBe(false);
    await installSpaceSdna(r.proxy);
    expect(await isEntityRegistered(r.proxy, Space)).toBe(true);
  });

  it('asks the registry for the one class name', async () => {
    const r = fakeShapeRegistry();

    await isEntityRegistered(r.proxy, Space);

    expect(r.calls.shapes).toEqual([['Space']]);
  });

  it("is false when another app's class holds the name", async () => {
    // Two apps can each have a class called Space. Only WE's target class answers yes.
    const r = fakeShapeRegistry();
    const theirs = SHACLShape.fromJSON((Space.generateSHACL() as { shape: SHACLShape }).shape.toJSON());
    theirs.targetClass = 'other-app://Space';
    r.registry.set('Space', theirs);

    expect(await isEntityRegistered(r.proxy, Space)).toBe(false);
  });
});
