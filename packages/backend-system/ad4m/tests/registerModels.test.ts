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
    const older = r.registry.get(targetOf(Space))!;
    older.properties = older.properties.slice(1);

    expect(await refreshSpaceSdna(r.proxy)).toEqual(['Space']);
    // The executor answered by target class IRI; the port answers the entity name WE registered.
    expect(r.calls.written.at(-1)).toEqual([targetOf(Space)]);
    expect(await refreshSpaceSdna(r.proxy)).toEqual([]);
  });

  it("names WE's class it wrote by entity, beside another app's class of the same name", async () => {
    const r = fakeShapeRegistry();
    r.registry.set('other-app://Space', theirs('Space'));

    await installSpaceSdna(r.proxy);
    const older = r.registry.get(targetOf(Space))!;
    older.properties = older.properties.slice(1);

    expect(await refreshSpaceSdna(r.proxy)).toEqual(['Space']);
    expect(r.registry.get('other-app://Space')!.targetClass).toBe('other-app://Space');
  });

  it('passes a name an older executor answered with through as it is', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy);
    const answer = r.perspective.registerShapes.bind(r.perspective);
    r.perspective.registerShapes = async (shapes) => {
      const result = await answer(shapes);
      return { ...result, written: result.written.map(classNameOf) };
    };
    const older = r.registry.get(targetOf(Space))!;
    older.properties = older.properties.slice(1);

    expect(await refreshSpaceSdna(r.proxy)).toEqual(['Space']);
  });
});

