import type { ModelManifestEntry, ModelManifestProperty } from '@we/backend-ad4m';
import { toNeutralManifest } from '@we/backend-ad4m';
import { type QueryIR, validateManifest, validateQueryAgainstManifest } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

// Terse builder for an AD4M-side property (only the fields under test vary).
const prop = (
  name: string,
  type: ModelManifestProperty['type'],
  extra: Partial<ModelManifestProperty> = {},
): ModelManifestProperty => ({
  name,
  predicate: `we://${name}`,
  type,
  isCollection: false,
  required: false,
  writable: true,
  ...extra,
});

// A small WE-ish slice: Post (with a to-one author, a to-many signals, an untyped `comments` edge,
// and an image URL), Agent, Signal.
const entries: ModelManifestEntry[] = [
  {
    name: 'Post',
    targetClass: 'we://Post',
    properties: [
      prop('title', 'string', { required: true }),
      prop('content', 'string'),
      prop('createdAt', 'string'),
      prop('coverImage', 'uri', { resolveLanguage: 'file-storage' }), // image URL — no sh:class → scalar
      prop('author', 'uri', { relatedModel: 'Agent' }), // to-one relation
      prop('signals', 'uri', { isCollection: true, relatedModel: 'Signal' }), // to-many relation
      prop('comments', 'uri', { isCollection: true }), // untyped edge (no sh:class) → scalar
    ],
  },
  {
    name: 'Agent',
    targetClass: 'we://Agent',
    properties: [prop('name', 'string'), prop('posts', 'uri', { isCollection: true, relatedModel: 'Post' })],
  },
  {
    name: 'Signal',
    targetClass: 'we://Signal',
    properties: [prop('signalTypeId', 'string'), prop('value', 'number')],
  },
];

describe('toNeutralManifest', () => {
  it('splits scalars from typed relations, mapping types and cardinality', () => {
    const { manifest, warnings } = toNeutralManifest(entries);
    expect(warnings).toEqual([]);

    expect(manifest.entities.Post.properties).toEqual({
      title: { type: 'string', required: true },
      content: { type: 'string' },
      createdAt: { type: 'string' },
      coverImage: { type: 'string' }, // uri without sh:class → string scalar
      comments: { type: 'string' }, // untyped collection edge → string scalar (can't be include-d anyway)
    });
    expect(manifest.entities.Post.relations).toEqual({
      author: { target: 'Agent', cardinality: 'one' },
      signals: { target: 'Signal', cardinality: 'many' },
    });
    expect(manifest.entities.Signal.properties.value).toEqual({ type: 'number' });
  });

  it('emits a referentially-valid manifest the shared validator accepts', () => {
    const { manifest } = toNeutralManifest(entries);
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });

  it('drives the query IR: the projected manifest validates a feed with scope + aliased include + aggregate', () => {
    const { manifest } = toNeutralManifest(entries);
    // Posts by one agent (scope), text-filtered, with the author hydrated, a like count, and the
    // current agent's like — the Step-1 constructs, validated against the Step-2 projected vocabulary.
    const feed: QueryIR = {
      irVersion: 1,
      entity: 'Post',
      scope: { via: 'posts', anchorId: 'a1', anchor: 'Agent' }, // Agent.posts → Post
      filter: { field: 'title', op: 'contains', value: 'x' },
      aggregate: [{ as: '$likeCount', over: 'signals', fn: 'count' }],
      include: {
        author: true,
        $myLike: { over: 'signals', filter: { field: 'signalTypeId', op: 'eq', value: 'like' }, first: true },
      },
    };
    expect(validateQueryAgainstManifest(feed, manifest).valid).toBe(true);
  });

  it('drops a relation whose target is not among the entities, and reports it', () => {
    const dangling: ModelManifestEntry[] = [
      { name: 'Post', targetClass: 'we://Post', properties: [prop('ghost', 'uri', { relatedModel: 'Nope' })] },
    ];
    const { manifest, warnings } = toNeutralManifest(dangling);
    expect(manifest.entities.Post.relations).toEqual({}); // dropped
    expect(warnings).toContainEqual(expect.stringContaining('unknown entity "Nope"'));
    expect(validateManifest(manifest).valid).toBe(true); // still valid, because the danger was dropped
  });

  it('warns on a duplicate entity name (namespace-blind SHACL) rather than silently colliding', () => {
    const dupes: ModelManifestEntry[] = [
      { name: 'Template', targetClass: 'we://Template', properties: [prop('a', 'string')] },
      { name: 'Template', targetClass: 'other://Template', properties: [prop('b', 'string')] },
    ];
    const { warnings } = toNeutralManifest(dupes);
    expect(warnings).toContainEqual(expect.stringContaining('duplicate entity "Template"'));
  });

  it('defaults the manifest version to "1" and honours an override', () => {
    expect(toNeutralManifest(entries).manifest.version).toBe('1');
    expect(toNeutralManifest(entries, { version: '2026-07' }).manifest.version).toBe('2026-07');
  });
});
