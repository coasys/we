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
import { manifestEntries } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
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