describe('isEntityRegistered', () => {
  it('is false before the class is registered, and true after', async () => {
    const r = fakeShapeRegistry();

    expect(await isEntityRegistered(r.proxy, Space)).toBe(false);
    await installSpaceSdna(r.proxy);
    expect(await isEntityRegistered(r.proxy, Space)).toBe(true);
  });

  it('asks the registry for the one class, by its target class', async () => {
    const r = fakeShapeRegistry();

    await isEntityRegistered(r.proxy, Space);

    expect(r.calls.shapes).toEqual([[targetOf(Space)]]);
  });

  it("is false when only another app's class has the name", async () => {
    // Two apps can each have a class called Space. Only WE's target class answers yes.
    const r = fakeShapeRegistry();
    r.registry.set('other-app://Space', theirs('Space'));

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

/** A shape another app registered for a class called `name`: `other-app://<name>`, with its own shape URI. */
function theirs(name: string): SHACLShape {
  const shape = SHACLShape.fromJSON((Space.generateSHACL() as { shape: SHACLShape }).shape.toJSON());
  shape.targetClass = `other-app://${name}`;
  shape.nodeShapeUri = `other-app://${name}Shape`;
  return shape;
}

/** A model's target class: what the registry is keyed by. */
function targetOf(model: unknown): string {
  return shapeOf(model).targetClass!;
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

/** A class of another app's, `other-app://<name>`, that holds the shape URI `shapeUri`. */
function holding(name: string, shapeUri: string): SHACLShape {
  const shape = theirs(name);
  shape.nodeShapeUri = shapeUri;
  return shape;
}

describe('the fake registers a call the way the executor does', () => {
  it('registers a class beside another class of the same name', async () => {
    const r = fakeShapeRegistry();
    const fine = moduleOf('m', 'Fine').map(shapeOf);
    await r.perspective.registerShapes([theirs('Fine')]);

    await r.perspective.registerShapes(fine);

    expect([...r.registry.keys()].sort()).toEqual([fine[0].targetClass, 'other-app://Fine'].sort());
    // Asked by name, both answer; asked by target class, only the one.
    expect((await r.perspective.shapes(['Fine'])).map((s) => s.shape.targetClass)).toHaveLength(2);
    expect((await r.perspective.shapes(['other-app://Fine'])).map((s) => s.shape.targetClass)).toEqual([
      'other-app://Fine',
    ]);
  });

  it('writes nothing from a call one of whose shapes is refused', async () => {
    const r = fakeShapeRegistry();
    const [fine, clash] = moduleOf('m', 'Fine', 'Clash').map(shapeOf);
    r.registry.set('other-app://Clash', holding('Clash', clash.nodeShapeUri));

    await expect(r.perspective.registerShapes([fine, clash])).rejects.toThrow(
      /already belongs to class 'other-app:\/\/Clash'/,
    );

    expect([...r.registry.keys()]).toEqual(['other-app://Clash']);
    expect(r.calls.written).toEqual([]);
  });

  it('refuses two shapes for one target class in one call', async () => {
    const r = fakeShapeRegistry();
    const fine = moduleOf('m', 'Fine').map(shapeOf);

    await expect(r.perspective.registerShapes([...fine, ...fine])).rejects.toThrow(/Two shapes for one class/);
    expect(r.registry.size).toBe(0);
  });

  it.each([
    'FlowInstance',
    'FlowTransitionProposal',
    'AutoProcessor',
    'ProcessingClaim',
    'InterpretationRun',
    'InterpretationOverlay',
  ])('registers an app class named %s beside the executor’s own', async (name) => {
    // No name is reserved: the executor's class is `ad4m://<name>`, and an app's has its own IRI.
    const r = fakeShapeRegistry();
    const own = theirs(name);
    own.targetClass = `ad4m://${name}`;
    own.nodeShapeUri = `ad4m://${name}Shape`;
    await r.perspective.registerShapes([own]);

    const app = moduleOf('m', name).map(shapeOf);
    await r.perspective.registerShapes(app);

    expect([...r.registry.keys()].sort()).toEqual([`ad4m://${name}`, app[0].targetClass].sort());
  });
});

describe('a class of the same name as one of WE’s', () => {
  it("does not stop WE's space models from registering", async () => {
    const r = fakeShapeRegistry();
    for (const name of ['Topic', 'Space', 'TaskBlock']) r.registry.set(`other-app://${name}`, theirs(name));

    await installSpaceSdna(r.proxy);

    expect(await isEntityRegistered(r.proxy, Space)).toBe(true);
    expect(r.registry.get('other-app://Space')!.targetClass).toBe('other-app://Space');
  });

  it("finds each of WE's classes by its IRI, and only WE's", async () => {
    const r = fakeShapeRegistry();
    for (const name of spaceNames()) r.registry.set(`other-app://${name}`, theirs(name));

    await installSpaceSdna(r.proxy);

    for (const model of SPACE_MODELS.filter((m) => !Object.prototype.hasOwnProperty.call(m, 'builtinUri'))) {
      const iri = targetOf(model);
      expect((await r.perspective.shapes([iri])).map((s) => s.shape.targetClass)).toEqual([iri]);
      expect(await isEntityRegistered(r.proxy, model as never)).toBe(true);
    }
  });
});

describe('a refused registration', () => {
  it("of the space's models writes none of them, and says why", async () => {
    const r = fakeShapeRegistry();
    r.registry.set('other-app://Space', holding('Space', shapeOf(Space).nodeShapeUri));

    await expect(installSpaceSdna(r.proxy)).rejects.toThrow(/already belongs to class 'other-app:\/\/Space'/);

    expect([...r.registry.keys()]).toEqual(['other-app://Space']);
  });

  it('of one module leaves every other module registered, and names the module refused', async () => {
    const r = fakeShapeRegistry();
    const clashing = moduleOf('clashing', 'Beta', 'Clash');
    r.registry.set('other-app://Clash', holding('Clash', shapeOf(clashing[1]).nodeShapeUri));
    const first = moduleOf('first', 'Alpha');
    const last = moduleOf('last', 'Gamma');

    const refusal = await installModuleSdna(r.proxy, [...first, ...clashing, ...last]).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ModuleSchemasRefused);
    expect((refusal as ModuleSchemasRefused).refused).toEqual([
      { moduleId: 'clashing', reason: expect.stringContaining("already belongs to class 'other-app://Clash'") },
    ]);
    expect((refusal as ModuleSchemasRefused).message).toContain('clashing');
    // One call per module; the refused module wrote nothing, not even its unclashing class.
    expect(r.calls.registerShapes).toEqual([['Alpha'], ['Beta', 'Clash'], ['Gamma']]);
    expect([...r.registry.keys()].sort()).toEqual(['other-app://Clash', targetOf(first[0]), targetOf(last[0])].sort());
  });

  it("of a module installed with a space leaves the space's own models in", async () => {
    const r = fakeShapeRegistry();
    const bad = moduleOf('bad', 'Stolen');
    r.registry.set('other-app://Stolen', holding('Stolen', shapeOf(bad[0]).nodeShapeUri));

    await expect(installSpaceSdna(r.proxy, bad)).rejects.toBeInstanceOf(ModuleSchemasRefused);

    expect(await isEntityRegistered(r.proxy, Space)).toBe(true);
    expect(r.registry.has(targetOf(bad[0]))).toBe(false);
  });
});

function shapeOf(model: unknown): SHACLShape {
  return (model as { generateSHACL(): { shape: SHACLShape } }).generateSHACL().shape;
}
