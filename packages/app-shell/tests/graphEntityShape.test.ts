/**
 * Which manifest entries the graph reads as relations.
 *
 * One line decides it, and it was wrong in a way nothing caught: a relation was recognised by
 * naming a related entity, so every **untyped** one — `Relationship.source`, `Placement.node`,
 * `CollectionBlock.children`, the shared WeNode edges — was reclassified as a scalar property and
 * never reached `shape.relations` at all.
 *
 * The visible consequence was that no hand-drawn or extracted connection could be drawn in a
 * knowledge graph: the reified reader looks its two endpoints up among the relations, found neither,
 * and reported the record as missing an endpoint even though both ends existed and were readable.
 * A shape is data rather than behaviour, so nothing failed — the graph simply drew less than it had.
 */
import { buildEntityManifest } from '@we/backend-ad4m';
import { manifestEntries } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { entityExpander } from '@we/graph-expanders';
import { entityAddress, type ExpanderContext } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { toEntityShape } from '../src/shared/graphEntityShape';

const shapeOf = (name: string) => {
  const entry = manifestEntries(CORE_MANIFEST).find((e) => e.name === name);
  expect(entry, `no manifest entry for ${name}`).toBeDefined();
  return toEntityShape(entry!);
};

describe('toEntityShape', () => {
  it("carries a connection's untyped endpoints as relations, so the edge can be resolved", () => {
    const relations = shapeOf('Relationship').relations;
    for (const name of ['source', 'target']) {
      const relation = relations.find((r) => r.name === name);
      expect(relation, `Relationship.${name} is missing from the shape's relations`).toBeDefined();
      // Untyped is the whole point of a drawn connection — it joins whatever two things a member
      // found worth connecting — so the empty target is correct and must survive.
      expect(relation!.target).toBe('');
      expect(relation!.cardinality).toBe('one');
    }
  });

  it('keeps a declared target where there is one', () => {
    const signals = shapeOf('WeNode').relations.find((r) => r.name === 'signals');
    expect(signals).toMatchObject({ target: 'Signal', cardinality: 'many' });
  });

  it('reads an untyped to-many as a relation, not as a scalar', () => {
    const shape = shapeOf('CollectionBlock');
    expect(shape.relations.find((r) => r.name === 'children')).toMatchObject({ target: '', cardinality: 'many' });
    // And it is no longer offered as a property, where its raw URIs became node data.
    expect(shape.properties.some((p) => p.name === 'children')).toBe(false);
  });

  it('still separates real scalars', () => {
    const shape = shapeOf('CollectionBlock');
    expect(shape.properties.some((p) => p.name === 'title')).toBe(true);
    expect(shape.relations.some((r) => r.name === 'title')).toBe(false);
  });

  it("marks WE's plumbing as bookkeeping, so a relation tree never follows `signals` or `runs`", () => {
    // The canvas seed skips a relation only when its target's shape carries the mark. Without it,
    // every card's reactions and model runs hang under it in "Any connection".
    expect(shapeOf('Signal').bookkeeping).toBe(true);
    expect(shapeOf('ModelRun').bookkeeping).toBe(true);
    expect(
      toEntityShape({ name: 'Proposal', targetClass: 'x://Proposal', properties: [] }).bookkeeping,
    ).toBeUndefined();
  });
});

/**
 * What a node is captioned with, and why it is carried rather than guessed here.
 *
 * The graph has a good rule of its own, but it was a *second* rule: the card derivation answers the
 * same question for a record page and a card, so one record could be captioned by one and headed by
 * the other. It was — a composed note has no `title`, so the canvas labelled it by its flattened
 * `textContent` while its record page said "Untitled", one click apart.
 */
