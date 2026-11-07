/**
 * Another app's class beside WE's own of the same name, reached through the entity registry.
 *
 * `getEntityForDataset` prefers WE's native class when a name is taken. So a foreign class of a name WE
 * has is registered under its target class IRI (`getForeignShacl`), and must be reachable by that key
 * beside WE's class: `Topic` is WE's, `flux://Topic` is Flux's. The path is the one the schema port's
 * `foreignSchemas` takes: read the shapes, build the classes, register them for the dataset.
 */
import { Ad4mModel, SHACLShape } from '@coasys/ad4m';
import {
  getEntityForDataset,
  getEntityTargetClass,
  registerDynamicEntities,
  registerEntity,
  unregisterEntity,
} from '@we/entities';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Topic } from '../src/entities';
import { buildEntityClasses, getForeignShacl } from '../src/perspectiveHelpers';
import { entityNameOfClass } from '../src/recordTypes';

const WE_TOPIC = getEntityTargetClass(Topic as never) as string;

/** A shape as the executor reads one back: a class and one named property. */
function shapeFor(targetClass: string, path: string): SHACLShape {
  const shape = new SHACLShape(targetClass);
  shape.addProperty({ name: 'title', path, datatype: 'xsd://string', maxCount: 1 } as never);
  return shape;
}

/** A perspective whose registry holds WE's `Topic` and the given foreign shapes, each by its name. */
function perspectiveWith(uuid: string, foreign: { name: string; shape: SHACLShape }[]) {
  const ours = SHACLShape.fromJSON(
    JSON.parse(JSON.stringify((Topic as unknown as typeof Ad4mModel).generateSHACL().shape.toJSON())),
  );
  const registered = [{ name: 'Topic', shape: ours }, ...foreign];
  return { uuid, shapes: async () => registered.map((r) => ({ ...r, hash: '' })) } as never;
}

const targetOf = (model: unknown) => (model as { getTargetClass(): string }).getTargetClass();

beforeAll(() => registerEntity('Topic', Topic as never));
afterAll(() => unregisterEntity('Topic'));

describe("a foreign class beside WE's own of the same name", () => {
  const dataset = { uuid: 'p-flux-topic' };

  beforeAll(async () => {
    const shapes = await getForeignShacl(
      perspectiveWith(dataset.uuid, [{ name: 'Topic', shape: shapeFor('flux://Topic', 'flux://title') }]),
    );
    registerDynamicEntities(dataset.uuid, buildEntityClasses(shapes));
  });
  afterAll(() => registerDynamicEntities(dataset.uuid, {}));

  it("resolves WE's name to WE's class", () => {
    expect(WE_TOPIC).not.toBe('flux://Topic');
    expect(getEntityForDataset('Topic', dataset)).toBe(Topic);
    expect(getEntityTargetClass(getEntityForDataset('Topic', dataset)!)).toBe(WE_TOPIC);
  });

  it("resolves the foreign key to Flux's class", () => {
    const flux = getEntityForDataset('flux://Topic', dataset);
    expect(flux).toBeDefined();
    expect(flux).not.toBe(Topic);
    expect(targetOf(flux)).toBe('flux://Topic');
  });

  it('names each class back from the IRI the executor answers with', () => {
    expect(entityNameOfClass(WE_TOPIC, dataset)).toBe('Topic');
    expect(entityNameOfClass('flux://Topic', dataset)).toBe('flux://Topic');
  });
});

describe('two foreign classes of one name, and no WE class of that name', () => {
  const dataset = { uuid: 'p-two-notes' };

  beforeAll(async () => {
    const shapes = await getForeignShacl(
      perspectiveWith(dataset.uuid, [
        { name: 'Note', shape: shapeFor('a://Note', 'a://title') },
        { name: 'Note', shape: shapeFor('b://Note', 'b://title') },
      ]),
    );
    registerDynamicEntities(dataset.uuid, buildEntityClasses(shapes));
  });
  afterAll(() => registerDynamicEntities(dataset.uuid, {}));

  it('reaches both, each by its target class IRI', () => {
    expect(targetOf(getEntityForDataset('a://Note', dataset))).toBe('a://Note');
    expect(targetOf(getEntityForDataset('b://Note', dataset))).toBe('b://Note');
    expect(getEntityForDataset('a://Note', dataset)).not.toBe(getEntityForDataset('b://Note', dataset));
  });

  it('gives neither the shared name, so a read by it is not one of them by chance', () => {
    expect(getEntityForDataset('Note', dataset)).toBeUndefined();
  });

  it('names each row class back to its own key', () => {
    expect(entityNameOfClass('a://Note', dataset)).toBe('a://Note');
    expect(entityNameOfClass('b://Note', dataset)).toBe('b://Note');
  });
});
