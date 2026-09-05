/**
 * GENERATED — the AD4M lane's entity implementations, from `@we/entities`' manifest, living where
 * they belong: in the adapter that registers them. Everything else in the application reaches
 * these only through the entity proxies on `@we/entities`, which resolve to whatever this adapter
 * registered at connect time; importing from here is asking for one specific backend's
 * implementation by name, which only this package's own wiring and SDNA install have any
 * business doing.
 */
export * from './AgentSettings';
export * from './AudioBlock';
export * from './CallExtraction';
export * from './CalloutBlock';
export * from './ChatMessage';
export * from './ChatSession';
export * from './CodeBlock';
export * from './CollectionBlock';
export * from './DividerBlock';
export * from './EmbedBlock';
export * from './EventBlock';
export * from './FileBlock';
export * from './ImageBlock';
export * from './LinkBlock';
export * from './LocationBlock';
export * from './MutedAgent';
export * from './Placement';
export * from './ReadMarker';
export * from './Relationship';
export * from './RelationshipType';
export * from './Shape';
export * from './Signal';
export * from './SignalType';
export * from './Space';
export * from './SpacePreference';
export * from './SpaceTemplatePreference';
export * from './TagBlock';
export * from './TaskBlock';
export * from './Template';
export * from './TextBlock';
export * from './Theme';
export * from './Topic';
export * from './TypeStyle';
export * from './VideoBlock';
export { WeNode } from './WeNode';

// Type-only, and load-bearing: importing the conformance assertions is what places them in every
// build graph that includes this barrel, so a class drifting from its neutral interface fails the
// build rather than waiting to be noticed.
export type { AssertClassesSatisfyContract } from './conformance';
