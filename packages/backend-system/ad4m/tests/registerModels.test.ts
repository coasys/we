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
  compileManifest,
  installModuleSdna,
  installSpaceSdna,
  isEntityRegistered,
  refreshSpaceSdna,
  SPACE_MODELS,
} from '@we/backend-ad4m';
import { ModuleSchemasRefused } from '@we/backend-shared';
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

describe('classNameOf', () => {
  // Each expected value is what the executor's `class_name_of` answers for the same input
  // (ad4m's rust-executor/src/perspectives/shacl_parser.rs, at the pinned commit 99fe1354d): the
  // name `shapes(names)` selects by, so a WE name that differs looks up a class never stored.
  it.each([
    ['urn:isbn:Book', 'Book'],
    ['a://Note', 'Note'],
    ['http://x.org/ns#Thing', 'Thing'],
    ['a://b/c/Thing', 'Thing'],
    ['recipe://Recipe', 'Recipe'],
    ['http://x.org/ns#a/b', 'b'],
    ['a://b/c:d', 'd'],
    ['ad4m://FlowInstance', 'FlowInstance'],
    ['a://b/', 'unknown'],
    ['x#', 'unknown'],
    ['simple', 'simple'],
    ['', 'unknown'],
  ])('names %j as the executor does: %j', (targetClass, name) => {
    expect(classNameOf(targetClass)).toBe(name);
  });
});

/** A shape another app registered under `name`, so a WE class of that name is refused. */
function theirs(name: string): SHACLShape {
  const shape = SHACLShape.fromJSON((Space.generateSHACL() as { shape: SHACLShape }).shape.toJSON());
  shape.targetClass = `other-app://${name}`;
  return shape;
}

/** One module's compiled classes, one per entity name. */
const moduleOf = (moduleId: string, ...entities: string[]) =>
  Object.values(
    compileManifest(
      {
        version: '1',
        entities: Object.fromEntries(
          entities.map((name) => [name, { properties: { label: { type: 'string' } }, relations: {} }]),
        ),
      },
      { moduleId },
    ),
  );

describe('the fake refuses a call the way the executor does', () => {
  it('writes nothing from a call one of whose shapes is refused', async () => {
    const r = fakeShapeRegistry();
    r.registry.set('Clash', theirs('Clash'));

    await expect(r.perspective.registerShapes(moduleOf('m', 'Fine', 'Clash').map(shapeOf))).rejects.toThrow(
      /already used by other-app:\/\/Clash/,
    );

    expect([...r.registry.keys()]).toEqual(['Clash']);
    expect(r.calls.written).toEqual([]);
  });

  it('refuses two shapes of one name in one call', async () => {
    const r = fakeShapeRegistry();
    const other = theirs('Fine');

    await expect(r.perspective.registerShapes([...moduleOf('m', 'Fine').map(shapeOf), other])).rejects.toThrow(
      /two shapes for one class/,
    );
    expect(r.registry.size).toBe(0);
  });

  it.each([
    'FlowInstance',
    'FlowTransitionProposal',
    'AutoProcessor',
    'ProcessingClaim',
    'InterpretationRun',
    'InterpretationOverlay',
  ])('refuses an app class named %s, and takes the executor’s own', async (name) => {
    const r = fakeShapeRegistry();

    await expect(r.perspective.registerShapes(moduleOf('m', name).map(shapeOf))).rejects.toThrow(/reserved/);
    expect(r.registry.size).toBe(0);

    const own = theirs(name);
    own.targetClass = `ad4m://${name}`;
    await r.perspective.registerShapes([own]);
    expect([...r.registry.keys()]).toEqual([name]);
  });
});

describe('a refused registration', () => {
  it("of the space's models writes none of them, and says why", async () => {
    const r = fakeShapeRegistry();
    r.registry.set('Space', theirs('Space'));

    await expect(installSpaceSdna(r.proxy)).rejects.toThrow(/class name Space is already used by other-app:\/\/Space/);

    expect([...r.registry.keys()]).toEqual(['Space']);
    expect(r.registry.get('Space')!.targetClass).toBe('other-app://Space');
  });

  it('of one module leaves every other module registered, and names the module refused', async () => {
    const r = fakeShapeRegistry();
    r.registry.set('Clash', theirs('Clash'));

    const refusal = await installModuleSdna(r.proxy, [
      ...moduleOf('first', 'Alpha'),
      ...moduleOf('clashing', 'Beta', 'Clash'),
      ...moduleOf('last', 'Gamma'),
    ]).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ModuleSchemasRefused);
    expect((refusal as ModuleSchemasRefused).refused).toEqual([
      { moduleId: 'clashing', reason: expect.stringContaining('already used by other-app://Clash') },
    ]);
    expect((refusal as ModuleSchemasRefused).message).toContain('clashing');
    // One call per module; the refused module wrote nothing, not even its unclashing class.
    expect(r.calls.registerShapes).toEqual([['Alpha'], ['Beta', 'Clash'], ['Gamma']]);
    expect([...r.registry.keys()].sort()).toEqual(['Alpha', 'Clash', 'Gamma']);
  });

  it("of a module installed with a space leaves the space's own models in", async () => {
    const r = fakeShapeRegistry();

    await expect(installSpaceSdna(r.proxy, moduleOf('bad', 'FlowInstance'))).rejects.toBeInstanceOf(
      ModuleSchemasRefused,
    );

    expect(await isEntityRegistered(r.proxy, Space)).toBe(true);
    expect(r.registry.has('FlowInstance')).toBe(false);
  });
});

function shapeOf(model: unknown): SHACLShape {
  return (model as { generateSHACL(): { shape: SHACLShape } }).generateSHACL().shape;
}