describe('the name a node is captioned with', () => {
  it('comes from the declaration, for every core entity that has one', () => {
    expect(shapeOf('TaskBlock').nameProperty).toBe('title');
    expect(shapeOf('CollectionBlock').nameProperty).toBe('title');
    expect(shapeOf('LocationBlock').nameProperty).toBe('name');
    // The one whose own required field is its body rather than its name.
    expect(shapeOf('CodeBlock').nameProperty).toBe('title');
  });

  it('is never the dedup key, which is a different fact', () => {
    // An event dedups on `occurrence` — its title and day glued together — so captioning a card
    // with it reads `Standup|2026-09-14`.
    const event = shapeOf('EventBlock');
    expect(event.properties.some((p) => p.name === 'occurrence')).toBe(true);
    expect(event.nameProperty).toBe('title');
  });

  it('is guessed for a foreign entry, which declares nothing', () => {
    // Built from SHACL rather than from a manifest: no `nameProperty` to carry, so the shared
    // guess runs over what the entry does have. The permanent case — a class synced in from
    // another app can never declare this.
    const foreign = toEntityShape({
      name: 'Channel',
      targetClass: 'flux://channel',
      properties: [
        {
          name: 'createdAt',
          predicate: 'flux://created',
          type: 'string',
          isCollection: false,
          required: true,
          writable: true,
        },
        {
          name: 'name',
          predicate: 'flux://name',
          type: 'string',
          isCollection: false,
          required: false,
          writable: true,
        },
      ],
    });
    expect(foreign.nameProperty).toBe('name');
  });

  it('does not caption a foreign entry by a stored file', () => {
    const foreign = toEntityShape({
      name: 'Attachment',
      targetClass: '',
      properties: [
        {
          name: 'name',
          predicate: 'x://name',
          type: 'string',
          isCollection: false,
          required: true,
          writable: true,
          resolveLanguage: 'file-storage',
        },
        {
          name: 'caption',
          predicate: 'x://caption',
          type: 'string',
          isCollection: false,
          required: false,
          writable: true,
        },
      ],
    });
    expect(foreign.nameProperty).toBe('caption');
  });
});

/**
 * The graph's relation readers over a shape an installed SDNA declares the way AD4M's model API
 * writes one: the link as a typed `hasOne` naming `target_class_name`, and no `sh:class`.
 *
 * Read through the same steps the app takes — the backend's manifest, then the graph's shape — so the
 * entity expander is answering from what an executor would actually report. Before the manifest read
 * `target_class_name`, the relation reached the graph with an empty target, and the expander walked
 * neither way along it.
 */
describe('a model relation declared by target class name, as the entity expander reads it', () => {
  const shape = {
    nodeShapeUri: 'PositionShape',
    targetClass: 'x://Position',
    properties: [
      { name: 'about', path: 'x://about', nodeKind: 'IRI', relationKind: 'hasOne', targetClassName: 'Topic' },
    ],
    parentShapes: [],
  } as unknown as Parameters<typeof buildEntityManifest>[0][number]['shape'];
  const topic = { nodeShapeUri: 'TopicShape', targetClass: 'x://Topic', properties: [], parentShapes: [] } as never;
  const shapes = buildEntityManifest([
    { name: 'Position', shape },
    { name: 'Topic', shape: topic },
  ]).map(toEntityShape);

  const contextFor = (answer: (query: Record<string, unknown>) => Record<string, unknown>[]) => {
    const asked: Record<string, unknown>[] = [];
    const context = {
      defaultDataset: () => 'ds',
      models: () => shapes,
      warn: () => {},
      query: async (query: Record<string, unknown>) => {
        asked.push(query);
        return answer(query);
      },
    } as unknown as ExpanderContext;
    return { asked, context };
  };

  it('follows it forward, from the position to its topic', async () => {
    const { asked, context } = contextFor((q) =>
      q.entity === 'Position' ? [{ id: 'p1', about: { id: 't1', title: 'Roadmap' } }] : [],
    );
    const result = await entityExpander().expand(
      { id: entityAddress('ds', 'Position', 'p1'), direction: 'out' },
      context,
    );
    expect(asked[0]).toMatchObject({ entity: 'Position', include: { about: true } });
    expect(result.edges).toEqual([
      expect.objectContaining({ type: 'about', target: entityAddress('ds', 'Topic', 't1') }),
    ]);
  });

  it('follows it backward, from the topic to what is about it', async () => {
    const { asked, context } = contextFor((q) => (q.entity === 'Position' ? [{ id: 'p1', about: 't1' }] : []));
    const result = await entityExpander().expand({ id: entityAddress('ds', 'Topic', 't1'), direction: 'in' }, context);
    expect(asked).toEqual([
      expect.objectContaining({
        entity: 'Position',
        scope: expect.objectContaining({ anchor: 'Topic', via: 'about' }),
      }),
    ]);
    expect(result.edges).toEqual([expect.objectContaining({ source: entityAddress('ds', 'Position', 'p1') })]);
  });
});
