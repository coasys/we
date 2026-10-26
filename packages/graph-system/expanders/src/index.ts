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
 * - {@link schemaPropertiesExpander} — a type node opened into what it *is*: its fields, and a Records node.
 * - {@link vocabularyPlugins} — what a space has defined, in buckets: its words, its models, its workflows.
 * - {@link querySeed} / {@link schemaSeed} / {@link datasetSeed} / {@link canvasSeed} — where a graph starts.
 */
export { collectionExpander } from './collection';
export type { CollectionExpanderOptions } from './collection';
export { entityExpander } from './entity';
export type { EntityExpanderOptions } from './entity';
export { edgeId, labelProperty, placeholder, rowToNode } from './nodes';
export { propertyExpander } from './property';
export type { PropertyExpanderOptions } from './property';
export { INSTANCES_TYPE, SCHEMA_TYPE, schemaExpander } from './schema';
export { schemaPropertiesExpander } from './schemaProperties';
export {
  WORKFLOW_STATE_TYPE,
  WORKFLOW_TYPE,
  VOCABULARY_TYPE,
  type VocabularyBucket,
  type VocabularyWorkflow,
  vocabularyPlugins,
  type VocabularySeedOptions,
} from './vocabulary';
export type { SchemaExpanderOptions } from './schema';
export {
  DEFAULT_REIFIED_EDGES,
  endpointRelations,
  isReified,
  type ReifiedEdgeMap,
  type ReifiedEdgeSpec,
  reifiedEdgeFrom,
} from './reified';
export { canvasSeed, type CanvasSeedOptions, PLACEMENT_UNSET, placementPosition, placementStyle } from './canvas';
export {
  type Aggregate,
  effectiveAggregate,
  parseWeights,
  type Pretend,
  pretendVotes,
  readVotes,
  type Voice,
  voicesOf,
  type Vote,
  weighSignals,
  weighVotes,
} from './weighing';
/*
  Exported because the canvas is not the only surface that will ask a set of placements where a node
  sits — a freeform canvas asks the same question of the same records, and "which of these applies"
  is a rule rather than a query, so the two must not answer it differently.
*/
export { type PlacementRow, placementsFor, resolvePlacement } from './placements';
export { datasetSeed, querySeed, schemaSeed } from './seeds';
export type { QuerySeedOptions, SchemaSeedOptions } from './seeds';

import { canvasSeed } from './canvas';
import { collectionExpander } from './collection';
import { entityExpander } from './entity';
import { propertyExpander } from './property';
import type { ReifiedEdgeMap } from './reified';
import { INSTANCES_TYPE, schemaExpander } from './schema';
import { schemaPropertiesExpander } from './schemaProperties';
import { datasetSeed, querySeed, schemaSeed } from './seeds';
import { vocabularyPlugins } from './vocabulary';

/**
 * The default set, ready to register.
 *
 * A function rather than a constant so each engine instance gets its own expander objects — they are
 * stateless today, and a shared mutable one would be a bug that only appears with two graphs on a page.
 */
export function defaultExpanders(options: { reified?: ReifiedEdgeMap } = {}) {
  const vocabulary = vocabularyPlugins();
  return {
    expanders: [
      entityExpander({ reified: options.reified }),
      collectionExpander(),
      schemaExpander(),
      // A model's Records node, opened into its instances — named apart so a graph that opens a model
      // into its properties does not also open it into every record it has.
      schemaExpander({ id: 'schema-instances', types: [INSTANCES_TYPE] }),
      schemaPropertiesExpander(),
      propertyExpander(),
      // The same, with values promoted to shared nodes — for a map where convergence is the point.
      propertyExpander({ id: 'property-values', valueNodes: true }),
      vocabulary.expander,
      vocabulary.records,
    ],
    seeds: [querySeed({ reified: options.reified }), schemaSeed(), datasetSeed(), canvasSeed(), vocabulary.seed],
  };
}
