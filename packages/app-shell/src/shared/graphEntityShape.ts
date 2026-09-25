/**
 * A backend model manifest entry, as the graph engine reads it.
 *
 * A pure translation, kept out of the component that uses it so it can be tested without a DOM —
 * and because deciding what counts as a relation is a fact about the vocabulary rather than
 * anything to do with rendering.
 */
import { type EntityManifestEntry, nameFromProperties } from '@we/backend-shared';
import type { EntityShape } from '@we/graph-protocol';

/** Translate a backend model manifest entry into the neutral shape the graph reads. */
export function toEntityShape(entry: EntityManifestEntry): EntityShape {
  const properties: EntityShape['properties'] = [];
  const relations: EntityShape['relations'] = [];

  for (const property of entry.properties) {
    /*
      A relation is anything typed `uri` — the same test the model compiler uses. It used to be
      "anything naming a related entity", which quietly reclassified every **untyped** relation as a
      scalar property: `Relationship.source`, `Placement.node`, `CollectionBlock.children` and the
      shared WeNode edges all arrived as `uri`-typed properties and never appeared in `relations` at
      all.

      That is why no hand-drawn or extracted connection could be drawn in a knowledge graph. The
      reified reader looks its endpoints up in `shape.relations`, found neither, and reported the
      relationship as missing an endpoint — for records whose two ends existed and were readable.
      The backward walk in the entity expander was written for this case (it follows an untyped
      relation when the class holding it is reified) and had simply never been handed one.

      `target: ''` is the established spelling for "not declared", already read that way throughout
      the graph engine.
    */
    if (property.type === 'uri') {
      relations.push({
        name: property.name,
        target: property.relatedEntity ?? '',
        cardinality: property.isCollection ? 'many' : 'one',
      });
    } else {
      properties.push({
        name: property.name,
        type: property.type,
        ...(property.required ? { required: true } : {}),
      });
    }
  }

  /*
    What a node of this type is captioned with, carried through rather than left to the graph.

    The graph has its own guess and it is a good one, but it is a *second* guess: the card
    derivation resolves the same question for a record page and a card, so a node labelled by the
    graph's rule and a page headed by the display's could disagree about one record — and did. A
    note has no `title`, so the canvas captioned it by `textContent` while its record page said
    "Untitled".

    A declared entry already carries the answer. A **foreign** one cannot: it was built from SHACL,
    which holds no declaration of what names a thing, so the shared guess runs here over what the
    entry does have. `resolveLanguage` is how a file property announces itself in this form — a
    file expression URL is never a name.
  */
  const nameProperty =
    entry.nameProperty ||
    nameFromProperties(
      entry.properties
        .filter((property) => property.type !== 'uri' && !property.isCollection)
        .map((property) => ({
          name: property.name,
          type: property.type,
          ...(property.required ? { required: true } : {}),
          ...(property.resolveLanguage ? { isFile: true } : {}),
        })),
    );

  return { name: entry.name, properties, relations, ...(nameProperty ? { nameProperty } : {}) };
}
