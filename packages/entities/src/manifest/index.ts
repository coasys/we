import type { EntityManifest } from '@we/backend-shared';

import { AudioBlock } from './AudioBlock';
import { CalloutBlock } from './CalloutBlock';
import { CodeBlock } from './CodeBlock';
import { CollectionBlock } from './CollectionBlock';
import type { CoreEntityDef } from './defs';
import { DividerBlock } from './DividerBlock';
import { EmbedBlock } from './EmbedBlock';
import { EventBlock } from './EventBlock';
import { FileBlock } from './FileBlock';
import { ImageBlock } from './ImageBlock';
import { LinkBlock } from './LinkBlock';
import { LocationBlock } from './LocationBlock';
import { TagBlock } from './TagBlock';
import { TaskBlock } from './TaskBlock';
import { TextBlock } from './TextBlock';
import { VideoBlock } from './VideoBlock';

// The neutral contract, on the package's public surface. The conformance assertions that hold the
// AD4M lane to it live beside that lane's generated classes (@we/backend-ad4m src/models).
export * from './types';
import { AgentSettings } from './AgentSettings';
import { CallExtraction } from './CallExtraction';
import { ChatMessage } from './ChatMessage';
import { ChatSession } from './ChatSession';
import { MutedAgent } from './MutedAgent';
import { Placement } from './Placement';
import { ReadMarker } from './ReadMarker';
import { Relationship } from './Relationship';
import { RelationshipType } from './RelationshipType';
import { Shape } from './Shape';
import { WE_NODE_ENTITY, WE_NODE_RELATIONS } from './shared';
import { Signal } from './Signal';
import { SignalType } from './SignalType';
import { Space } from './Space';
import { SpacePreference } from './SpacePreference';
import { SpaceTemplatePreference } from './SpaceTemplatePreference';
import { Template } from './Template';
import { Theme } from './Theme';
import { TypeStyle } from './TypeStyle';

export { WE_NODE_ENTITY, WE_NODE_RELATIONS };

/**
 * Every core definition, in the order the manifest publishes them. This file is the assembly
 * point and nothing else: each entity is authored in its own module under `entities/` or
 * `blocks/`, and `scripts/generateClasses.mjs` turns these same definitions into the decorated
 * AD4M classes — the manifest is the source of truth, the classes are its artifact.
 */
export const CORE_DEFS: Record<string, CoreEntityDef> = {
  AgentSettings,
  AudioBlock,
  CalloutBlock,
  CallExtraction,
  ChatMessage,
  ChatSession,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  MutedAgent,
  Placement,
  ReadMarker,
  Relationship,
  RelationshipType,
  Shape,
  Signal,
  SignalType,
  Space,
  SpacePreference,
  SpaceTemplatePreference,
  TagBlock,
  TaskBlock,
  Template,
  TextBlock,
  Theme,
  TypeStyle,
  VideoBlock,
};

/** A WeNode-based entity inherits the shared relations; its own come first, as declared. */
function assemble(def: CoreEntityDef) {
  if (def.base !== 'WeNode') return def.entity;
  return { ...def.entity, relations: { ...def.entity.relations, ...WE_NODE_RELATIONS } };
}

export const CORE_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    ...Object.fromEntries(Object.entries(CORE_DEFS).map(([name, def]) => [name, assemble(def)])),
    WeNode: WE_NODE_ENTITY,
  },
};
