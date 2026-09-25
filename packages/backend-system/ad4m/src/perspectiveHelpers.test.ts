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

import { getForeignShacl } from './perspectiveHelpers';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeShape(targetClass?: string): SHACLShape {
  return {
    nodeShapeUri: `${targetClass ?? 'unknown'}Shape`,
    targetClass,
    properties: [],
    parentShapes: [],
  } as unknown as SHACLShape;
}

/**
 * The shape registry as the executor answers it: the names, the index query's rows, and `getShacl`.
 *
 * `getAllShacl` throws: in the SDK copy the app runs it reads every shape one at a time, which is
 * the cost `getForeignShacl` exists to avoid.
 */
function mockPerspective(shapes: Array<{ name: string; shape: SHACLShape }>, listed = shapes.map((s) => s.name)) {
  return {
    getShaclNames: vi.fn().mockResolvedValue(listed),
    // Rows only for a query that walks name → shape → target class, so a broken query fails here.
    querySparql: vi.fn(async (query: string) =>
      query.includes('<ad4m://shacl_shape_uri>') && query.includes('<sh://targetClass>')
        ? shapes.map(({ name, shape }) => ({
            name: `literal:string:shacl://${name}`,
            shape: shape.nodeShapeUri,
            ...(shape.targetClass ? { targetClass: shape.targetClass } : {}),
          }))
        : [],
    ),
    getShacl: vi.fn(async (name: string) => shapes.find((s) => s.name === name)?.shape ?? null),
    getAllShacl: vi.fn(() => {
      throw new Error('getAllShacl reads every shape one at a time');
    }),
  } as unknown as PerspectiveProxy;
}

const shapesRead = (perspective: PerspectiveProxy) => vi.mocked(perspective.getShacl).mock.calls.map(([name]) => name);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getForeignShacl', () => {
  it('returns shapes whose names do not match any native model', async () => {
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('app://Task') },
      { name: 'Note', shape: makeShape('app://Note') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.length).toBe(2);
    expect(foreign.map((s) => s.name)).toEqual(['Task', 'Note']);
  });

  it('filters out shapes that match a native model name AND targetClass', async () => {
    const perspective = mockPerspective([
      // Same name + same targetClass → native, should be filtered out
      { name: 'Message', shape: makeShape('flux://Message') },
      // Foreign shape
      { name: 'Task', shape: makeShape('app://Task') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.length).toBe(1);
    expect(foreign[0].name).toBe('Task');
    // The native shape is recognised from the index alone — never read in full.
    expect(shapesRead(perspective)).toEqual(['Task']);
  });

  it('keeps shapes that share a native name but have a different targetClass', async () => {
    const perspective = mockPerspective([
      // Same name "Message" but different targetClass → foreign namesake
      { name: 'Message', shape: makeShape('other-app://Message') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.length).toBe(1);
    expect(foreign[0].name).toBe('Message');
    expect(foreign[0].shape.targetClass).toBe('other-app://Message');
  });

  it('drops shapes with a native name collision when targetClass is missing', async () => {
    const perspective = mockPerspective([
      // Same name as a native entity, and no targetClass to tell them apart.
      { name: 'Channel', shape: makeShape(undefined) },
    ]);

    const foreign = await getForeignShacl(perspective);

    // Nothing distinguishes it from WE's own Channel, so it is treated as native and skipped —
    // the same call the multi-round-trip version made when getShaclTargetClass came back empty.
    expect(foreign.length).toBe(0);
    expect(shapesRead(perspective)).toEqual([]);
  });

  it('returns an empty array when the perspective has no shapes', async () => {
    const perspective = mockPerspective([]);
    const foreign = await getForeignShacl(perspective);
    expect(foreign).toEqual([]);
  });

  it('asks one index query, whatever the number of shapes, and never getAllShacl', async () => {
    const perspective = mockPerspective([
      { name: 'Message', shape: makeShape('flux://Message') },
      { name: 'Channel', shape: makeShape('flux://Channel') },
      { name: 'X', shape: makeShape('app://X') },
    ]);

    await getForeignShacl(perspective);

    expect(perspective.querySparql).toHaveBeenCalledTimes(1);
    expect(perspective.getShaclNames).toHaveBeenCalledTimes(1);
    expect(perspective.getAllShacl).not.toHaveBeenCalled();
    expect(shapesRead(perspective)).toEqual(['X']);
  });

  it('decides on the shape as read when the index and the shape disagree', async () => {
    // The index marks Message as another target class, so it is read — and the rule then runs on
    // what `getShacl` returns, which here is WE's own Message after all.
    const perspective = mockPerspective([{ name: 'Message', shape: makeShape('other-app://Message') }]);
    vi.mocked(perspective.getShacl).mockResolvedValue(makeShape('flux://Message'));

    expect(await getForeignShacl(perspective)).toEqual([]);
    expect(shapesRead(perspective)).toEqual(['Message']);
  });

  it('builds the other foreign models when one shape cannot be read', async () => {
    // The SDK the app runs cannot parse a property transform a newer SDK encoded, and throws.
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('app://Task') },
      { name: 'Broken', shape: makeShape('app://Broken') },
    ]);
    vi.mocked(perspective.getShacl).mockImplementation(async (name: string) => {
      if (name === 'Broken') throw new Error('Failed to deserialize transform');
      return makeShape('app://Task');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['Task']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('reads nothing the registry does not list', async () => {
    // A shape's links can outlive its `ad4m://has_shacl` entry; the registry says what is installed.
    const perspective = mockPerspective(
      [
        { name: 'Task', shape: makeShape('app://Task') },
        { name: 'Removed', shape: makeShape('app://Removed') },
      ],
      ['Task'],
    );

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['Task']);
    expect(shapesRead(perspective)).toEqual(['Task']);
  });
});
