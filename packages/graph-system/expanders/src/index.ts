/**
 * `@we/graph-expanders` — WE's first-party answers to "what is adjacent to this?"
 *
 * Each is an independent implementation of {@link Expander} or {@link SeedSource} from
 * `@we/graph-protocol`; none knows about the others, and a module contributing its own does not need
 * to live in this package or in this repository. The engine resolves them through a registry the host
 * injects, so an external expander is a package exporting a factory.
 *
 * They divide by *how they find neighbours*, not by what the data means:
 * - {@link entityExpander} — typed relations, both directions, from the dataset's schema.
 * - {@link collectionExpander} — an untyped to-many relation, via the drill-down path.
 * - {@link propertyExpander} — the level below an entity: its own fields, and shared value nodes.
 * - {@link schemaExpander} — the level *above* an entity: a type node, opened into its instances.
 * - {@link querySeed} / {@link schemaSeed} / {@link datasetSeed} — where a graph starts.
 */
export { collectionExpander } from './collection';
export type { CollectionExpanderOptions } from './collection';
export { entityExpander } from './entity';
export type { EntityExpanderOptions } from './entity';
export { edgeId, labelProperty, placeholder, rowToNode } from './nodes';
export { propertyExpander } from './property';
export type { PropertyExpanderOptions } from './property';
export { SCHEMA_TYPE, schemaExpander } from './schema';
export type { SchemaExpanderOptions } from './schema';
export { datasetSeed, querySeed, schemaSeed } from './seeds';
export type { QuerySeedOptions, SchemaSeedOptions } from './seeds';

import { collectionExpander } from './collection';
import { entityExpander } from './entity';
import { propertyExpander } from './property';
import { schemaExpander } from './schema';
import { datasetSeed, querySeed, schemaSeed } from './seeds';

/**
 * The default set, ready to register.
 *
 * A function rather than a constant so each engine instance gets its own expander objects — they are
 * stateless today, and a shared mutable one would be a bug that only appears with two graphs on a page.
 */
export function defaultExpanders() {
  return {
    expanders: [entityExpander(), collectionExpander(), schemaExpander(), propertyExpander()],
    seeds: [querySeed(), schemaSeed(), datasetSeed()],
  };
}
