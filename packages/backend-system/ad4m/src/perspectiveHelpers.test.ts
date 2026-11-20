import { getRelationsMetadata, type PerspectiveProxy, type SHACLShape } from '@coasys/ad4m';
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

import { buildEntityClasses, getForeignShacl } from './perspectiveHelpers';

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
 * The shape registry as the executor answers it: `perspective.shapes()` — one call,
 * every registered class with its shape — plus the index query's rows.
 *
 * The mock keeps `shapes(names)` honest to the real filter: a name list matches a
 * summary by its class name OR its target class IRI, exactly as the RPC does.
 */
function mockPerspective(
  shapes: Array<{ name: string; shape: SHACLShape }>,
  listed = shapes.map((s) => s.name),
  rows?: Array<{ name: string; shape?: string; targetClass?: string }>,
) {
  const summaries = listed
    .map((name) => shapes.find((s) => s.name === name))
    .filter((s): s is { name: string; shape: SHACLShape } => Boolean(s))
    .map(({ name, shape }) => ({ name, shape, hash: 'hash' }));
  return {
    summaries,
    shapes: vi.fn(async (names?: string[]) =>
      names ? summaries.filter((s) => names.includes(s.name) || names.includes(s.shape.targetClass ?? '')) : summaries,
    ),
    // Rows only for a query that walks name → shape → target class, so a broken query fails here.
    querySparql: vi.fn(async (query: string) =>
      query.includes('<ad4m://shacl_shape_uri>') && query.includes('<sh://targetClass>')
        ? (rows ??
          shapes.map(({ name, shape }) => ({
            name: `literal:string:shacl://${name}`,
            shape: shape.nodeShapeUri,
            ...(shape.targetClass ? { targetClass: shape.targetClass } : {}),
          })))
        : [],
    ),
  } as unknown as PerspectiveProxy & { summaries: { name: string; shape: SHACLShape; hash: string }[] };
}

/**
 * The names the per-shape fallback read — `shapes([name])` calls. An empty list is
 * the success case: `shapes()` answered everything in one call.
 */
const shapesRead = (perspective: PerspectiveProxy) =>
  vi
    .mocked(perspective.shapes)
    .mock.calls.filter(([names]) => names !== undefined)
    .map(([names]) => names![0]);

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
    // `shapes()` read the registry in one call — no per-shape reads follow.
    expect(shapesRead(perspective)).toEqual([]);
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
  });

  it("leaves out the executor's own classes, without reading them", async () => {
    const perspective = mockPerspective([
      { name: 'FlowInstance', shape: makeShape('ad4m://FlowInstance') },
      { name: 'AutoProcessor', shape: makeShape('ad4m://AutoProcessor') },
      { name: 'Task', shape: makeShape('app://Task') },
    ]);

    const foreign = await getForeignShacl(perspective);

    expect(foreign.map((s) => s.name)).toEqual(['Task']);
    expect(shapesRead(perspective)).toEqual([]);
  });

  it('returns an empty array when the perspective has no shapes', async () => {
    const perspective = mockPerspective([]);
    const foreign = await getForeignShacl(perspective);
    expect(foreign).toEqual([]);
  });

  it('asks one index query and one registry read, whatever the number of shapes', async () => {
    const perspective = mockPerspective([
      { name: 'Message', shape: makeShape('flux://Message') },
      { name: 'Channel', shape: makeShape('flux://Channel') },
      { name: 'X', shape: makeShape('app://X') },
    ]);

    await getForeignShacl(perspective);

    expect(perspective.querySparql).toHaveBeenCalledTimes(1);
    expect(vi.mocked(perspective.shapes).mock.calls.filter(([names]) => names === undefined)).toHaveLength(1);
    expect(shapesRead(perspective)).toEqual([]);
  });

  it('decides on the shape as read when the index and the shape disagree', async () => {
    // The index marks Message as another target class, so it is kept — but the rule then runs
    // on the shape the registry reads, which here is WE's own Message after all.
    const perspective = mockPerspective(
      [{ name: 'Message', shape: makeShape('flux://Message') }],
      ['Message'],
      [{ name: 'literal:string:shacl://Message', shape: 'MessageShape', targetClass: 'other-app://Message' }],
    );

    expect(await getForeignShacl(perspective)).toEqual([]);
    expect(shapesRead(perspective)).toEqual([]);
  });

  it('builds the other foreign models when one shape cannot be read', async () => {
    // A whole-registry `shapes()` call fails — the fallback reads each name alone, and the one
    // shape that still fails costs its own model, not every foreign model in the dataset.
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('app://Task') },
      { name: 'Broken', shape: makeShape('app://Broken') },
    ]);
    const { summaries } = perspective;
    vi.mocked(perspective.shapes).mockImplementation(async (names?: string[]) => {
      if (!names) throw new Error('Failed to deserialize transform');
      if (names.includes('Broken')) throw new Error('Failed to deserialize transform');
      return summaries.filter((s) => names.includes(s.name));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['Task']);
    expect(shapesRead(perspective)).toEqual(['Task', 'Broken']);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('reads every shape, and keeps the answer, when the index query fails', async () => {
    const perspective = mockPerspective([
      { name: 'Task', shape: makeShape('app://Task') },
      { name: 'Message', shape: makeShape('flux://Message') },
    ]);
    vi.mocked(perspective.querySparql).mockRejectedValue(new Error('SPARQL unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await getForeignShacl(perspective)).map((s) => s.name)).toEqual(['Task']);
    expect(shapesRead(perspective)).toEqual([]);
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
    expect(shapesRead(perspective)).toEqual([]);
  });
});

describe('buildEntityClasses', () => {
  // A mounted language's shape, as the Acorn language declares `topPriorityOutcomes`: a
  // reference collection with no `sh:class`. The executor refuses to include such a relation
  // unless the read says `polymorphic: true`, and the SDK only says so for a relation whose
  // metadata carries the flag.
  it('reads an untyped reference collection polymorphically, and a typed one as its class', () => {
    const shape = {
      nodeShapeUri: 'acorn://AcornProjectMetaShape',
      targetClass: 'acorn://AcornProjectMeta',
      properties: [
        { path: 'acorn://name', name: 'name', maxCount: 1 },
        { path: 'acorn://topPriorityOutcomes', name: 'topPriorityOutcomes', nodeKind: 'IRI' },
        { path: 'acorn://members', name: 'members', nodeKind: 'IRI', class: 'acorn://AcornMember' },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;

    const { AcornProjectMeta } = buildEntityClasses([{ name: 'AcornProjectMeta', shape }]);
    const relations = getRelationsMetadata(AcornProjectMeta as never) as Record<string, { polymorphic?: boolean }>;

    expect(relations.topPriorityOutcomes?.polymorphic).toBe(true);
    expect(relations.members?.polymorphic).toBeUndefined();
  });
});
