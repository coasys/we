import type { CoreEntityDef } from '../defs';

/**
 * A content model the space itself carries — the space-canonical tier of the shape system
 * (content-models plan §3): a community-authored entity definition any conforming client reads
 * from the space and renders generically.
 *
 * Follows the `Template` storage precedent exactly: one flag-typed record holding scalar metadata
 * plus one serialized JSON document in a file-storage property. The document is a `ModelManifest`
 * (see `@we/backend-shared`) with every predicate and the type flag resolved *before* storing, so
 * the stored definition is fully self-describing — a reading peer compiles it without any minting
 * rule, and a later rename cannot silently re-mint the predicates existing data lives under.
 *
 * The manifest document — not the SHACL compiled from it — is the source of truth. The compiled
 * SHACL is a projection written into the same space at adoption (the identical one-directional,
 * staleness-checked relationship the decorated classes have), because the manifest will grow
 * constraints SHACL cannot round-trip.
 */
export const Shape: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://shape' },
    properties: {
      /** The entity name (PascalCase, e.g. "Sighting") — the class name queries resolve. */
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      icon: { type: 'string', predicate: 'we://icon', default: '' },
      /**
       * Stable identity URI (`we://shapes/<uuid>`), minted once at creation and never changed. The
       * convergence mechanism for the emerging ecosystem: two spaces holding the same `shapeId` hold
       * *the same shape*, whatever they renamed it to — which is what lets a calendar recognize a
       * fork of "event" (via `forkedFrom` lineage) without a central registry.
       */
      shapeId: { type: 'string', predicate: 'we://shape_id', default: '' },
      /**
       * Definition version, bumped on every accepted edit. Instances do not record which version
       * wrote them (v1 keeps edits additive, so every version reads all data); the field exists so
       * versioning strategies stay open — see the migration discussion in the model-authoring plan.
       */
      version: { type: 'number', predicate: 'we://version', default: 1 },
      /** Lineage: the `shapeId@version` this shape was copied or forked from, empty for an original. */
      forkedFrom: { type: 'string', predicate: 'we://forked_from', default: '' },
      /** The `ModelManifest` JSON document — read raw and decoded by the caller, like `Template.schema`. */
      definition: { type: 'string', predicate: 'we://shape_definition', format: 'file', default: null },
    },
    relations: {},
  },
};
