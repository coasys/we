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

    // The given name is the IRI, so the one key is both.
    expect(Object.keys(classes)).toEqual(['other-app://Message']);
    const cls = classes['other-app://Message'] as unknown as { getTargetClass(): string };
    expect(cls.getTargetClass()).toBe('other-app://Message');
  });

  it('keeps its own name, and the `Shape` alias, where the name is free', async () => {
    const shape = await realShape('app://Task', { name: 'title', path: 'app://title' });

    expect(Object.keys(buildEntityClasses([{ name: 'Task', shape }])).sort()).toEqual([
      'Task',
      'TaskShape',
      'app://Task',
    ]);
  });

  it('keeps a real class under its name over another class’s `Shape` alias', async () => {
    // `Task` comes first and would mint the `TaskShape` alias — but a class actually called
    // TaskShape owns that name. The manifest names it `TaskShape`, so `TaskShape` must be its class.
    const task = await realShape('app://Task', { name: 'title', path: 'app://title' });
    const taskShape = await realShape('app://TaskShape', { name: 'note', path: 'app://note' });

    const classes = buildEntityClasses([
      { name: 'Task', shape: task },
      { name: 'TaskShape', shape: taskShape },
    ]);
    const targetOf = (key: string) => (classes[key] as unknown as { getTargetClass(): string }).getTargetClass();

    expect(targetOf('Task')).toBe('app://Task');
    expect(targetOf('TaskShape')).toBe('app://TaskShape');
    // And the lone class still gets its alias when no class owns the name.
    expect(Object.keys(buildEntityClasses([{ name: 'Task', shape: task }]))).toContain('TaskShape');
  });

  it('two foreign classes of one name, with no WE class of that name, are both reachable', async () => {
    // `Note` is not a WE model in this registry (the mock has Message and Channel only).
    const a = await realShape('a://Note', { name: 'body', path: 'a://body' });
    const b = await realShape('b://Note', { name: 'text', path: 'b://text' });

    // Given as the executor names them: one name, two classes. Neither may overwrite the other.
    const classes = buildEntityClasses([
      { name: 'Note', shape: a },
      { name: 'Note', shape: b },
    ]);
    const targetOf = (key: string) => (classes[key] as unknown as { getTargetClass(): string }).getTargetClass();

    expect(Object.keys(classes).sort()).toEqual(['a://Note', 'b://Note']);
    expect(targetOf('a://Note')).toBe('a://Note');
    expect(targetOf('b://Note')).toBe('b://Note');
  });

  it('two foreign classes of one name, named through getForeignShacl, are both registered by IRI', async () => {
    const a = await realShape('a://Note', { name: 'body', path: 'a://body' });
    const b = await realShape('b://Note', { name: 'text', path: 'b://text' });
    const foreign = await getForeignShacl(
      mockPerspective([
        { name: 'Note', shape: a },
        { name: 'Note', shape: b },
      ]),
    );

    const classes = buildEntityClasses(foreign);

    expect(foreign.map((s) => s.name)).toEqual(['a://Note', 'b://Note']);
    expect((classes['a://Note'] as unknown as { getTargetClass(): string }).getTargetClass()).toBe('a://Note');
    expect((classes['b://Note'] as unknown as { getTargetClass(): string }).getTargetClass()).toBe('b://Note');
    expect(classes['Note']).toBeUndefined();
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

describe('buildEntityManifest', () => {
  it('reads a relation target declared only as a target class name', () => {
    // The SDK's SHACLShape lifts `sh:class` into `p.class` but a model's own
    // `target_class_name` into `p.targetClassName` — a shape written by the model API, rather than
    // by hand, declares the second and no `sh:class`. Read only the first and every extracted
    // model relation pointed at nothing.
    const shape = {
      nodeShapeUri: 'TopicShape',
      targetClass: 'discussion://Topic',
      properties: [
        {
          name: 'about',
          path: 'discussion://about',
          nodeKind: 'IRI',
          relationKind: 'hasOne',
          targetClassName: 'DiscussionTopic',
          minCount: 0,
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;

    const [entry] = buildEntityManifest([{ name: 'Position', shape }]);
    expect(entry.properties[0]).toMatchObject({ name: 'about', type: 'uri', relatedEntity: 'DiscussionTopic' });
  });

  it('prefers target_class_name over sh:class when both are declared (decorator classes write both)', () => {
    const shape = {
      nodeShapeUri: 'TopicShape',
      targetClass: 'discussion://Topic',
      properties: [
        {
          name: 'about',
          path: 'discussion://about',
          nodeKind: 'IRI',
          relationKind: 'hasOne',
          class: 'discussion://DiscussionTopicShape',
          targetClassName: 'DiscussionTopic',
          minCount: 0,
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;

    const [entry] = buildEntityManifest([{ name: 'Position', shape }]);
    // `sh:class` is the target's *shape* URI (`…Shape`); the class name is `targetClassName`.
    expect(entry.properties[0].relatedEntity).toBe('DiscussionTopic');
  });

  it('names a reverse relation’s forward from the predicate they share', () => {
    /*
      SHACL says `belongsTo` — which end owns the link — but never *which property* is its
      forward. It does not need to: the two read one predicate from opposite ends, so the
      pairing is recoverable here, and `reverseOf` is what every consumer — the graph's
      direction, a tree move's writable side — asks for.
    */
    const post = {
      nodeShapeUri: 'PostShape',
      targetClass: 'discuss://Post',
      properties: [
        {
          name: 'comments',
          path: 'discuss://comments',
          nodeKind: 'IRI',
          relationKind: 'hasMany',
          targetClassName: 'Comment',
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;
    const comment = {
      nodeShapeUri: 'CommentShape',
      targetClass: 'discuss://Comment',
      properties: [
        {
          name: 'post',
          path: 'discuss://comments',
          nodeKind: 'IRI',
          relationKind: 'belongsToOne',
          targetClassName: 'Post',
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;

    const entries = buildEntityManifest([
      { name: 'Post', shape: post },
      { name: 'Comment', shape: comment },
    ]);

    const backPointer = entries.find((e) => e.name === 'Comment')!.properties[0];
    expect(backPointer).toMatchObject({ name: 'post', reverse: true, reverseOf: 'comments' });
  });

  it('pairs a reverse with the forward that points back at its class, among forwards over one predicate', () => {
    // `pinned` is declared first and shares the predicate, but points at Pin; only `comments` points at Comment.
    const board = {
      nodeShapeUri: 'BoardShape',
      targetClass: 'discuss://Board',
      properties: [
        {
          name: 'pinned',
          path: 'discuss://has_child',
          nodeKind: 'IRI',
          relationKind: 'hasMany',
          targetClassName: 'Pin',
        },
        {
          name: 'comments',
          path: 'discuss://has_child',
          nodeKind: 'IRI',
          relationKind: 'hasMany',
          targetClassName: 'Comment',
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;
    const comment = {
      nodeShapeUri: 'CommentShape',
      targetClass: 'discuss://Comment',
      properties: [
        {
          name: 'board',
          path: 'discuss://has_child',
          nodeKind: 'IRI',
          relationKind: 'belongsToOne',
          targetClassName: 'Board',
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;

    const entries = buildEntityManifest([
      { name: 'Board', shape: board },
      { name: 'Comment', shape: comment },
    ]);
    expect(entries.find((e) => e.name === 'Comment')!.properties[0]).toMatchObject({ reverseOf: 'comments' });
  });

  it('falls back to the predicate when no forward names the reverse’s class', () => {
    const board = {
      nodeShapeUri: 'BoardShape',
      targetClass: 'discuss://Board',
      properties: [{ name: 'items', path: 'discuss://has_child', nodeKind: 'IRI', relationKind: 'hasMany' }],
      parentShapes: [],
    } as unknown as SHACLShape;
    const comment = {
      nodeShapeUri: 'CommentShape',
      targetClass: 'discuss://Comment',
      properties: [
        {
          name: 'board',
          path: 'discuss://has_child',
          nodeKind: 'IRI',
          relationKind: 'belongsToOne',
          targetClassName: 'Board',
        },
      ],
      parentShapes: [],
    } as unknown as SHACLShape;
    const entries = buildEntityManifest([
      { name: 'Board', shape: board },
      { name: 'Comment', shape: comment },
    ]);
    expect(entries.find((e) => e.name === 'Comment')!.properties[0]).toMatchObject({ reverseOf: 'items' });
  });
});
