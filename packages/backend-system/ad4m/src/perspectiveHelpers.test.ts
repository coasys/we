import type { PerspectiveProxy, SHACLShape } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

// ── Mock the WE entity registry ──────────────────────────────────────────────
vi.mock('@we/entities', () => ({
  getRegisteredEntityNames: () => ['Message', 'Channel'],
  getEntity: (name: string) => ({ name }),
  getEntityTargetClass: (entity: { name: string }) => {
    const map: Record<string, string> = {
      Message: 'flux://Message',
      Channel: 'flux://Channel',
    };
    return map[entity.name] ?? '';
  },
}));

import { buildEntityClasses, buildEntityManifest, getForeignShacl, readShapeProperties } from './perspectiveHelpers';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeShape(targetClass: string, properties: { path: string; name?: string }[] = []): SHACLShape {
  return {
    nodeShapeUri: `${targetClass}Shape`,
    targetClass,
    properties,
    parentShapes: [],
  } as unknown as SHACLShape;
}

/**
 * The shape registry as the executor answers it: `shapes()`, one record per registered class with
 * its whole shape. Nothing else is mocked, so a read through any other method fails here.
 */
function mockPerspective(shapes: Array<{ name: string; shape: SHACLShape }>) {
  return {
    shapes: vi.fn(async () => shapes.map(({ name, shape }) => ({ name, shape, hash: `hash-${name}` }))),
  } as unknown as PerspectiveProxy;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getForeignShacl', () => {
  it('returns shapes whose names do not match any native model', async () => {
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('app://Task') },
      { name: 'Note', shape: makeShape('app://Note') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.map((s) => s.name)).toEqual(['Task', 'Note']);
  });

  it('filters out shapes that match a native model name AND targetClass', async () => {
    const perspective = mockPerspective([
      { name: 'Message', shape: makeShape('flux://Message') },
      { name: 'Task', shape: makeShape('app://Task') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.map((s) => s.name)).toEqual(['Task']);
  });

  it('keeps a shape that shares a native name, named by its target class', async () => {
    // WE has `Message` (flux://Message here). Another app's `Message` is a class of its own, and
    // under the bare name it would be WE's in the entity registry, so it goes by its IRI.
    const perspective = mockPerspective([
      { name: 'Message', shape: makeShape('flux://Message') },
      { name: 'Message', shape: makeShape('other-app://Message') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign).toHaveLength(1);
    expect(foreign[0].name).toBe('other-app://Message');
    expect(foreign[0].shape.targetClass).toBe('other-app://Message');
  });

  it('names two foreign classes of one name by their target classes', async () => {
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('a://Task') },
      { name: 'Task', shape: makeShape('b://Task') },
      { name: 'Note', shape: makeShape('a://Note') },
    ]);

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['a://Task', 'b://Task', 'Note']);
  });

  it("leaves out the executor's own classes", async () => {
    const perspective = mockPerspective([
      { name: 'FlowInstance', shape: makeShape('ad4m://FlowInstance') },
      { name: 'AutoProcessor', shape: makeShape('ad4m://AutoProcessor') },
      { name: 'Task', shape: makeShape('app://Task') },
    ]);

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['Task']);
  });

  it('returns an empty array when the perspective has no shapes', async () => {
    expect(await getForeignShacl(mockPerspective([]))).toEqual([]);
  });

  it('reads the registry in one call, whatever the number of shapes', async () => {
    const perspective = mockPerspective([
      { name: 'Message', shape: makeShape('flux://Message') },
      { name: 'Channel', shape: makeShape('flux://Channel') },
      { name: 'X', shape: makeShape('app://X') },
    ]);

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['X']);
    expect(perspective.shapes).toHaveBeenCalledTimes(1);
    expect(perspective.shapes).toHaveBeenCalledWith();
  });

  it('returns each foreign shape as the registry gave it, without its hash', async () => {
    const shape = makeShape('app://Task');
    expect(await getForeignShacl(mockPerspective([{ name: 'Task', shape }]))).toEqual([{ name: 'Task', shape }]);
  });
});

describe('readShapeProperties', () => {
  it('gives every registered class its properties, by path and name, in one call', async () => {
    const perspective = mockPerspective([
      { name: 'Message', shape: makeShape('flux://Message', [{ path: 'flux://body', name: 'body' }]) },
      {
        name: 'Task',
        shape: makeShape('app://Task', [{ path: 'app://title', name: 'title' }, { path: 'app://done' }]),
      },
    ]);

    expect(await readShapeProperties(perspective)).toEqual([
      { name: 'Message', properties: [{ path: 'flux://body', name: 'body' }] },
      { name: 'Task', properties: [{ path: 'app://title', name: 'title' }, { path: 'app://done' }] },
    ]);
    expect(perspective.shapes).toHaveBeenCalledTimes(1);
  });

  it('leaves out a class with no properties', async () => {
    const perspective = mockPerspective([{ name: 'Marker', shape: makeShape('app://Marker') }]);
    expect(await readShapeProperties(perspective)).toEqual([]);
  });
});

/** A real shape with one named property, as the executor reads one back. */
async function realShape(targetClass: string, property: { name: string; path: string; class?: string }) {
  const { SHACLShape: Shape } = await vi.importActual<typeof import('@coasys/ad4m')>('@coasys/ad4m');
  const shape = new Shape(targetClass);
  shape.addProperty({
    name: property.name,
    path: property.path,
    ...(property.class ? { class: property.class } : { datatype: 'xsd://string', maxCount: 1 }),
  } as never);
  return shape;
}

describe('a foreign class named by its target class', () => {
  it('is built as the class of that target class, under the name it was given', async () => {
    const shape = await realShape('other-app://Message', { name: 'body', path: 'other-app://body' });

    const classes = buildEntityClasses([{ name: 'other-app://Message', shape }]);

    expect(Object.keys(classes)).toEqual(['other-app://Message']);
    const cls = classes['other-app://Message'] as unknown as { getTargetClass(): string };
    expect(cls.getTargetClass()).toBe('other-app://Message');
  });

  it('keeps its own name, and the `Shape` alias, where the name is free', async () => {
    const shape = await realShape('app://Task', { name: 'title', path: 'app://title' });

    expect(Object.keys(buildEntityClasses([{ name: 'Task', shape }])).sort()).toEqual(['Task', 'TaskShape']);
  });

  it('is what a relation to it names in the manifest', async () => {
    const topic = await realShape('other-app://Topic', { name: 'title', path: 'other-app://title' });
    const post = await realShape('other-app://Post', {
      name: 'topic',
      path: 'other-app://topic',
      class: 'other-app://TopicShape',
    });

    const entries = buildEntityManifest([
      { name: 'other-app://Topic', shape: topic },
      { name: 'Post', shape: post },
    ]);

    expect(entries.map((e) => e.name)).toEqual(['other-app://Topic', 'Post']);
    expect(entries[1].properties[0].relatedEntity).toBe('other-app://Topic');
  });
});
