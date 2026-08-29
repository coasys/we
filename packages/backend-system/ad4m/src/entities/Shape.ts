/**
 * GENERATED from src/manifest/Shape.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';

import { WeNode } from './WeNode';

/**
 * A content model the space itself carries — the space-canonical tier of the shape system
 * (content-models plan §3): a community-authored entity definition any conforming client reads
 * from the space and renders generically.
 *
 * Follows the `Template` storage precedent exactly: one flag-typed record holding scalar metadata
 * plus one serialized JSON document in a file-storage property. The document is a `EntityManifest`
 * (see `@we/backend-shared`) with every predicate and the type flag resolved *before* storing, so
 * the stored definition is fully self-describing — a reading peer compiles it without any minting
 * rule, and a later rename cannot silently re-mint the predicates existing data lives under.
 *
 * The manifest document — not the SHACL compiled from it — is the source of truth. The compiled
 * SHACL is a projection written into the same space at adoption (the identical one-directional,
 * staleness-checked relationship the decorated classes have), because the manifest will grow
 * constraints SHACL cannot round-trip.
 */
@Model({ name: 'Shape' })
export class Shape extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://shape' })
  flag: string = '';

  /** The entity name (PascalCase, e.g. "Sighting") — the class name queries resolve. */
  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  /**
   * Stable identity URI (`we://shapes/<uuid>`), minted once at creation and never changed. The
   * convergence mechanism for the emerging ecosystem: two spaces holding the same `shapeId` hold
   * *the same shape*, whatever they renamed it to — which is what lets a calendar recognize a
   * fork of "event" (via `forkedFrom` lineage) without a central registry.
   */
  @Property({ through: 'we://shape_id' })
  shapeId: string = '';

  /**
   * Definition version, bumped on every accepted edit. Instances do not record which version
   * wrote them (v1 keeps edits additive, so every version reads all data); the field exists so
   * versioning strategies stay open — see the migration discussion in the model-authoring plan.
   */
  @Property({ through: 'we://version' })
  version: number = 1;

  /** Lineage: the `shapeId@version` this shape was copied or forked from, empty for an original. */
  @Property({ through: 'we://forked_from' })
  forkedFrom: string = '';

  /** The `EntityManifest` JSON document — read raw and decoded by the caller, like `Template.schema`. */
  @Property({ through: 'we://shape_definition', resolveLanguage: FILE_STORAGE_LANGUAGE })
  definition: string | null = null;
}
