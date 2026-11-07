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

import { getForeignShacl, readShapeProperties } from './perspectiveHelpers';

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

  it('keeps shapes that share a native name but have a different targetClass', async () => {
    const perspective = mockPerspective([{ name: 'Message', shape: makeShape('other-app://Message') }]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign).toHaveLength(1);
    expect(foreign[0].name).toBe('Message');
    expect(foreign[0].shape.targetClass).toBe('other-app://Message');
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
